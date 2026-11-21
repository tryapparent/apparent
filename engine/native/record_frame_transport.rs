use super::{Frame, Reply, RgbaFrame, SAFE_TIME, read_reply};
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{fs::{File, OpenOptions}, os::unix::fs::{OpenOptionsExt, PermissionsExt}, path::Path, process::Command, time::Duration};

pub(super) fn record_movie_times(times: &[u64], offset: u64) -> Option<Vec<u64>> {
    let input = serde_json::to_vec(&(times, offset)).ok()?;
    let output = super::super::record_policy::evaluate("nativeMovieClock", &input, 2048)?;
    let request: Vec<u64> = serde_json::from_str(&output).ok()?;
    (request.len() == times.len() && request.iter().all(|time| *time <= SAFE_TIME))
        .then_some(request)
}

pub(super) fn direct_record(
    movie: &Path,
    times: &[u64],
    movie_times: &[u64],
    max_edge: u32,
) -> Result<Vec<RgbaFrame>> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct EngineReply {
        version: u32,
        frames: Vec<EngineFrame>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct EngineFrame {
        request_index: usize,
        requested_ms: u64,
        actual_ms: i64,
        width: u32,
        height: u32,
        file: String,
    }
    ensure!(max_edge <= 16384, "Invalid movie frame request");
    let started = std::time::Instant::now();
    let (_, _, engine) = super::super::worker::assets(
        "Record media", "record-media", "apparent-engine-frames", "frames-worker.js",
    )?;
    let stamps = movie_times.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
    let (output, directory, bytes) = run_frame_command(movie, Duration::from_secs(300), |input, output| {
        let mut command = Command::new(engine);
        command.arg("frames-v1").arg(input).arg(output).arg(max_edge.to_string()).arg(stamps);
        command
    })?;
    let raw: EngineReply = serde_json::from_slice(&bytes).context("Invalid Engine frame response")?;
    ensure!(raw.frames.len() == movie_times.len(), "Incomplete Engine frames");
    let mut frames = Vec::with_capacity(times.len());
    for (index, frame) in raw.frames.into_iter().enumerate() {
        ensure!(frame.request_index == index && frame.requested_ms == movie_times[index],
            "Engine keyframe identities do not match Record");
        frames.push(Frame {
            request_index: frame.request_index,
            requested_ms: times[index],
            actual_movie_ms: frame.actual_ms,
            width: frame.width,
            height: frame.height,
            file: frame.file,
        });
    }
    let decoded = read_reply(output.path(), &directory, Reply { version: raw.version, frames }, times, max_edge)?;
    crate::capture::desktop::start_metric("record_direct_frame_transport_ms", started);
    Ok(decoded)
}

pub(super) fn run_frame_command(
    movie: &Path,
    timeout: Duration,
    create_command: impl FnOnce(&Path, &Path) -> Command,
) -> Result<(tempfile::TempDir, File, Vec<u8>)> {
    let movie = std::fs::canonicalize(movie).context("Could not locate movie")?;
    let alias = if movie.to_str().is_none() {
        Some(super::super::worker::private_movie_alias(&movie)?)
    } else {
        None
    };
    let input = alias
        .as_ref()
        .map(|a| a.path().join("movie.mp4"))
        .unwrap_or(movie);
    let output = tempfile::Builder::new()
        .prefix("apparent-frames-")
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir()?;
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(output.path())?;
    let bytes = super::super::worker::run(
        &mut create_command(&input, output.path()),
        timeout,
        128 * 1024,
    )?;
    Ok((output, directory, bytes))
}

#[cfg(test)]
pub(super) fn assert_matches_packaged(movie: &Path, requested: &[u64], assembled: &[RgbaFrame]) {
    if cfg!(target_os = "linux") {
        assert!(record_movie_times(requested, 500).is_some());
        let packaged = super::adaptive_batches_from(requested, 12, |batch| {
            super::frames("Record media", "record-media", "frames-worker.js", movie, batch, 500, 900)
        }).unwrap();
        for (direct, original) in assembled.iter().zip(&packaged) {
            assert_eq!((direct.t_ms, direct.width, direct.height), (original.t_ms, original.width, original.height));
            assert_eq!(direct.rgba, original.rgba);
        }
    }
}
