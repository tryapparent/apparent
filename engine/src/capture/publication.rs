//! capture/2 provider adapter for the existing Core native publication port.
use super::{Journal as CaptureJournal, Shared, persist, read_journal, sha};
use apparent_capture_engine::{
    BundleLease, LeaseKind, Runtime, SecureStore,
    publication::{
        MaterialsKey, PublicationBackend, PublicationEvidence, PublicationRecoveryBinding,
        SealedFile, TrustedPublicationContext, TrustedSource,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs::File,
    io::Read,
    os::unix::fs::MetadataExt,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

const PLAN_LIMIT: u64 = 8 * 1024 * 1024;
const DOCUMENT_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Journal {
    pub publication_id: String,
    pub plan_sha256: String,
    pub staging_root: String,
    pub plan_file: SealedFile,
    pub materials: MaterialsKey,
    pub lease_id: String,
    pub bundle_id: String,
    pub bundle_path: String,
    pub manifest_sha256: String,
    pub state: String,
    #[serde(default)]
    pub commit_decided: bool,
    #[serde(default)]
    pub evidence: Option<Receipt>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Receipt {
    capture_id: String,
    materials: MaterialsKey,
    publication_id: String,
    plan_sha256: String,
    bundle_id: String,
    bundle_path: String,
    artifact_version: u32,
    artifact_provenance: String,
    manifest_sha256: String,
    inventory_sha256: String,
}

struct Opened {
    backend: PublicationBackend,
    context: TrustedPublicationContext,
    plan_bytes: Vec<u8>,
    _lease: BundleLease,
}

pub(super) fn status_fields(status: &mut Value, publication: &Journal) {
    status["state"] = Value::String(publication.state.clone());
    if matches!(
        publication.state.as_str(),
        "publishing" | "failed" | "cancelled"
    ) {
        status["publicationId"] = Value::String(publication.publication_id.clone());
        status["planSha256"] = Value::String(publication.plan_sha256.clone());
    }
    if publication.state == "saved" {
        if let Some(receipt) = &publication.evidence {
            status["publication"] = serde_json::to_value(receipt).unwrap_or(Value::Null);
        }
    }
}

/// Return the durable observation while a publication worker owns the slow
/// snapshot/commit path. This keeps same-connection inspect responsive.
pub(super) fn observe(request: &Value, root: &Path) -> Result<Value, &'static str> {
    let capture = request["captureId"].as_str().ok_or("malformed_request")?;
    let owner = request["ownerToken"].as_str().ok_or("malformed_request")?;
    let journal = read_journal(root, capture, owner)?;
    let publication = journal.publication.as_ref().ok_or("not_found")?;
    if publication.publication_id != request["publicationId"].as_str().unwrap_or_default()
        || publication.plan_sha256 != request["planSha256"].as_str().unwrap_or_default()
    {
        return Err("identity_conflict");
    }
    Ok(status_value(&journal))
}

pub(super) fn handle(
    request: &Value,
    runtime: &Runtime,
    root: &Path,
    all: &mut std::collections::HashMap<String, Arc<Shared>>,
) -> Result<Value, &'static str> {
    let method = request["method"].as_str().ok_or("malformed_request")?;
    let capture = request["captureId"].as_str().ok_or("malformed_request")?;
    let owner = request["ownerToken"].as_str().ok_or("malformed_request")?;

    // Authenticate the durable owner before publication state, plan, or receipts are read.
    let authenticated = read_journal(root, capture, owner)?;
    let mut journal = {
        let _owner = runtime
            .acquire_capture_owner(capture)
            .map_err(|_| "internal")?
            .ok_or("busy")?;
        read_journal(root, capture, owner)?
    };
    if journal.owner_token != authenticated.owner_token {
        return Err("permission_denied");
    }

    let mut opened = None;
    if method == "publish" {
        if let Some(prior) = journal
            .publication
            .as_ref()
            .filter(|publication| publication.state == "saved")
        {
            if request["publicationId"].as_str() != Some(prior.publication_id.as_str())
                || request["planSha256"].as_str() != Some(prior.plan_sha256.as_str())
                || request["materials"]
                    != serde_json::to_value(&prior.materials).map_err(|_| "internal")?
                || request["leaseId"].as_str() != Some(prior.lease_id.as_str())
                || request["stagingRoot"].as_str() != Some(prior.staging_root.as_str())
                || serde_json::from_value::<SealedFile>(request["planFile"].clone())
                    .ok()
                    .as_ref()
                    != Some(&prior.plan_file)
            {
                return Err("identity_conflict");
            }
            return Ok(status_value(&journal));
        }
        if let Some(prior) = journal
            .publication
            .as_ref()
            .filter(|publication| publication.commit_decided)
        {
            if !same_request_binding(request, prior)? {
                return Err("identity_conflict");
            }
            if let Some(status) = recover_saved(runtime, root, capture, owner, all, prior)? {
                return Ok(status);
            }
        }
        if journal.state != "materials-ready" || journal.cancel_requested {
            return Err(
                if journal.state == "cancelled" || journal.cancel_requested {
                    "cancelled"
                } else {
                    "not_ready"
                },
            );
        }
        let incoming = request_binding(request, &journal)?;
        match journal.publication.as_ref() {
            Some(prior) if !same_binding(prior, &incoming) => return Err("identity_conflict"),
            Some(_) => (),
            None => {
                opened = Some(open_publication(runtime, root, &journal, &incoming)?);
                let _owner = runtime
                    .acquire_capture_owner(capture)
                    .map_err(|_| "internal")?
                    .ok_or("busy")?;
                journal = read_journal(root, capture, owner)?;
                if journal.state != "materials-ready" || journal.cancel_requested {
                    return Err("cancelled");
                }
                journal.publication = Some(incoming);
                persist_owned(runtime, root, &mut journal, all)?;
            }
        }
    } else {
        let publication = journal.publication.as_ref().ok_or("not_found")?;
        if publication.publication_id != request["publicationId"].as_str().unwrap_or_default()
            || publication.plan_sha256 != request["planSha256"].as_str().unwrap_or_default()
        {
            return Err("identity_conflict");
        }
    }

    let publication = journal.publication.clone().ok_or("not_found")?;
    if publication.state == "saved"
        || publication.state == "cancelled"
        || publication.state == "failed"
    {
        return Ok(status_value(&journal));
    }

    if publication.commit_decided
        && let Some(status) = recover_saved(runtime, root, capture, owner, all, &publication)?
    {
        return Ok(status);
    }

    let opened = match opened {
        Some(opened) => opened,
        None => open_publication(runtime, root, &journal, &publication)?,
    };
    let _preparation = runtime
        .acquire_capture_owner(capture)
        .map_err(|_| "internal")?
        .ok_or("busy")?;
    journal = read_journal(root, capture, owner)?;
    let current = journal.publication.as_ref().ok_or("not_found")?;
    if current.state == "cancelled" || journal.cancel_requested {
        return Err("cancelled");
    }
    drop(_preparation);
    let prepared = opened
        .backend
        .prepare(
            &opened.context,
            &opened.plan_bytes,
            &publication.plan_sha256,
        )
        .map_err(|_| "invalid_publication")?;
    let _ = prepared;
    #[cfg(debug_assertions)]
    if let Ok(delay) = std::env::var("APPARENT_CAPTURE_TEST_PUBLICATION_COMMIT_DECISION_DELAY_MS")
        && let Ok(delay) = delay.parse::<u64>()
    {
        std::thread::sleep(std::time::Duration::from_millis(delay.min(10_000)));
    }
    let _decision = runtime
        .acquire_capture_owner(capture)
        .map_err(|_| "internal")?
        .ok_or("busy")?;
    journal = read_journal(root, capture, owner)?;
    let current = journal.publication.as_ref().ok_or("not_found")?;
    if current.publication_id != publication.publication_id
        || current.plan_sha256 != publication.plan_sha256
    {
        return Err("identity_conflict");
    }
    if current.state == "cancelled" || journal.cancel_requested {
        return Err("cancelled");
    }
    if !current.commit_decided {
        journal
            .publication
            .as_mut()
            .ok_or("not_found")?
            .commit_decided = true;
        persist_owned(runtime, root, &mut journal, all)?;
    }
    drop(_decision);
    // Inspection resumes a durably requested publish after a worker restart. It
    // never reports Saved from `prepared`; only the actual Core commit can do so.
    let evidence = opened
        .backend
        .commit(
            &opened.context,
            &opened.plan_bytes,
            &publication.plan_sha256,
        )
        .map_err(|_| "invalid_publication")?;
    #[cfg(debug_assertions)]
    if let Ok(delay) = std::env::var("APPARENT_CAPTURE_TEST_PUBLICATION_AFTER_COMMIT_DELAY_MS")
        && let Ok(delay) = delay.parse::<u64>()
    {
        std::thread::sleep(std::time::Duration::from_millis(delay.min(10_000)));
    }
    let _owner = runtime
        .acquire_capture_owner(capture)
        .map_err(|_| "internal")?
        .ok_or("busy")?;
    journal = read_journal(root, capture, owner)?;
    finish_saved(runtime, root, &mut journal, all, evidence)?;
    Ok(status_value(&journal))
}

pub(super) fn cancel(shared: &Arc<Shared>, root: &Path) -> Result<Value, &'static str> {
    let prior = shared.journal.lock().map_err(|_| "internal")?.clone();
    let _owner = shared
        .runtime
        .acquire_capture_owner(&prior.capture_id)
        .map_err(|_| "internal")?
        .ok_or("busy")?;
    let mut journal = read_journal(root, &prior.capture_id, &prior.owner_token)?;
    if let Some(publication) = journal.publication.clone() {
        if publication.state == "saved" || publication.commit_decided {
            return Ok(status_value(&journal));
        }
        if publication.state != "cancelled" && publication.state != "failed" {
            let pub_journal = journal.publication.as_mut().ok_or("internal")?;
            pub_journal.state = "cancelled".into();
        }
    }
    journal.state = "cancelled".into();
    journal.error = None;
    persist_journal_to_shared(shared, &journal)?;
    Ok(status_value(&journal))
}

