//! Native DTO boundary for Record's finite movie-metadata workflows.
//! Record owns interpretation; the application worker adapter owns processes and cleanup.
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{path::Path, process::Command, time::Duration};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExportProbe {
    version: u32,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub audio_tracks: u32,
    pub embedded_audio: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BundleProbe {
    pub(crate) version: u32,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub audio_tracks: u32,
}

fn request(movie: &Path, operation: &str) -> Result<Vec<u8>> {
    let (node, worker, engine) = super::worker::assets(
        "Record media",
        "record-media",
        "apparent-engine-media",
        "worker.js",
    )?;
    let movie = std::fs::canonicalize(movie).context("Could not locate export movie")?;
    // Node's argv is UTF-8. Preserve Unix filenames losslessly through a private
    // read-only alias rather than passing a replacement-character path to the SDK.
    let alias = if movie.to_str().is_none() {
        Some(super::worker::private_movie_alias(&movie)?)
    } else {
        None
    };
    let input = alias
        .as_ref()
        .map(|directory| directory.path().join("movie.mp4"))
        .unwrap_or(movie);
    super::worker::run(
        Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(worker)
            .arg(engine)
            .arg(input)
            .arg(operation),
        Duration::from_secs(35),
        32 * 1024,
    )
}

pub(crate) fn bundle_probe(movie: &Path) -> Result<BundleProbe> {
    let bytes = request(movie, "bundle-v1")?;
    let result: BundleProbe =
        serde_json::from_slice(&bytes).context("Invalid Record bundle metadata")?;
    ensure!(
        result.version == 1
            && result.duration_ms > 0
            && result.width > 0
            && result.height > 0
            && result.fps.is_finite()
            && result.fps >= 0.0
            && result.audio_tracks <= 1024,
        "Invalid Record bundle metadata"
    );
    Ok(result)
}

pub(crate) fn probe(movie: &Path) -> Result<ExportProbe> {
    let bytes = request(movie, "export-v1")?;
    let result: ExportProbe =
        serde_json::from_slice(&bytes).context("Invalid Record media result")?;
    ensure!(
        result.version == 1
            && result.duration_ms > 0
            && result.width > 0
            && result.height > 0
            && result.fps.is_finite()
            && result.fps >= 0.0
            && result.audio_tracks <= 1024
            && (result.audio_tracks == 0) == result.embedded_audio.is_none(),
        "Invalid Record export metadata"
    );
    Ok(result)
}
