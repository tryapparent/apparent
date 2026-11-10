//! Onboarding-scoped leaf CAS on the existing shared durable config executor.
//! No renderer endpoint and no second config writer. The composition layer must
//! supply its live session/transport ownership predicate to every mutation.
use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub(crate) mod observations;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Key {
    TourRevision, Seen, Resume, ShortcutChosen, ShortcutTestedFor, FirstCaptureCompleted,
}
impl Key {
    const ALL: [Self; 6] = [Self::TourRevision, Self::Seen, Self::Resume,
        Self::ShortcutChosen, Self::ShortcutTestedFor, Self::FirstCaptureCompleted];
    fn name(self) -> &'static str {
        match self {
            Self::TourRevision => "tourRevision", Self::Seen => "seen", Self::Resume => "resume",
            Self::ShortcutChosen => "shortcutChosen", Self::ShortcutTestedFor => "shortcutTestedFor",
            Self::FirstCaptureCompleted => "firstCaptureCompleted",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Leaf {
    present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
}
impl<'de> Deserialize<'de> for Leaf {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        let object = value.as_object().ok_or_else(|| serde::de::Error::custom("invalid leaf"))?;
        match object.get("present").and_then(Value::as_bool) {
            Some(false) if object.len() == 1 => Ok(Self { present: false, value: None }),
            Some(true) if object.len() == 2 && object.contains_key("value") =>
                Ok(Self { present: true, value: Some(object["value"].clone()) }),
            _ => Err(serde::de::Error::custom("invalid leaf")),
        }
    }
}
pub(crate) type Snapshot = BTreeMap<Key, Leaf>;

pub(crate) fn snapshot(config: &Value) -> Result<Snapshot> {
    ensure!(config.is_object(), "Invalid config");
    let progress = config.get("onboarding");
    ensure!(progress.is_none_or(Value::is_object), "Invalid onboarding progress");
    Ok(Key::ALL.into_iter().map(|key| {
        let value = progress.and_then(|v| v.get(key.name())).cloned();
        (key, Leaf { present: value.is_some(), value })
    }).collect())
}

pub(crate) fn read(path: &Path) -> Result<Snapshot> {
    let config = match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(e.into()),
    };
    snapshot(&config)
}

/// Compatibility for the not-yet-migrated setup writer. It shares the durable
/// executor and may replace only schema leaves, never future nested values.
pub(crate) fn save_setup_leaves(path: &Path, value: Value) -> Result<()> {
    const KEYS: [&str; 10] = ["tourRevision", "seen", "resume", "granted", "relaunchedAt",
        "reopenFix", "tutorial", "shortcutChosen", "shortcutTestedFor", "firstCaptureCompleted"];
    let leaves = value.as_object().ok_or_else(|| anyhow::anyhow!("Invalid progress leaves"))?;
    ensure!(leaves.keys().all(|key| KEYS.contains(&key.as_str())), "Unknown progress leaf");
    crate::shared::handoff::update_config_in(path, |config| {
        snapshot(config)?;
        let target = config.as_object_mut().unwrap().entry("onboarding")
            .or_insert_with(|| serde_json::json!({})).as_object_mut().unwrap();
        for key in KEYS {
            match leaves.get(key) {
                Some(value) => { target.insert(key.into(), value.clone()); },
                None => { target.remove(key); },
            }
        }
        Ok(())
    })
}