fn request_binding(request: &Value, journal: &CaptureJournal) -> Result<Journal, &'static str> {
    let materials = journal.materials.as_ref().ok_or("not_ready")?;
    let key: MaterialsKey =
        serde_json::from_value(materials["key"].clone()).map_err(|_| "invalid_materials")?;
    let plan_file: SealedFile =
        serde_json::from_value(request["planFile"].clone()).map_err(|_| "malformed_request")?;
    let staging_root = request["stagingRoot"].as_str().ok_or("malformed_request")?;
    let plan_sha256 = request["planSha256"].as_str().ok_or("malformed_request")?;
    if key.capture_id != journal.capture_id
        || key.materials_id != journal.materials_id.as_deref().unwrap_or_default()
        || key.revision != journal.payload_digest.as_deref().unwrap_or_default()
        || request["materials"] != materials["key"]
        || request["leaseId"].as_str() != journal.lease_id.as_deref()
        || materials["leaseId"].as_str() != journal.lease_id.as_deref()
        || materials["root"].as_str() != Some(journal.root.as_str())
        || plan_file.sha256 != plan_sha256
        || plan_file.relative_path != "publication-plan.json"
        || !valid_id(request["publicationId"].as_str().unwrap_or_default())
        || !valid_hash(plan_sha256)
        || !absolute_normalized(staging_root)
    {
        return Err("invalid_publication");
    }
    let plan_fd =
        open_sealed(Path::new(staging_root), &plan_file).map_err(|_| "source_mismatch")?;
    let plan_bytes = read_bounded(&plan_fd, PLAN_LIMIT).map_err(|_| "source_mismatch")?;
    validate_open_file(&plan_fd, &plan_file).map_err(|_| "source_mismatch")?;
    if sha(&plan_bytes) != plan_sha256 {
        return Err("source_mismatch");
    }
    let plan: Value = serde_json::from_slice(&plan_bytes).map_err(|_| "invalid_publication")?;
    if plan["publicationId"].as_str() != request["publicationId"].as_str()
        || plan["materials"] != materials["key"]
        || plan["stagingRoot"].as_str() != Some(staging_root)
        || plan["bundleId"].as_str() != journal.request["bundleId"].as_str()
        || plan["destination"]["path"].as_str() != journal.request["bundlePath"].as_str()
        || plan["destination"]["mode"].as_str() != Some("absent")
    {
        return Err("identity_conflict");
    }
    let manifest_sha256 = plan["entries"]
        .as_array()
        .and_then(|entries| {
            entries.iter().find(|entry| {
                entry["relativePath"] == "apparent.json" && entry["role"] == "manifest"
            })
        })
        .and_then(|entry| entry["sha256"].as_str())
        .ok_or("invalid_publication")?
        .to_owned();
    if !valid_hash(&manifest_sha256) {
        return Err("invalid_publication");
    }
    Ok(Journal {
        publication_id: request["publicationId"].as_str().unwrap_or_default().into(),
        plan_sha256: plan_sha256.into(),
        staging_root: staging_root.into(),
        plan_file,
        materials: key,
        lease_id: journal.lease_id.clone().ok_or("invalid_materials")?,
        bundle_id: journal.request["bundleId"]
            .as_str()
            .ok_or("invalid_materials")?
            .into(),
        bundle_path: journal.request["bundlePath"]
            .as_str()
            .ok_or("invalid_materials")?
            .into(),
        manifest_sha256,
        // `publishing` is the existing capture/2 public observation. Keep the
        // durable binding retryable until Core returns committed evidence.
        state: "publishing".into(),
        commit_decided: false,
        evidence: None,
    })
}

