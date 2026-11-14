//! Native v2 crypto and filesystem capabilities. Transfer policy lives in TS.
use super::*;
const V2_DOMAIN: &[u8] = b"apparent-encrypted-v2\0signed-envelope\0";
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IndexedAsset {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub object: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Index {
    pub version: u32,
    pub context: Context,
    pub files: Vec<IndexedAsset>,
}
fn signed_bytes(signed: &Signed) -> Result<Vec<u8>> {
    let mut b = V2_DOMAIN.to_vec();
    b.extend(serde_json::to_vec(signed)?);
    Ok(b)
}
fn object_path(path: &str) -> bool {
    path == "sealed/index.age"
        || path
            .strip_prefix("sealed/file-")
            .and_then(|p| p.strip_suffix(".age"))
            .is_some_and(|s| s.len() == 6 && s.bytes().all(|b| b.is_ascii_digit()))
}
pub(in super::super) fn validate_transport(files: &[Asset]) -> Result<()> {
    ensure!(
        (3..=514).contains(&files.len()),
        "invalid_encryption_manifest"
    );
    let mut names = BTreeSet::new();
    let mut total = 0u64;
    for f in files {
        ensure!(
            names.insert(&f.path)
                && super::super::hex_digest(&f.sha256)
                && f.size > 0
                && f.size <= super::super::MAX_FILE_BYTES
                && (f.path == "envelope.json" || object_path(&f.path)),
            "invalid_encryption_manifest"
        );
        total = total.checked_add(f.size).context("quota_exceeded")?;
    }
    ensure!(
        total <= MAX_BYTES
            && files
                .iter()
                .any(|f| f.path == "envelope.json" && f.size <= JSON_BYTES)
            && files
                .iter()
                .any(|f| f.path == "sealed/index.age" && f.size <= 262144),
        "invalid_encryption_manifest"
    );
    for i in 0..files.len() - 2 {
        ensure!(
            names.contains(&format!("sealed/file-{i:06}.age")),
            "invalid_encryption_manifest"
        );
    }
    Ok(())
}
fn encrypt(
    source: &mut impl Read,
    path: &Path,
    recipients: &[age::x25519::Recipient],
) -> Result<Asset> {
    let encryptor =
        age::Encryptor::with_recipients(recipients.iter().map(|r| r as &dyn age::Recipient))
            .map_err(|_| anyhow::anyhow!("encryption_failed"))?;
    let mut encrypted = encryptor.wrap_output(new_private_file(path)?)?;
    io::copy(source, &mut encrypted)?;
    let file = encrypted.finish()?;
    file.sync_all()?;
    let size = file.metadata()?.len();
    ensure!(size <= super::super::MAX_FILE_BYTES, "file_too_large");
    Ok(Asset {
        path: String::new(),
        size,
        sha256: digest_file(path)?,
    })
}
pub(in super::super) fn pack(
    stage: &Path,
    spool: &Path,
    context: &Context,
    identity: &Identity,
    recipients: &[Peer],
) -> Result<Vec<Asset>> {
    context_valid(context)?;
    ensure!(
        !recipients.is_empty() && recipients.len() <= 64,
        "invalid_encryption_recipients"
    );
    let mut keys = BTreeSet::new();
    let mut parsed = Vec::new();
    for peer in recipients {
        let (key, _) = public_key(&peer.key)?;
        if keys.insert(key.to_string()) {
            parsed.push(key);
        }
    }
    let ordinary = stage_assets(stage)?;
    empty_private(spool)?;
    private_dir(&spool.join("sealed"))?;
    let mut chunks = Vec::new();
    let mut entries = Vec::new();
    for (i, asset) in ordinary.iter().enumerate() {
        let object = format!("sealed/file-{i:06}.age");
        let mut source = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(stage.join(&asset.path))?;
        ensure!(
            source.metadata()?.len() == asset.size,
            "encryption_source_changed"
        );
        let mut encrypted = encrypt(
            &mut (&mut source).take(asset.size + 1),
            &spool.join(&object),
            &parsed,
        )?;
        encrypted.path = object.clone();
        ensure!(
            source.metadata()?.len() == asset.size
                && digest_file(&stage.join(&asset.path))? == asset.sha256,
            "encryption_source_changed"
        );
        chunks.push(encrypted);
        entries.push(IndexedAsset {
            path: asset.path.clone(),
            size: asset.size,
            sha256: asset.sha256.clone(),
            object,
        });
    }
    let index = Index {
        version: 2,
        context: context.clone(),
        files: entries,
    };
    let bytes = Zeroizing::new(serde_json::to_vec(&index)?);
    ensure!(bytes.len() as u64 <= JSON_BYTES, "invalid_manifest");
    let mut encrypted = encrypt(
        &mut io::Cursor::new(&*bytes),
        &spool.join("sealed/index.age"),
        &parsed,
    )?;
    encrypted.path = "sealed/index.age".into();
    chunks.push(encrypted);
    chunks.sort_by(|a, b| a.path.cmp(&b.path));
    let signed = Signed {
        version: 2,
        context: context.clone(),
        chunks: chunks.clone(),
    };
    let signature = hex(&identity.signing.sign(&signed_bytes(&signed)?).to_bytes());
    let bytes = serde_json::to_vec(&Envelope { signed, signature })?;
    ensure!(
        bytes.len() as u64 <= JSON_BYTES,
        "invalid_encryption_envelope"
    );
    let mut file = new_private_file(&spool.join("envelope.json"))?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    chunks.insert(
        0,
        Asset {
            path: "envelope.json".into(),
            size: bytes.len() as u64,
            sha256: digest_file(&spool.join("envelope.json"))?,
        },
    );
    validate_transport(&chunks)?;
    File::open(spool.join("sealed"))?.sync_all()?;
    File::open(spool)?.sync_all()?;
    Ok(chunks)
}
fn decrypt(
    spool: &Path,
    asset: &Asset,
    identity: &Identity,
    output: &mut impl Write,
    limit: u64,
) -> Result<()> {
    ensure!(object_path(&asset.path), "invalid_encryption_manifest");
    let path = spool.join(&asset.path);
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&path)?;
    ensure!(
        file.metadata()?.len() == asset.size && digest_file(&path)? == asset.sha256,
        "encryption_ciphertext_mismatch"
    );
    let header = bounded_header(&mut file)?;
    let decryptor = age::Decryptor::new(io::Cursor::new(header).chain(file))
        .map_err(|_| anyhow::anyhow!("encryption_decrypt_failed"))?;
    let mut plain = decryptor
        .decrypt(std::iter::once(&identity.age as &dyn age::Identity))
        .map_err(|_| anyhow::anyhow!("encryption_decrypt_failed"))?;
    let size = io::copy(&mut (&mut plain).take(limit + 1), output)?;
    ensure!(size <= limit, "encryption_plaintext_mismatch");
    let mut tail = [0];
    ensure!(
        plain.read(&mut tail)? == 0,
        "encryption_archive_trailing_data"
    );
    Ok(())
}
pub(in super::super) fn open_index(
    spool: &Path,
    files: &[Asset],
    context: &Context,
    identity: &Identity,
    sender: &Peer,
) -> Result<Index> {
    validate_transport(files)?;
    context_valid(context)?;
    let envelope_file = files
        .iter()
        .find(|f| f.path == "envelope.json")
        .context("invalid_encryption_manifest")?;
    ensure!(
        digest_file(&spool.join("envelope.json"))? == envelope_file.sha256,
        "encryption_ciphertext_mismatch"
    );
    let envelope: Envelope =
        serde_json::from_slice(&read_private(&spool.join("envelope.json"), JSON_BYTES)?)?;
    ensure!(
        envelope.signed.version == 2
            && &envelope.signed.context == context
            && sender.scope == "upload"
            && sender.grant_id == context.sender_grant_id,
        "encryption_context_mismatch"
    );
    let (_, key) = public_key(&sender.key)?;
    key.verify_strict(
        &signed_bytes(&envelope.signed)?,
        &Signature::from_bytes(&unhex::<64>(&envelope.signature)?),
    )
    .map_err(|_| anyhow::anyhow!("encryption_signature_invalid"))?;
    let mut actual = files
        .iter()
        .filter(|f| f.path != "envelope.json")
        .cloned()
        .collect::<Vec<_>>();
    actual.sort_by(|a, b| a.path.cmp(&b.path));
    ensure!(
        serde_json::to_value(&actual)? == serde_json::to_value(&envelope.signed.chunks)?,
        "encryption_manifest_mismatch"
    );
    let mut bytes = Zeroizing::new(Vec::new());
    decrypt(
        spool,
        actual
            .iter()
            .find(|f| f.path == "sealed/index.age")
            .unwrap(),
        identity,
        &mut *bytes,
        JSON_BYTES,
    )?;
    let index: Index = serde_json::from_slice(&bytes)?;
    ensure!(
        index.version == 2 && &index.context == context && index.files.len() <= MAX_FILES,
        "invalid_encryption_manifest"
    );
    Ok(index)
}
pub(in super::super) fn context(spool: &Path) -> Result<Context> {
    let e: Envelope =
        serde_json::from_slice(&read_private(&spool.join("envelope.json"), JSON_BYTES)?)?;
    Ok(e.signed.context)
}
pub(in super::super) fn unpack_file(
    spool: &Path,
    output: &Path,
    entry: &IndexedAsset,
    files: &[Asset],
    identity: &Identity,
) -> Result<()> {
    ensure!(
        super::super::asset_path(&entry.path) && entry.size <= super::super::MAX_FILE_BYTES,
        "invalid_encryption_manifest"
    );
    let asset = files
        .iter()
        .find(|f| f.path == entry.object)
        .context("invalid_encryption_manifest")?;
    let destination = output.join(&entry.path);
    private_dir(destination.parent().context("invalid_path")?)?;
    let mut file = new_private_file(&destination)?;
    decrypt(spool, asset, identity, &mut file, entry.size)?;
    file.sync_all()?;
    ensure!(
        file.metadata()?.len() == entry.size && digest_file(&destination)? == entry.sha256,
        "encryption_plaintext_mismatch"
    );
    Ok(())
}
