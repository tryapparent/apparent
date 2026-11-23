//! Finite, read-only Record retention planning over native observations.
use crate::capture::engine::bundle::retention::Policy;
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{path::Path, process::Command, time::Duration};

pub(crate) const MAX_STORAGE_MB: u32 = 99_999_999;
include!(concat!(env!("OUT_DIR"), "/storage-default.rs"));

pub(crate) fn storage_limit(config: &serde_json::Value) -> Option<u32> {
    let retention = config.get("retention");
    match retention.and_then(|settings| settings.get("maximumMb")) {
        Some(value) => value.as_u64().and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value <= MAX_STORAGE_MB),
        None => DEFAULT_STORAGE_LIMIT_MB[usize::from(retention.is_some())],
    }
}

pub(crate) fn configured_storage_limit(path: &Path) -> Result<Option<u32>> {
    let raw = crate::shared::handoff::capture_location::read_raw(path)?;
    let limit = storage_limit(&raw);
    ensure!(limit.is_some() || raw["retention"].get("maximumMb").is_none(), "Invalid saved storage limit");
    Ok(limit)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Facts {
    pub age_ms: String,
    pub unchanged_ms: String,
    pub source: Option<String>,
    pub capture: Option<String>,
    pub duration_ms: String,
    pub video_bytes: Option<String>,
    pub heavy_media: bool,
}
#[derive(Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Kind {
    TrashMedia,
    TrashBundle,
    Shrink,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Decision {
    pub index: usize,
    pub kind: Kind,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Response {
    version: u8,
    actions: Vec<Decision>,
}
#[derive(Serialize)]
struct Request<'a> {
    version: u8,
    mode: &'a str,
    policy: &'a Policy,
    observations: &'a [Facts],
    #[serde(skip_serializing_if = "Option::is_none")]
    capacity: Option<Capacity<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Capacity<'a> {
    pub maximum_mb: u32,
    pub total: String,
    pub sizes: &'a [String],
}

fn decode(bytes: &[u8], count: usize, ordered: bool) -> Result<Vec<Decision>> {
    let response: Response =
        serde_json::from_slice(bytes).context("Invalid Record retention plan")?;
    ensure!(response.version == 1, "Invalid Record retention plan");
    let mut previous = None;
    let mut seen = std::collections::BTreeSet::new();
    for action in &response.actions {
        ensure!(
            action.index < count && seen.insert(action.index) && (!ordered || previous.is_none_or(|index| index < action.index)),
            "Invalid Record retention identity"
        );
        previous = Some(action.index);
    }
    Ok(response.actions)
}

pub(crate) fn plan(
    policy: &Policy,
    observations: &[Facts],
    shrink_only: bool,
) -> Result<Vec<Decision>> {
    plan_with_capacity(policy, observations, shrink_only, None)
}

pub(crate) fn plan_with_capacity(
    policy: &Policy,
    observations: &[Facts],
    shrink_only: bool,
    capacity: Option<Capacity<'_>>,
) -> Result<Vec<Decision>> {
    if observations.is_empty() {
        return Ok(Vec::new());
    }
    let ordered = capacity.is_none();
    let bytes = serde_json::to_vec(&Request {
        version: 1,
        mode: if shrink_only { "shrinkOnly" } else { "pass" },
        policy,
        observations,
        capacity,
    })?;
    ensure!(
        bytes.len() <= 16 * 1024 * 1024,
        "Record retention request exceeds its resource limit"
    );
    let input = super::worker::private_input(&bytes)?;
    let (node, worker) = super::worker::policy_assets(
        "Record Storage",
        "storage-owner",
        "cleanup-policy/retention/worker.js",
    )?;
    let output = super::worker::run_with_input(
        Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(worker),
        input,
        Duration::from_secs(10),
        16 * 1024 * 1024,
    )?;
    decode(&output, observations.len(), ordered)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decisions_are_versioned_unique_ordered_and_bound_to_observed_indices() {
        let result = decode(
            br#"{"version":1,"actions":[{"index":1,"kind":"trashMedia"}]}"#,
            2,
            true,
        )
        .unwrap();
        assert_eq!(result[0].kind, Kind::TrashMedia);
        for bad in [
            br#"{"version":2,"actions":[]}"#.as_slice(),
            br#"{"version":1,"actions":[{"index":2,"kind":"shrink"}]}"#,
            br#"{"version":1,"actions":[{"index":1,"kind":"shrink"},{"index":1,"kind":"shrink"}]}"#,
            br#"{"version":1,"actions":[{"index":0,"kind":"unknown"}]}"#,
            br#"{"version":1,"actions":[],"extra":true}"#,
        ] {
            assert!(decode(bad, 2, true).is_err());
        }
    }
}