fn same_binding(left: &Journal, right: &Journal) -> bool {
    left.publication_id == right.publication_id
        && left.plan_sha256 == right.plan_sha256
        && left.staging_root == right.staging_root
        && left.plan_file == right.plan_file
        && left.materials == right.materials
        && left.lease_id == right.lease_id
        && left.bundle_id == right.bundle_id
        && left.bundle_path == right.bundle_path
}

fn same_request_binding(request: &Value, prior: &Journal) -> Result<bool, &'static str> {
    Ok(
        request["publicationId"].as_str() == Some(prior.publication_id.as_str())
            && request["planSha256"].as_str() == Some(prior.plan_sha256.as_str())
            && request["materials"]
                == serde_json::to_value(&prior.materials).map_err(|_| "internal")?
            && request["leaseId"].as_str() == Some(prior.lease_id.as_str())
            && request["stagingRoot"].as_str() == Some(prior.staging_root.as_str())
            && serde_json::from_value::<SealedFile>(request["planFile"].clone())
                .ok()
                .as_ref()
                == Some(&prior.plan_file),
    )
}

/// Try Core's committed-only recovery before opening any caller source. This is
/// used only after the provider's authenticated durable record says the explicit
/// commit decision was reached; a missing Core commit falls through to the
/// ordinary source-validated preparation path.
fn recover_saved(
    runtime: &Runtime,
    root: &Path,
    capture: &str,
    owner: &str,
    all: &mut std::collections::HashMap<String, Arc<Shared>>,
    publication: &Journal,
) -> Result<Option<Value>, &'static str> {
    let destination_parent_path = Path::new(&publication.bundle_path)
        .parent()
        .ok_or("invalid_publication")?;
    let destination_parent = PublicationBackend::open_destination_parent(destination_parent_path)
        .map_err(|_| "source_mismatch")?;
    let control =
        Arc::new(SecureStore::ensure(&root.join("publication-core")).map_err(|_| "internal")?);
    let original = PublicationRecoveryBinding {
        publication_id: publication.publication_id.clone(),
        plan_sha256: publication.plan_sha256.clone(),
        materials: publication.materials.clone(),
        lease_id: publication.lease_id.clone(),
        bundle_id: publication.bundle_id.clone(),
        destination: publication.bundle_path.clone(),
        manifest_sha256: publication.manifest_sha256.clone(),
    };
    let backend = PublicationBackend::new(control);
    let Some(evidence) = backend
        .inspect_committed(&original, destination_parent)
        .map_err(|_| "invalid_publication")?
    else {
        return Ok(None);
    };

    let _owner = runtime
        .acquire_capture_owner(capture)
        .map_err(|_| "internal")?
        .ok_or("busy")?;
    let mut journal = read_journal(root, capture, owner)?;
    let current = journal.publication.as_ref().ok_or("not_found")?;
    if !current.commit_decided || !same_binding(current, publication) {
        return Err("identity_conflict");
    }
    if current.state == "saved" {
        return Ok(Some(status_value(&journal)));
    }
    finish_saved(runtime, root, &mut journal, all, evidence)?;
    Ok(Some(status_value(&journal)))
}