#[derive(Debug)]
pub(crate) struct Conflict;
impl std::fmt::Display for Conflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("Onboarding progress changed") }
}
impl std::error::Error for Conflict {}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CompletionLeaves {
    pub first_capture_completed: bool,
    pub seen: bool,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Removable { Resume }
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Mutation {
    pub expected: Snapshot,
    pub set: CompletionLeaves,
    pub remove: [Removable; 1],
}

pub(crate) fn commit(path: &Path, intent: &Mutation, allowed: &dyn Fn() -> bool) -> Result<()> {
    ensure!(intent.expected.len() == Key::ALL.len(), "Incomplete progress revision");
    crate::shared::handoff::update_config_allowed_in(path, allowed, |config| {
        if snapshot(config)? != intent.expected { return Err(Conflict.into()); }
        let progress = config.as_object_mut().unwrap().entry("onboarding")
            .or_insert_with(|| serde_json::json!({})).as_object_mut().unwrap();
        progress.insert("firstCaptureCompleted".into(), Value::Bool(intent.set.first_capture_completed));
        progress.insert("seen".into(), Value::Bool(intent.set.seen));
        for key in &intent.remove {
            match key { Removable::Resume => { progress.remove("resume"); } }
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    use std::sync::atomic::{AtomicBool, Ordering};
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("apparent-dev-onboarding-cas-{}", crate::shared::ids::make_bundle_id()));
            std::fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> std::path::PathBuf { self.0.join("config.json") }
        fn write(&self, value: &Value) { std::fs::write(self.path(), serde_json::to_vec(value).unwrap()).unwrap(); }
        fn value(&self) -> Value { serde_json::from_slice(&std::fs::read(self.path()).unwrap()).unwrap() }
        fn intent(&self) -> Mutation {
            Mutation { expected: read(&self.path()).unwrap(), set: CompletionLeaves { first_capture_completed: true, seen: true }, remove: [Removable::Resume] }
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

    #[test]
    fn leaf_patch_preserves_unknown_nested_values_and_unrelated_secrets() {
        let f = Fixture::new();
        f.write(&serde_json::json!({"onboarding":{"resume":"try-it","future":{"number":18446744073709551615u64},"granted":["microphone"]},"connect":{"token":"synthetic-secret"}}));
        let intent = f.intent();
        commit(&f.path(), &intent, &|| true).unwrap();
        assert_eq!(f.value(), serde_json::json!({"onboarding":{"seen":true,"firstCaptureCompleted":true,"future":{"number":18446744073709551615u64},"granted":["microphone"]},"connect":{"token":"synthetic-secret"}}));
        assert_eq!(std::fs::metadata(f.path()).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn concurrent_known_leaf_conflicts_but_unknown_leaf_is_preserved() {
        let f = Fixture::new(); f.write(&serde_json::json!({})); let intent = f.intent();
        crate::shared::handoff::update_config_in(&f.path(), |config| { config["onboarding"] = serde_json::json!({"future":null}); Ok(()) }).unwrap();
        commit(&f.path(), &intent, &|| true).unwrap();
        assert_eq!(f.value()["onboarding"]["future"], Value::Null);
        let before = std::fs::read(f.path()).unwrap();
        assert!(commit(&f.path(), &intent, &|| true).unwrap_err().is::<Conflict>());
        assert_eq!(std::fs::read(f.path()).unwrap(), before);
    }

    #[test]
    fn absent_and_null_are_distinct_and_roundtrip_losslessly() {
        let f = Fixture::new(); f.write(&serde_json::json!({})); let intent = f.intent();
        f.write(&serde_json::json!({"onboarding":{"resume":null}}));
        assert!(commit(&f.path(), &intent, &|| true).unwrap_err().is::<Conflict>());
        let value = serde_json::to_value(read(&f.path()).unwrap()).unwrap();
        assert_eq!(value["resume"], serde_json::json!({"present":true,"value":null}));
        assert_eq!(value["seen"], serde_json::json!({"present":false}));
        assert_eq!(serde_json::from_value::<Snapshot>(value).unwrap(), read(&f.path()).unwrap());
    }

    #[test]
    fn closed_schema_cannot_mutate_an_unrelated_key_or_accept_an_incomplete_revision() {
        let f = Fixture::new(); f.write(&serde_json::json!({})); let mut intent = f.intent();
        intent.expected.remove(&Key::Seen);
        assert!(commit(&f.path(), &intent, &|| true).is_err());
        assert!(serde_json::from_value::<Mutation>(serde_json::json!({"expected":{},"set":{"seen":true,"firstCaptureCompleted":true,"token":"forged"},"remove":["resume"]})).is_err());
        assert!(serde_json::from_value::<Leaf>(serde_json::json!({"present":false,"value":null})).is_err());
        assert!(serde_json::from_value::<Leaf>(serde_json::json!({"present":true})).is_err());
        assert_eq!(f.value(), serde_json::json!({}));
    }

    #[test]
    fn session_revocation_before_publication_leaves_the_existing_file_unchanged() {
        let f = Fixture::new(); f.write(&serde_json::json!({"onboarding":{"resume":"try-it"}})); let intent = f.intent();
        let live = AtomicBool::new(true);
        // The executor checks before locking, after the snapshot and before rename.
        let checks = std::cell::Cell::new(0);
        let before = std::fs::read(f.path()).unwrap();
        let allowed = || {
            checks.set(checks.get() + 1);
            if checks.get() == 3 { live.store(false, Ordering::SeqCst); }
            live.load(Ordering::SeqCst)
        };
        assert!(commit(&f.path(), &intent, &allowed).is_err());
        assert!(checks.get() >= 3);
        assert_eq!(std::fs::read(f.path()).unwrap(), before);
    }

    #[test]
    fn malformed_progress_is_not_replaced_by_an_empty_default() {
        let f = Fixture::new(); f.write(&serde_json::json!({})); let intent = f.intent();
        for invalid in [Value::Null, serde_json::json!([]), serde_json::json!("bad")] {
            f.write(&serde_json::json!({"onboarding":invalid})); let before = std::fs::read(f.path()).unwrap();
            assert!(read(&f.path()).is_err()); assert!(commit(&f.path(), &intent, &|| true).is_err());
            assert_eq!(std::fs::read(f.path()).unwrap(), before);
        }
    }

    #[test]
    fn uncertain_publication_has_truthful_readback_without_repeating_the_transaction() {
        let f = Fixture::new(); f.write(&serde_json::json!({})); let intent = f.intent();
        crate::shared::handoff::set_config_directory_sync_failure(true);
        let error = commit(&f.path(), &intent, &|| true).unwrap_err();
        assert!(error.is::<crate::shared::handoff::ConfigPublicationUncertain>());
        let after = read(&f.path()).unwrap();
        assert_eq!(after[&Key::FirstCaptureCompleted].value, Some(Value::Bool(true)));
        assert_eq!(after[&Key::Seen].value, Some(Value::Bool(true)));
    }
}
