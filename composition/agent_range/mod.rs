//! Agent-owned range policy; composition only validates the finite wire reply.
use anyhow::{Context, Result, bail, ensure};
use serde::Deserialize;
use std::{process::Command, time::Duration};

pub(crate) struct FrameRangePlan {
    pub fps: u32,
    pub step_ms: u64,
    pub lower_ms: u64,
    pub upper_ms: u64,
}

#[derive(Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Reply {
    Plan {
        version: u8,
        from_ms: String,
        to_ms: String,
        fps: u32,
        step_ms: String,
        lower_ms: String,
        upper_ms: String,
    },
    Error {
        version: u8,
        message: String,
    },
}

fn decode(bytes: &[u8], from: u64, to: u64, requested_fps: Option<u32>) -> Result<FrameRangePlan> {
    let reply: Reply = serde_json::from_slice(bytes).context("Invalid Agent frame range plan")?;
    match reply {
        Reply::Error { version, message } => {
            ensure!(
                version == 1 && message.len() <= 128 && !message.chars().any(char::is_control),
                "Invalid Agent frame range error"
            );
            bail!("{message}")
        }
        Reply::Plan {
            version,
            from_ms,
            to_ms,
            fps,
            step_ms,
            lower_ms,
            upper_ms,
        } => {
            let parse = |value: String| {
                value
                    .parse::<u64>()
                    .context("Invalid Agent frame range clock")
            };
            let (from_ms, to_ms, step_ms, lower_ms, upper_ms) = (
                parse(from_ms)?,
                parse(to_ms)?,
                parse(step_ms)?,
                parse(lower_ms)?,
                parse(upper_ms)?,
            );
            ensure!(
                version == 1
                    && from_ms == from
                    && to_ms == to
                    && from_ms <= to_ms
                    && fps > 0
                    && fps <= 240
                    && step_ms > 0
                    && lower_ms <= from
                    && upper_ms >= to
                    && requested_fps.is_none_or(|value| fps == value),
                "Invalid Agent frame range identity"
            );
            Ok(FrameRangePlan {
                fps,
                step_ms,
                lower_ms,
                upper_ms,
            })
        }
    }
}

pub(crate) fn plan(from: u64, to: u64, fps: Option<u32>) -> Result<FrameRangePlan> {
    let (node, worker) =
        super::worker::policy_assets("Agent range", "agent-media", "range-worker.js")?;
    let bytes = super::worker::run(
        Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(worker)
            .arg(from.to_string())
            .arg(to.to_string())
            .arg(fps.map_or_else(|| "-".into(), |value| value.to_string())),
        Duration::from_secs(5),
        1024,
    )?;
    decode(&bytes, from, to, fps)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plan_is_versioned_and_bound_to_the_request_without_native_defaults() {
        let good = br#"{"version":1,"status":"plan","fromMs":"0","toMs":"1000","fps":4,"stepMs":"250","lowerMs":"0","upperMs":"1125"}"#;
        assert_eq!(decode(good, 0, 1000, None).unwrap().fps, 4);
        assert!(decode(good, 1, 1000, None).is_err());
        assert!(decode(good, 0, 999, None).is_err());
        assert!(decode(good, 0, 1000, Some(7)).is_err());
        for (from, to) in [
            ("\"version\":1", "\"version\":2"),
            ("\"stepMs\":\"250\"", "\"stepMs\":\"0\""),
            ("\"upperMs\":\"1125\"", "\"upperMs\":\"999\""),
            ("\"fps\":4", "\"fps\":0"),
            ("\"fps\":4", "\"fps\":241"),
        ] {
            let bad = String::from_utf8_lossy(good).replace(from, to);
            assert!(decode(bad.as_bytes(), 0, 1000, None).is_err());
        }
        let reversed = String::from_utf8_lossy(good)
            .replace("\"fromMs\":\"0\"", "\"fromMs\":\"1000\"")
            .replace("\"toMs\":\"1000\"", "\"toMs\":\"0\"");
        assert!(decode(reversed.as_bytes(), 1000, 0, None).is_err());
        let exact = br#"{"version":1,"status":"plan","fromMs":"18446744073709551615","toMs":"18446744073709551615","fps":7,"stepMs":"142","lowerMs":"18446744073709551544","upperMs":"18446744073709551615"}"#;
        assert_eq!(
            decode(exact, u64::MAX, u64::MAX, Some(7)).unwrap().upper_ms,
            u64::MAX
        );
    }
}