fn open_publication(
    runtime: &Runtime,
    root: &Path,
    capture: &CaptureJournal,
    publication: &Journal,
) -> Result<Opened, &'static str> {
    let mid = capture.materials_id.as_deref().ok_or("not_ready")?;
    let lease = runtime
        .material_lease(mid, LeaseKind::Read)
        .map_err(|_| "internal")?
        .ok_or("lease_busy")?;
    lease.check().map_err(|_| "lease_busy")?;
    let manifest = capture.materials.as_ref().ok_or("invalid_materials")?;
    validate_manifest_binding(capture, manifest, mid, &publication.materials)?;
    let material_root = PathBuf::from(&capture.root);
    let root_store = SecureStore::open(&material_root).map_err(|_| "source_mismatch")?;
    let root_metadata = root_store
        .directory_metadata()
        .map_err(|_| "source_mismatch")?;
    if Some(root_metadata.dev()) != capture.root_device
        || Some(root_metadata.ino()) != capture.root_inode
    {
        return Err("source_mismatch");
    }
    let payload_seal: SealedFile =
        serde_json::from_value(manifest["payloadFile"].clone()).map_err(|_| "invalid_materials")?;
    if payload_seal.relative_path != "materials.json"
        || payload_seal.sha256 != publication.materials.revision
        || Some(&manifest["payloadFile"]["identity"]) != capture.release_payload.as_ref()
    {
        return Err("invalid_materials");
    }
    let payload_file = open_sealed(&material_root, &payload_seal).map_err(|_| "source_mismatch")?;
    let payload_bytes =
        read_bounded(&payload_file, DOCUMENT_LIMIT).map_err(|_| "source_mismatch")?;
    if sha(&payload_bytes) != payload_seal.sha256
        || capture.payload_digest.as_deref() != Some(payload_seal.sha256.as_str())
    {
        return Err("source_mismatch");
    }
    let payload: Value = serde_json::from_slice(&payload_bytes).map_err(|_| "invalid_materials")?;
    validate_payload_binding(capture, &payload, publication)?;
    let material_files: Vec<SealedFile> = payload["files"]
        .as_array()
        .ok_or("invalid_materials")?
        .iter()
        .cloned()
        .map(|v| serde_json::from_value(v).map_err(|_| "invalid_materials"))
        .collect::<Result<_, _>>()?;
    let stage_store =
        SecureStore::open(Path::new(&publication.staging_root)).map_err(|_| "source_mismatch")?;
    let plan_file = open_sealed(Path::new(&publication.staging_root), &publication.plan_file)
        .map_err(|_| "source_mismatch")?;
    let plan_bytes = read_bounded(&plan_file, PLAN_LIMIT).map_err(|_| "source_mismatch")?;
    validate_open_file(&plan_file, &publication.plan_file).map_err(|_| "source_mismatch")?;
    if sha(&plan_bytes) != publication.plan_sha256 {
        return Err("source_mismatch");
    }
    let plan: Value = serde_json::from_slice(&plan_bytes).map_err(|_| "invalid_publication")?;
    validate_plan_binding(&plan, publication)?;
    let mut sources = Vec::new();
    let mut seen = HashSet::new();
    for entry in plan["entries"].as_array().ok_or("invalid_publication")? {
        let (source_key, source_root, seal) =
            source_binding(entry, &payload, &material_root, &publication.staging_root)?;
        if seen.insert(source_key.clone()) {
            let file = open_sealed(&source_root, &seal).map_err(|_| "source_mismatch")?;
            validate_open_file(&file, &seal).map_err(|_| "source_mismatch")?;
            sources.push(TrustedSource {
                source_key,
                file,
                seal,
            });
        }
    }
    stage_store
        .directory_file()
        .map_err(|_| "source_mismatch")?;
    lease.check().map_err(|_| "lease_busy")?;
    let destination = plan["destination"]["path"]
        .as_str()
        .ok_or("invalid_publication")?;
    let destination_parent_path = Path::new(destination)
        .parent()
        .ok_or("invalid_publication")?;
    let destination_parent = PublicationBackend::open_destination_parent(destination_parent_path)
        .map_err(|_| "source_mismatch")?;
    let control =
        Arc::new(SecureStore::ensure(&root.join("publication-core")).map_err(|_| "internal")?);
    let backend = PublicationBackend::new(control);
    Ok(Opened {
        backend,
        context: TrustedPublicationContext {
            publication_id: publication.publication_id.clone(),
            materials: publication.materials.clone(),
            lease_id: publication.lease_id.clone(),
            bundle_id: publication.bundle_id.clone(),
            staging_root: publication.staging_root.clone(),
            destination: publication.bundle_path.clone(),
            material_files,
            sources,
            destination_parent,
        },
        plan_bytes,
        _lease: lease,
    })
}

fn source_binding(
    entry: &Value,
    payload: &Value,
    material_root: &Path,
    staging_root: &str,
) -> Result<(String, PathBuf, SealedFile), &'static str> {
    let input = &entry["input"];
    match input["kind"].as_str().ok_or("invalid_publication")? {
        "material" => {
            let path = input["relativePath"]
                .as_str()
                .ok_or("invalid_publication")?;
            let seal_value = payload["files"]
                .as_array()
                .and_then(|files| files.iter().find(|f| f["relativePath"] == path))
                .ok_or("invalid_materials")?;
            let seal: SealedFile =
                serde_json::from_value(seal_value.clone()).map_err(|_| "invalid_materials")?;
            Ok((format!("material:{path}"), material_root.to_owned(), seal))
        }
        "assembled" => {
            let seal: SealedFile =
                serde_json::from_value(input["file"].clone()).map_err(|_| "invalid_publication")?;
            let path = seal.relative_path.clone();
            Ok((
                format!("assembled:{path}"),
                PathBuf::from(staging_root),
                seal,
            ))
        }
        // The derivative envelope is caller-authored and has no committed
        // Engine media-job authority. Do not classify it as native output.
        "derivative" => Err("unavailable"),
        _ => Err("invalid_publication"),
    }
}

fn validate_manifest_binding(
    capture: &CaptureJournal,
    manifest: &Value,
    mid: &str,
    key: &MaterialsKey,
) -> Result<(), &'static str> {
    if manifest["schema"].as_str() != Some("apparent.capture-materials/1")
        || manifest["key"]["captureId"].as_str() != Some(capture.capture_id.as_str())
        || manifest["key"]["materialsId"].as_str() != Some(mid)
        || manifest["key"]["revision"].as_str()
            != Some(capture.payload_digest.as_deref().unwrap_or_default())
        || manifest["key"] != serde_json::to_value(key).map_err(|_| "invalid_materials")?
        || manifest["leaseId"].as_str() != capture.lease_id.as_deref()
        || manifest["root"].as_str() != Some(capture.root.as_str())
    {
        return Err("invalid_materials");
    }
    Ok(())
}

