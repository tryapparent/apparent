//! Narrow Storage transaction executor; Settings policy and persistence intent live in TypeScript.
use crate::shared::handoff::{capture_location, edit_preference, update_config_allowed_in};
use std::hash::{Hash, Hasher};
use crate::capture::engine::bundle::retention::{BUNDLE_DAYS, MEDIA_DAYS, Policy};
use crate::capture::engine::bundle::retention::folder_usage::scan_directory;
use crate::composition::retention::{MAXIMUM_MB, remove_empty_legacy_retention};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

fn field(value: Option<serde_json::Value>) -> serde_json::Value {
    serde_json::json!({"present":value.is_some(),"value":value})
}

fn revision(raw: &serde_json::Value) -> String {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    raw.get("retention").is_some().hash(&mut hash);
    for key in ["retention", "storage"] {
        let group = raw.get(key);
        group.is_some_and(|value| !value.is_object()).hash(&mut hash);
        for field in ["mediaDays", "bundleDays", "maximumMb"] {
            group.and_then(|value| value.get(field))
                .map(serde_json::Value::to_string)
                .hash(&mut hash);
        }
    }
    format!("{:016x}", hash.finish())
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SavePolicy {
    #[serde(rename = "mediaDays")]
    pub(super) media_days: serde_json::Value,
    #[serde(rename = "bundleDays")]
    pub(super) bundle_days: serde_json::Value,
}

impl SavePolicy {
    pub(super) fn valid(&self) -> bool {
        let valid = |days: &serde_json::Value| {
            days.is_null() || days.as_u64().is_some_and(|n| n <= u32::MAX as u64)
        };
        valid(&self.media_days) && valid(&self.bundle_days)
    }
}

pub(in crate::capture::desktop) fn read(config: &Path) -> Result<serde_json::Value, &'static str> {
    let raw = capture_location::read_raw(config).map_err(|_| "config_read_failed")?;
    let [media_days, bundle_days] = Policy::saved_fields(&raw).map(field);
    let custom = ["retention", "storage"].into_iter().any(|group|
        ["mediaDays", "bundleDays"].into_iter().any(|key| raw[group].get(key).is_some()));
    Ok(serde_json::json!({
        "retention": {"mediaDays":media_days,"bundleDays":bundle_days},
        "defaults": Policy::default(),
        "revision": revision(&raw),
        "maximumMb": crate::composition::retention::storage_limit(&raw),
        "custom": custom,
    }))
}

pub(super) fn save_policy(
    config: &Path,
    policy: Option<&SavePolicy>,
    expected: &str,
    admit: impl Fn() -> bool,
) -> Result<serde_json::Value, &'static str> {
    update_policy(config, policy, None, expected, admit)
}

pub(super) fn save_limit(
    config: &Path, maximum_mb: u32, expected: &str, admit: impl Fn() -> bool,
) -> Result<serde_json::Value, &'static str> {
    update_policy(config, None, Some(maximum_mb), expected, admit)
}

fn update_policy(
    config: &Path,
    policy: Option<&SavePolicy>,
    maximum_mb: Option<u32>,
    expected: &str,
    admit: impl Fn() -> bool,
) -> Result<serde_json::Value, &'static str> {
    if policy.is_some_and(|p| !p.valid()) || maximum_mb.is_some_and(|mb| mb > crate::composition::retention::MAX_STORAGE_MB) {
        return Err("invalid_request");
    }
    let mut refusal = None;
    update_config_allowed_in(config, &admit, |raw| {
        if !admit() {
            refusal = Some("admission_expired");
            anyhow::bail!("expired");
        }
        if revision(raw) != expected {
            refusal = Some("conflict");
            anyhow::bail!("conflict");
        }
        if raw
            .get("retention")
            .is_some_and(|value| !value.is_object())
        {
            refusal = Some("config_write_failed");
            anyhow::bail!("invalid retention object");
        }
        if let Some(maximum_mb) = maximum_mb {
            edit_preference(raw, MAXIMUM_MB, Some(maximum_mb.into()))?;
        } else {
            edit_preference(raw, MAXIMUM_MB, None)?;
            edit_preference(raw, MEDIA_DAYS, policy.map(|policy| policy.media_days.clone()))?;
            edit_preference(raw, BUNDLE_DAYS, policy.map(|policy| policy.bundle_days.clone()))?;
        }
        remove_empty_legacy_retention(raw);
        Ok(())
    })
    .map_err(|error| {
        if error.is::<crate::shared::handoff::ConfigPublicationUncertain>() { return "outcome_unknown"; }
        refusal.unwrap_or_else(|| if !admit() { "admission_expired" } else { "config_write_failed" })
    })?;
    // Same timing as legacy Settings: schedule the existing worker, never run cleanup here.
    crate::capture::engine::bundle::retention::nudge();
    read(config)
}