fn validate_payload_binding(
    capture: &CaptureJournal,
    payload: &Value,
    publication: &Journal,
) -> Result<(), &'static str> {
    if payload["schema"].as_str() != Some("apparent.capture-materials-payload/1")
        || payload["identity"]["captureId"].as_str() != Some(capture.capture_id.as_str())
        || payload["identity"]["materialsId"].as_str()
            != Some(publication.materials.materials_id.as_str())
        || payload["root"].as_str() != Some(capture.root.as_str())
        || payload["leaseId"].as_str() != Some(publication.lease_id.as_str())
        || payload["bundleId"].as_str() != Some(publication.bundle_id.as_str())
        || payload["safety"]["safeForProcessing"] != true
        || payload["files"].as_array().is_none()
    {
        return Err("invalid_materials");
    }
    let movie = payload["files"]
        .as_array()
        .and_then(|files| {
            files
                .iter()
                .find(|file| file["relativePath"] == "recording.mp4")
        })
        .ok_or("invalid_materials")?;
    if Some(&movie["identity"]) != capture.release_movie.as_ref()
        || payload["video"]["file"].as_str() != Some("recording.mp4")
    {
        return Err("invalid_materials");
    }
    Ok(())
}

fn validate_plan_binding(plan: &Value, publication: &Journal) -> Result<(), &'static str> {
    if plan["schema"].as_str() != Some("apparent.bundle-publication/1")
        || plan["publicationId"].as_str() != Some(publication.publication_id.as_str())
        || plan["materials"]
            != serde_json::to_value(&publication.materials).map_err(|_| "invalid_publication")?
        || plan["bundleId"].as_str() != Some(publication.bundle_id.as_str())
        || plan["stagingRoot"].as_str() != Some(publication.staging_root.as_str())
        || plan["destination"]["path"].as_str() != Some(publication.bundle_path.as_str())
        || plan["destination"]["mode"].as_str() != Some("absent")
        || plan["entries"].as_array().is_none()
    {
        return Err("invalid_publication");
    }
    let manifest = plan["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["relativePath"] == "apparent.json")
        .ok_or("invalid_publication")?;
    if manifest["sha256"].as_str() != Some(publication.manifest_sha256.as_str()) {
        return Err("identity_conflict");
    }
    Ok(())
}

fn finish_saved(
    runtime: &Runtime,
    root: &Path,
    journal: &mut CaptureJournal,
    all: &mut std::collections::HashMap<String, Arc<Shared>>,
    evidence: PublicationEvidence,
) -> Result<(), &'static str> {
    let p = journal.publication.as_mut().ok_or("internal")?;
    if evidence.publication_id != p.publication_id
        || evidence.plan_sha256 != p.plan_sha256
        || evidence.materials != p.materials
        || evidence.lease_id != p.lease_id
        || evidence.bundle_id != p.bundle_id
        || evidence.destination != p.bundle_path
        || evidence.manifest_sha256 != p.manifest_sha256
    {
        return Err("identity_conflict");
    }
    p.state = "saved".into();
    p.evidence = Some(Receipt {
        capture_id: journal.capture_id.clone(),
        materials: evidence.materials,
        publication_id: evidence.publication_id,
        plan_sha256: evidence.plan_sha256,
        bundle_id: evidence.bundle_id,
        bundle_path: evidence.destination,
        artifact_version: 1,
        artifact_provenance: "native".into(),
        manifest_sha256: evidence.manifest_sha256,
        inventory_sha256: evidence.inventory_sha256,
    });
    persist_record(runtime, root, journal, all)
}

fn persist_owned(
    runtime: &Runtime,
    root: &Path,
    journal: &mut CaptureJournal,
    all: &mut std::collections::HashMap<String, Arc<Shared>>,
) -> Result<(), &'static str> {
    persist_record(runtime, root, journal, all)
}

fn persist_record(
    runtime: &Runtime,
    root: &Path,
    journal: &CaptureJournal,
    all: &mut std::collections::HashMap<String, Arc<Shared>>,
) -> Result<(), &'static str> {
    let shared = all.get(&journal.capture_id).cloned().unwrap_or_else(|| {
        Arc::new(Shared {
            journal: Mutex::new(journal.clone()),
            directory: root.to_owned(),
            runtime: runtime.clone(),
            stop: std::sync::atomic::AtomicBool::new(false),
            cancel: std::sync::atomic::AtomicBool::new(false),
            epoch: std::time::Instant::now(),
        })
    });
    *shared.journal.lock().map_err(|_| "internal")? = journal.clone();
    persist(&shared).map_err(|_| "internal")?;
    let durable = read_journal(root, &journal.capture_id, &journal.owner_token)?;
    *shared.journal.lock().map_err(|_| "internal")? = durable;
    all.insert(journal.capture_id.clone(), shared);
    Ok(())
}

fn persist_journal_to_shared(
    shared: &Arc<Shared>,
    journal: &CaptureJournal,
) -> Result<(), &'static str> {
    *shared.journal.lock().map_err(|_| "internal")? = journal.clone();
    persist(shared).map_err(|_| "internal")?;
    *shared.journal.lock().map_err(|_| "internal")? =
        read_journal(&shared.directory, &journal.capture_id, &journal.owner_token)?;
    Ok(())
}

fn status_value(journal: &CaptureJournal) -> Value {
    let mut value = json!({"captureId":journal.capture_id,"state":journal.state});
    if let Some(materials) = &journal.materials {
        value["materials"] = materials.clone();
    }
    if let Some(publication) = &journal.publication {
        status_fields(&mut value, publication);
    }
    value
}

fn validate_open_file(file: &File, seal: &SealedFile) -> Result<(), &'static str> {
    let metadata = file.metadata().map_err(|_| "source_mismatch")?;
    let modified_ns =
        (metadata.mtime() as i128 * 1_000_000_000 + metadata.mtime_nsec() as i128).to_string();
    let expected = &seal.identity;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 1
        || metadata.dev().to_string() != expected.device
        || metadata.ino().to_string() != expected.inode
        || metadata.len() != expected.size
        || modified_ns != expected.modified_ns
    {
        return Err("source_mismatch");
    }
    Ok(())
}

fn open_sealed(root: &Path, seal: &SealedFile) -> Result<File, &'static str> {
    if !valid_relative(&seal.relative_path) {
        return Err("invalid_publication");
    }
    let mut path = root.to_owned();
    let components: Vec<_> = Path::new(&seal.relative_path).components().collect();
    for component in &components[..components.len().saturating_sub(1)] {
        let Component::Normal(part) = component else {
            return Err("invalid_publication");
        };
        path.push(part);
        SecureStore::open(&path).map_err(|_| "source_mismatch")?;
    }
    let Component::Normal(leaf) = components.last().ok_or("invalid_publication")? else {
        return Err("invalid_publication");
    };
    let parent = SecureStore::open(&path).map_err(|_| "source_mismatch")?;
    let file = parent
        .file(leaf.to_str().ok_or("invalid_publication")?, false)
        .map_err(|_| "source_mismatch")?;
    validate_open_file(&file, seal)?;
    Ok(file)
}

fn read_bounded(file: &File, limit: u64) -> Result<Vec<u8>, &'static str> {
    let len = file.metadata().map_err(|_| "source_mismatch")?.len();
    if len == 0 || len > limit {
        return Err("invalid_publication");
    }
    let mut bytes = Vec::with_capacity(len as usize);
    file.try_clone()
        .map_err(|_| "source_mismatch")?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "source_mismatch")?;
    if bytes.len() as u64 != len {
        return Err("source_mismatch");
    }
    Ok(bytes)
}

fn valid_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn valid_relative(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.contains('\0')
        && Path::new(value)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}