pub(in crate::capture::desktop) fn usage(
    config: &Path,
    admit: impl Fn() -> bool,
) -> Result<serde_json::Value, &'static str> {
    let before = capture_location::read_in(config).map_err(|_| "config_read_failed")?;
    let root = Path::new(&before.effective_path);
    let opened = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(root);
    let (bytes, identity) = match opened {
        Ok(file) => {
            let meta = file.metadata().map_err(|_| "usage_unavailable")?;
            (
                scan_directory(file, &admit, &mut 0, 0)?,
                Some((meta.dev(), meta.ino())),
            )
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (0, None),
        Err(_) => return Err("usage_unavailable"),
    };
    let current = std::fs::symlink_metadata(root)
        .ok()
        .map(|m| (m.dev(), m.ino()));
    if current != identity {
        return Err("conflict");
    }
    let after = capture_location::read_in(config).map_err(|_| "config_read_failed")?;
    if before.revision != after.revision || before.effective_path != after.effective_path {
        return Err("conflict");
    }
    Ok(serde_json::json!({"usage": {
        "effectivePath": after.effective_path,
        "displayPath": after.display_path,
        "formatted": crate::capture::engine::bundle::retention::format_bytes(bytes),
        "bytes": bytes.to_string(),
    }}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unset_storage_limit_reads_one_gigabyte() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("config.json");
        assert_eq!(read(&config).unwrap()["maximumMb"], 1000);
        assert!(!config.exists());
        std::fs::write(&config, r#"{"storageFixture":true}"#).unwrap();
        assert_eq!(read(&config).unwrap()["maximumMb"], 1000);
    }

    #[test]
    fn malformed_known_retention_values_use_week_defaults_without_echoing_them() {
        let root = std::env::temp_dir().join(format!("retention-{}", crate::shared::ids::make_bundle_id()));
        std::fs::create_dir(&root).unwrap();
        let config = root.join("config.json");
        std::fs::write(&config, r#"{"secret":"keep","retention":{"mediaDays":"private-invalid","bundleDays":90,"unknown":true}}"#).unwrap();
        let read = read(&config).unwrap();
        assert_eq!(read["retention"]["mediaDays"], serde_json::json!({"present":false,"value":null}));
        assert_eq!(read["retention"]["bundleDays"], serde_json::json!({"present":false,"value":null}));
        assert_eq!(read["custom"], true);
        assert_eq!(read["defaults"], serde_json::to_value(crate::capture::engine::bundle::retention::Policy::default()).unwrap());
        assert!(read.to_string().find("private-invalid").is_none());
        assert_eq!(crate::capture::engine::bundle::retention::Policy::load_from(&config), Default::default());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn save_limit_preserves_age_configuration_and_uses_the_same_revision() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("config.json");
        std::fs::write(&config, r#"{"retention":{"mediaDays":30,"bundleDays":90,"future":true},"other":"keep"}"#).unwrap();
        let previous = read(&config).unwrap();
        let revision = previous["revision"].as_str().unwrap();
        assert!(previous["maximumMb"].is_null());
        let committed = save_limit(&config, 12_400, revision, || true).unwrap();
        assert_eq!(committed["maximumMb"], 12_400);
        assert_eq!(save_limit(&config, 0, revision, || true), Err("conflict"));
        let actual = capture_location::read_raw(&config).unwrap();
        assert_eq!(actual["retention"], serde_json::json!({"mediaDays":30,"bundleDays":90,"maximumMb":12400,"future":true}));
        assert_eq!(actual["storage"]["maximumMb"], 12_400);
        assert_eq!(actual["other"], "keep");
        let committed = save_limit(&config, 0, committed["revision"].as_str().unwrap(), || true).unwrap();
        assert_eq!(committed["maximumMb"], 0);
    }

    #[test]
    fn usage_pins_directories_and_never_follows_replaced_paths_or_child_links() {
        let root =
            std::env::temp_dir().join(format!("usage-{}", crate::shared::ids::make_bundle_id()));
        let captures = root.join("captures");
        let outside = root.join("outside");
        std::fs::create_dir_all(&captures).unwrap();
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(captures.join("keep"), b"123").unwrap();
        std::fs::write(outside.join("private"), vec![0; 1_000_000]).unwrap();
        std::os::unix::fs::symlink(&outside, captures.join("link")).unwrap();
        let link_size = std::fs::symlink_metadata(captures.join("link"))
            .unwrap()
            .len();
        let pinned = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(&captures)
            .unwrap();
        // Replace the pathname after opening. The actual traversal must stay on
        // the original directory, not follow the newly substituted symlink.
        std::fs::rename(&captures, root.join("moved")).unwrap();
        std::os::unix::fs::symlink(&outside, &captures).unwrap();
        assert_eq!(
            scan_directory(pinned, &|| true, &mut 0, 0),
            Ok(3 + link_size)
        );
        let denied = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(&captures);
        assert!(denied.is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