fn absolute_normalized(value: &str) -> bool {
    let path = Path::new(value);
    path.is_absolute()
        && path.to_str() == Some(value)
        && path
            .components()
            .all(|c| matches!(c, Component::RootDir | Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        time::{SystemTime, UNIX_EPOCH},
    };

    const FRAME: &[u8] =
        include_bytes!("../../../record/test/fixtures/take.apparent/frames/frame-01.png");
    const MOVIE: &[u8] = include_bytes!("../../core/tests/fixtures/tiny.mp4");

    struct Fixture {
        base: PathBuf,
        runtime_path: PathBuf,
        capture_root: PathBuf,
        runtime: Runtime,
        request: Value,
        shared: Arc<Shared>,
        destination: PathBuf,
        owner: String,
        capture_id: String,
    }

    fn private_dir(path: &Path) {
        fs::create_dir_all(path).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
    }

    fn temp() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "capture-pub-provider-{}-{stamp}",
            std::process::id()
        ));
        private_dir(&path);
        path
    }

    fn sealed(store: &SecureStore, root: &Path, relative_path: &str) -> SealedFile {
        let path = root.join(relative_path);
        let parent = SecureStore::open(path.parent().unwrap()).unwrap();
        let file = parent
            .file(path.file_name().unwrap().to_str().unwrap(), false)
            .unwrap();
        let metadata = file.metadata().unwrap();
        let mut bytes = Vec::new();
        file.try_clone().unwrap().read_to_end(&mut bytes).unwrap();
        let _ = store;
        SealedFile {
            relative_path: relative_path.into(),
            identity: apparent_capture_engine::publication::FileIdentity {
                device: metadata.dev().to_string(),
                inode: metadata.ino().to_string(),
                size: metadata.len(),
                modified_ns: (metadata.mtime() as i128 * 1_000_000_000
                    + metadata.mtime_nsec() as i128)
                    .to_string(),
            },
            sha256: sha(&bytes),
        }
    }

    fn write(store: &SecureStore, name: &str, bytes: &[u8]) {
        store.write_new(name, bytes).unwrap();
    }

    fn fixture() -> Fixture {
        let base = temp();
        let runtime_path = base.join("runtime");
        private_dir(&runtime_path);
        let runtime = Runtime::open(&runtime_path).unwrap();
        let capture_root = runtime_path.join("capture-v2");
        let captures = SecureStore::ensure(&capture_root).unwrap();
        let material_parent = capture_root.join("materials");
        SecureStore::ensure(&material_parent).unwrap();

        let capture_id = apparent_capture_engine::new_id().unwrap();
        let materials_id = apparent_capture_engine::new_id().unwrap();
        let lease_id = apparent_capture_engine::new_id().unwrap();
        let publication_id = apparent_capture_engine::new_id().unwrap();
        let owner = apparent_capture_engine::new_owner_token().unwrap();
        let bundle_id = "capture-provider-fixture.apparent";
        let material_root = material_parent.join(&capture_id);
        let materials = SecureStore::create(&material_root).unwrap();
        write(&materials, "recording.mp4", MOVIE);
        let movie = sealed(&materials, &material_root, "recording.mp4");
        let payload = json!({
            "schema":"apparent.capture-materials-payload/1",
            "identity":{"captureId":capture_id,"materialsId":materials_id},
            "bundleId":bundle_id,
            "root":material_root,
            "leaseId":lease_id,
            "clock":{"videoOffsetMs":0},
            "files":[movie],
            "video":{"file":"recording.mp4","width":16,"height":16,"durationMs":1},
            "safety":{"safeForProcessing":true}
        });
        let payload_bytes = serde_json::to_vec(&payload).unwrap();
        write(&materials, "materials.json", &payload_bytes);
        let payload_file = sealed(&materials, &material_root, "materials.json");
        let revision = sha(&payload_bytes);
        let key = MaterialsKey {
            capture_id: capture_id.clone(),
            materials_id: materials_id.clone(),
            revision: revision.clone(),
        };
        let manifest = json!({"schema":"apparent.capture-materials/1","key":key,"root":material_root,"leaseId":lease_id,"payloadFile":payload_file});
        let root_metadata = materials.directory_metadata().unwrap();
        let start_path = base.join("bundles").join(bundle_id);
        private_dir(start_path.parent().unwrap());
        let staging_root = base.join("record-stage").join(&publication_id);
        private_dir(staging_root.parent().unwrap());
        private_dir(&staging_root);
        let stage = SecureStore::open(&staging_root).unwrap();
        write(&stage, ".record-publication", b"private Record control");
        write(&stage, "summary.md", b"# Capture\n");
        write(&stage, "contact-sheet.png", FRAME);
        let summary = sealed(&stage, &staging_root, "summary.md");
        let contact = sealed(&stage, &staging_root, "contact-sheet.png");
        let manifest_value = json!({
            "version":1,"id":bundle_id,"createdAtMs":1,"durationMs":1,
            "target":{"mode":"display","displayId":1,"frame":{"x":0,"y":0,"width":16,"height":16,"scale":1}},
            "transcript":{"source":"none","text":"","segments":[]},
            "strokes":[],"marks":[],"events":[],
            "keyframes":[{"index":1,"t":0,"reason":"initial","file":"frames/frame-01.png","event":"start"}],
            "contactSheet":"contact-sheet.png","video":"recording.mp4"
        });
        let manifest_bytes = serde_json::to_vec(&manifest_value).unwrap();
        write(&stage, "apparent.json", &manifest_bytes);
        let bundle_manifest = sealed(&stage, &staging_root, "apparent.json");
        let plan = json!({
            "schema":"apparent.bundle-publication/1","publicationId":publication_id,"materials":key,
            "bundleId":bundle_id,"stagingRoot":staging_root,
            "destination":{"path":start_path,"mode":"absent"},"artifactVersion":1,
            "entries":[
                {"relativePath":"apparent.json","sha256":bundle_manifest.sha256,"byteLength":bundle_manifest.identity.size,"role":"manifest","input":{"kind":"assembled","file":bundle_manifest}},
                {"relativePath":"summary.md","sha256":summary.sha256,"byteLength":summary.identity.size,"role":"summary","input":{"kind":"assembled","file":summary}},
                {"relativePath":"frames/frame-01.png","sha256":contact.sha256,"byteLength":contact.identity.size,"role":"frame","input":{"kind":"assembled","file":contact}},
                {"relativePath":"contact-sheet.png","sha256":contact.sha256,"byteLength":contact.identity.size,"role":"contact-sheet","input":{"kind":"assembled","file":contact}},
                {"relativePath":"recording.mp4","sha256":movie.sha256,"byteLength":movie.identity.size,"role":"video","input":{"kind":"material","relativePath":"recording.mp4"}}
            ],"manifestPath":"apparent.json","summaryPath":"summary.md","profile":"apparent-bundle/1"
        });
        let plan_bytes = serde_json::to_vec(&plan).unwrap();
        write(&stage, "publication-plan.json", &plan_bytes);
        let plan_file = sealed(&stage, &staging_root, "publication-plan.json");
        let plan_sha256 = sha(&plan_bytes);
        let capture_journal = CaptureJournal {
            capture_id: capture_id.clone(),
            owner_token: owner.clone(),
            request: json!({"captureId":capture_id,"ownerToken":owner,"bundleId":bundle_id,"bundlePath":start_path}),
            state: "materials-ready".into(),
            error: None,
            materials: Some(manifest),
            root: material_root.to_string_lossy().into_owned(),
            materials_id: Some(materials_id),
            lease_id: Some(lease_id.clone()),
            root_device: Some(root_metadata.dev()),
            root_inode: Some(root_metadata.ino()),
            release_phase: None,
            release_movie: Some(serde_json::to_value(&movie.identity).unwrap()),
            release_payload: Some(serde_json::to_value(&payload_file.identity).unwrap()),
            partial_movie: None,
            payload_digest: Some(revision),
            admitted_monotonic_ns: None,
            confirmed_at_ms: None,
            cancel_requested: false,
            publication: None,
        };
        captures
            .write_new(
                &format!("{capture_id}.json"),
                &serde_json::to_vec(&capture_journal).unwrap(),
            )
            .unwrap();
        let shared = Arc::new(Shared {
            journal: Mutex::new(capture_journal),
            directory: capture_root.clone(),
            runtime: runtime.clone(),
            stop: std::sync::atomic::AtomicBool::new(false),
            cancel: std::sync::atomic::AtomicBool::new(false),
            epoch: std::time::Instant::now(),
        });
        Fixture {
            base,
            runtime_path,
            capture_root,
            runtime,
            request: json!({"method":"publish","captureId":capture_id,"ownerToken":owner,"leaseId":lease_id,
                "publicationId":publication_id,"materials":key,"stagingRoot":staging_root,"planFile":plan_file,"planSha256":plan_sha256}),
            shared,
            destination: start_path,
            owner,
            capture_id,
        }
    }

    fn call(fixture: &Fixture, request: &Value) -> Result<Value, &'static str> {
        handle(
            request,
            &fixture.runtime,
            &fixture.capture_root,
            &mut Default::default(),
        )
    }

    #[test]
    fn authenticated_publish_snapshots_only_declared_inventory_and_replays_saved() {
        let f = fixture();
        let saved = call(&f, &f.request).unwrap();
        assert_eq!(saved["state"], "saved");
        assert_eq!(saved["publication"]["artifactProvenance"], "native");
        assert_eq!(
            saved["publication"]["bundlePath"],
            f.destination.to_string_lossy().as_ref()
        );
        assert!(f.destination.join("frames/frame-01.png").is_file());
        assert!(f.destination.join("recording.mp4").is_file());
        assert!(!f.destination.join(".record-publication").exists());
        assert!(!f.destination.join("publication-plan.json").exists());
        assert_eq!(
            cancel(&f.shared, &f.capture_root).unwrap()["state"],
            "saved"
        );
        let inspect = json!({"method":"inspectPublication","captureId":f.capture_id,"ownerToken":f.owner,
            "publicationId":f.request["publicationId"],"planSha256":f.request["planSha256"]});
        assert_eq!(call(&f, &inspect).unwrap(), saved);
        let mut unauthenticated = inspect.clone();
        unauthenticated["ownerToken"] = Value::String("f".repeat(64));
        unauthenticated["publicationId"] = Value::String("0".repeat(32));
        assert_eq!(call(&f, &unauthenticated).unwrap_err(), "permission_denied");
        let mut conflict = inspect;
        conflict["publicationId"] = Value::String("0".repeat(32));
        assert_eq!(call(&f, &conflict).unwrap_err(), "identity_conflict");
        fs::remove_dir_all(f.base).unwrap();
    }

    #[test]
    fn cancel_wins_before_commit_and_a_foreign_destination_never_becomes_saved() {
        let f = fixture();
        let cancelled = cancel(&f.shared, &f.capture_root).unwrap();
        assert_eq!(cancelled["state"], "cancelled");
        assert_eq!(call(&f, &f.request).unwrap_err(), "cancelled");
        fs::remove_dir_all(f.base).unwrap();

        let f = fixture();
        private_dir(&f.destination);
        fs::write(f.destination.join("foreign.txt"), b"foreign").unwrap();
        assert_eq!(call(&f, &f.request).unwrap_err(), "invalid_publication");
        assert_eq!(
            fs::read(f.destination.join("foreign.txt")).unwrap(),
            b"foreign"
        );
        fs::remove_dir_all(f.base).unwrap();
    }

    #[test]
    fn derivative_input_is_unavailable_without_native_job_authority() {
        let f = fixture();
        let staging_root = Path::new(f.request["stagingRoot"].as_str().unwrap());
        let plan_path = staging_root.join("publication-plan.json");
        let mut plan: Value = serde_json::from_slice(&fs::read(&plan_path).unwrap()).unwrap();
        let entry = plan["entries"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|entry| entry["relativePath"] == "frames/frame-01.png")
            .unwrap();
        entry["input"] = json!({"kind":"derivative","receipt":{"schema":"apparent.media-derivative/1"},"fileIndex":1});
        let plan_bytes = serde_json::to_vec(&plan).unwrap();
        SecureStore::open(staging_root)
            .unwrap()
            .replace_checked("publication-plan.json", &plan_bytes)
            .unwrap();
        let plan_file = sealed(
            &SecureStore::open(staging_root).unwrap(),
            staging_root,
            "publication-plan.json",
        );
        let mut request = f.request.clone();
        request["planFile"] = serde_json::to_value(plan_file).unwrap();
        request["planSha256"] = Value::String(sha(&plan_bytes));
        assert_eq!(call(&f, &request).unwrap_err(), "unavailable");
        assert!(!f.destination.exists());
        fs::remove_dir_all(f.base).unwrap();
    }

    #[test]
    fn inspect_recovers_commit_after_worker_restart_and_lost_reply() {
        let f = fixture();
        let mut journal = read_journal(&f.capture_root, &f.capture_id, &f.owner).unwrap();
        let publication = request_binding(&f.request, &journal).unwrap();
        let opened = open_publication(&f.runtime, &f.capture_root, &journal, &publication).unwrap();
        opened
            .backend
            .prepare(
                &opened.context,
                &opened.plan_bytes,
                &publication.plan_sha256,
            )
            .unwrap();
        journal.publication = Some(publication);
        let _owner = f
            .runtime
            .acquire_capture_owner(&f.capture_id)
            .unwrap()
            .unwrap();
        persist_record(
            &f.runtime,
            &f.capture_root,
            &journal,
            &mut Default::default(),
        )
        .unwrap();
        drop(_owner);
        drop(opened);

        let restarted_runtime = Runtime::open(&f.runtime_path).unwrap();
        let inspect = json!({"method":"inspectPublication","captureId":f.capture_id,"ownerToken":f.owner,
            "publicationId":f.request["publicationId"],"planSha256":f.request["planSha256"]});
        let recovered = handle(
            &inspect,
            &restarted_runtime,
            &f.capture_root,
            &mut Default::default(),
        )
        .unwrap();
        assert_eq!(recovered["state"], "saved");
        assert!(f.destination.join("apparent.json").is_file());
        fs::remove_dir_all(f.base).unwrap();
    }

    #[test]
    fn concurrent_cancel_and_commit_have_one_durable_winner() {
        let f = fixture();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let publish_barrier = barrier.clone();
        let request = f.request.clone();
        let runtime = f.runtime.clone();
        let capture_root = f.capture_root.clone();
        let publish_handle = std::thread::spawn(move || {
            publish_barrier.wait();
            handle(&request, &runtime, &capture_root, &mut Default::default())
        });
        let cancel_barrier = barrier;
        let shared = f.shared.clone();
        let root = f.capture_root.clone();
        let cancel_handle = std::thread::spawn(move || {
            cancel_barrier.wait();
            cancel(&shared, &root)
        });
        let publish_result = publish_handle.join().unwrap();
        let cancel_result = cancel_handle.join().unwrap();
        assert!(publish_result.is_ok() || publish_result == Err("cancelled"));
        assert!(cancel_result.is_ok() || cancel_result == Err("busy"));
        let durable = read_journal(&f.capture_root, &f.capture_id, &f.owner).unwrap();
        match durable.publication.map(|publication| publication.state) {
            Some(state) if state == "saved" => assert!(f.destination.is_dir()),
            Some(state) if state == "cancelled" => assert!(!f.destination.exists()),
            None => {
                assert_eq!(durable.state, "cancelled");
                assert!(!f.destination.exists());
            }
            other => panic!("invalid publication cancel/commit winner: {other:?}"),
        }
        fs::remove_dir_all(f.base).unwrap();
    }
}
