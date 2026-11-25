//! Application resources for owners' published-Engine explicit-frame workflows.
use crate::shared::model::RgbaFrame;
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{
    ffi::CString,
    fs::File,
    io::Read,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::MetadataExt,
    },
    path::Path,
    process::Command,
    time::Duration,
};

const SAFE_TIME: u64 = 9_007_199_254_740_991;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Reply {
    version: u32,
    frames: Vec<Frame>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    request_index: usize,
    requested_ms: u64,
    actual_movie_ms: i64,
    width: u32,
    height: u32,
    file: String,
}

pub(crate) fn record(
    movie: &Path,
    times: &[u64],
    offset: u64,
    edge: u32,
) -> Result<Vec<RgbaFrame>> {
    adaptive_batches_from(times, 12, |batch| {
        if let Some(movie_times) = record_movie_times(batch, offset) {
            return direct_record(movie, batch, &movie_times, edge);
        }
        frames(
            "Record media",
            "record-media",
            "frames-worker.js",
            movie,
            batch,
            offset,
            edge,
        )
    })
}

#[path = "../engine/recording/media/frames.rs"]
mod transport;
use transport::{direct_record, record_movie_times, run_frame_command};

pub(crate) fn agent_range(movie: &Path, times: &[u64], offset: u64) -> Result<Vec<RgbaFrame>> {
    adaptive_batches_from(times, 4, |batch| {
        frames(
            "Agent media",
            "agent-media",
            "worker.js",
            movie,
            batch,
            offset,
            0,
        )
    })
}

pub(crate) fn record_phone_candidates(movie: &Path, duration: u64) -> Result<Vec<RgbaFrame>> {
    ensure!(
        duration > 0 && duration <= SAFE_TIME,
        "Invalid phone movie duration"
    );
    let (output, directory, bytes) = frame_response(
        "Record media",
        "record-media",
        "phone-worker.js",
        movie,
        &[duration.to_string()],
    )?;
    let reply: Reply =
        serde_json::from_slice(&bytes).context("Invalid candidate frame response")?;
    let times = candidate_times(&reply)?;
    read_reply(output.path(), &directory, reply, &times, 0)
}

fn candidate_times(reply: &Reply) -> Result<Vec<u64>> {
    ensure!(!reply.frames.is_empty(), "Invalid candidate count");
    sampled_times(reply, 0)
}

pub(super) fn sampled_times(reply: &Reply, offset: u64) -> Result<Vec<u64>> {
    // Finite bridge admission; cadence and duplicate selection belong to Record.
    ensure!(reply.frames.len() <= 512, "Invalid candidate count");
    let mut times = Vec::with_capacity(reply.frames.len());
    for frame in &reply.frames {
        ensure!(
            frame.actual_movie_ms >= 0
                && frame.requested_ms <= SAFE_TIME
                && (frame.actual_movie_ms as u64).checked_add(offset) == Some(frame.requested_ms)
                && times.last().is_none_or(|last| *last < frame.requested_ms),
            "Invalid candidate clock"
        );
        times.push(frame.requested_ms);
    }
    Ok(times)
}

fn adaptive_batches_from(
    times: &[u64],
    initial_limit: usize,
    mut decode: impl FnMut(&[u64]) -> Result<Vec<RgbaFrame>>,
) -> Result<Vec<RgbaFrame>> {
    let mut out = Vec::new();
    let (mut cursor, mut limit) = (0, initial_limit);
    while cursor < times.len() {
        let count = limit.min(times.len() - cursor);
        match decode(&times[cursor..cursor + count]) {
            Ok(decoded) => {
                let pixels = decoded
                    .iter()
                    .map(|f| u64::from(f.width) * u64::from(f.height))
                    .max()
                    .unwrap_or(0);
                ensure!(
                    pixels > 0 && decoded.len() == count,
                    "Incomplete range frame batch"
                );
                limit = ((256 * 1024 * 1024 / pixels) as usize).clamp(1, 48);
                out.extend(decoded);
                cursor += count;
            }
            Err(error)
                if count > 1
                    && error
                        .downcast_ref::<super::worker::WorkerExitError>()
                        .is_some_and(|e| e.code == Some(72)) =>
            {
                // Changed stream dimensions can outgrow the observed budget.
                // Retry only a typed resource limit, after the failed job's
                // process group and private pixels have been cleaned.
                limit = count / 2;
            }
            Err(error) => return Err(error),
        }
    }
    Ok(out)
}

fn frames(
    label: &str,
    package: &str,
    worker_file: &str,
    movie: &Path,
    times: &[u64],
    video_offset_ms: u64,
    max_edge: u32,
) -> Result<Vec<RgbaFrame>> {
    ensure!(
        !times.is_empty()
            && times.len() <= 48
            && video_offset_ms <= SAFE_TIME
            && times.iter().all(|t| *t <= SAFE_TIME)
            && max_edge <= 16384,
        "Invalid movie frame request"
    );
    let arguments = [
        video_offset_ms.to_string(),
        max_edge.to_string(),
        times
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(","),
    ];
    let (output, directory, bytes) =
        frame_response(label, package, worker_file, movie, &arguments)?;
    read_frames(output.path(), &directory, &bytes, times, max_edge)
}

fn frame_response(
    label: &str,
    package: &str,
    worker_file: &str,
    movie: &Path,
    arguments: &[String],
) -> Result<(tempfile::TempDir, File, Vec<u8>)> {
    timed_frame_response(
        label,
        package,
        worker_file,
        movie,
        arguments,
        Duration::from_secs(305),
    )
}

pub(super) fn timed_frame_response(
    label: &str,
    package: &str,
    worker_file: &str,
    movie: &Path,
    arguments: &[String],
    timeout: Duration,
) -> Result<(tempfile::TempDir, File, Vec<u8>)> {
    let (node, worker, engine) =
        super::worker::assets(label, package, "apparent-engine-frames", worker_file)?;
    run_frame_command(movie, timeout, |input, output| {
        let mut command = Command::new(node);
        command
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(worker)
            .arg(engine)
            .arg(input)
            .arg(output)
            .args(arguments);
        command
    })
}

fn read_frames(
    output: &Path,
    directory: &File,
    bytes: &[u8],
    times: &[u64],
    max_edge: u32,
) -> Result<Vec<RgbaFrame>> {
    let reply: Reply = serde_json::from_slice(bytes).context("Invalid movie frame response")?;
    read_reply(output, directory, reply, times, max_edge)
}

pub(super) fn read_reply(
    output: &Path,
    directory: &File,
    reply: Reply,
    times: &[u64],
    max_edge: u32,
) -> Result<Vec<RgbaFrame>> {
    let identity = directory.metadata()?;
    ensure!(
        reply.version == 1 && reply.frames.len() == times.len(),
        "Incomplete movie frames"
    );
    let current = std::fs::symlink_metadata(output)?;
    ensure!(
        current.is_dir()
            && current.dev() == identity.dev()
            && current.ino() == identity.ino()
            && current.uid() == unsafe { libc::geteuid() }
            && current.mode() & 0o777 == 0o700,
        "Movie output directory changed"
    );
    let mut pixels = 0_u64;
    let mut decoded = Vec::with_capacity(times.len());
    for (index, frame) in reply.frames.into_iter().enumerate() {
        let count = u64::from(frame.width) * u64::from(frame.height);
        pixels += count;
        let name = format!("frame-{index:03}.rgba");
        ensure!(
            frame.request_index == index
                && frame.requested_ms == times[index]
                && frame.actual_movie_ms.unsigned_abs() <= SAFE_TIME
                && frame.file == name
                && frame.width > 0
                && frame.height > 0
                && frame.width <= 16384
                && frame.height <= 16384
                && (max_edge == 0 || frame.width.max(frame.height) <= max_edge)
                && count <= 64 * 1024 * 1024
                && pixels <= 256 * 1024 * 1024,
            "Invalid movie frame identity or dimensions"
        );
        let name = CString::new(name).unwrap();
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        ensure!(fd >= 0, "Missing private movie frame");
        let mut file = unsafe { File::from_raw_fd(fd) };
        let metadata = file.metadata()?;
        let size = count * 4;
        ensure!(
            metadata.is_file()
                && metadata.uid() == unsafe { libc::geteuid() }
                && metadata.mode() & 0o777 == 0o600
                && metadata.nlink() == 1
                && metadata.len() == size,
            "Unsafe movie frame file"
        );
        let mut rgba = Vec::with_capacity(size as usize);
        (&mut file).take(size + 1).read_to_end(&mut rgba)?;
        ensure!(
            rgba.len() as u64 == size && file.metadata()?.len() == size,
            "Incomplete movie frame pixels"
        );
        // The owning TypeScript workflow supplies the bundle clock. Never choose a
        // nearest timestamp: offset-clamped requests can share identical pixels.
        decoded.push(RgbaFrame::new(
            frame.requested_ms,
            frame.width,
            frame.height,
            rgba,
        ));
    }
    ensure!(
        std::fs::read_dir(output)?.count() == times.len(),
        "Unexpected movie output files"
    );
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{PermissionsExt, symlink};

    #[test]
    fn candidate_clock_is_actual_unique_and_bounded_before_reading_pixels() {
        let reply = |times: Vec<_>| Reply {
            version: 1,
            frames: times
                .into_iter()
                .enumerate()
                .map(|(index, (requested_ms, actual_movie_ms))| Frame {
                    request_index: index,
                    requested_ms,
                    actual_movie_ms,
                    width: 1,
                    height: 1,
                    file: format!("frame-{index:03}.rgba"),
                })
                .collect(),
        };
        assert_eq!(
            candidate_times(&reply(vec![(0, 0), (200, 200)])).unwrap(),
            [0, 200]
        );
        for invalid in [
            vec![],
            vec![(0, -1)],
            vec![(1, 0)],
            vec![(0, 0), (0, 0)],
            vec![(200, 200), (0, 0)],
            (0..513).zip(0..513).collect(),
        ] {
            assert!(candidate_times(&reply(invalid)).is_err());
        }
    }

    #[test]
    fn resource_backoff_preserves_order_and_does_not_repeat_other_failures() {
        let times = [0, 250, 500, 500, 1000, 1500, 2000, 2500];
        let mut rejected = 0;
        let decoded = adaptive_batches_from(&times, 4, |batch| {
            if batch.len() > 3 {
                rejected += 1;
                return Err(super::super::worker::WorkerExitError { code: Some(72) }.into());
            }
            Ok(batch
                .iter()
                .map(|t| RgbaFrame::new(*t, 1, 1, vec![0, 0, 0, 255]))
                .collect())
        })
        .unwrap();
        assert!(rejected > 0);
        assert_eq!(decoded.iter().map(|f| f.t_ms).collect::<Vec<_>>(), times);
        for code in [Some(1), None] {
            let mut calls = 0;
            assert!(
                adaptive_batches_from(&times, 4, |_| {
                    calls += 1;
                    Err(super::super::worker::WorkerExitError { code }.into())
                })
                .is_err()
            );
            assert_eq!(calls, 1, "only resource limits may repeat");
        }
        let mut calls = 0;
        assert!(
            adaptive_batches_from(&[0], 4, |_| {
                calls += 1;
                Err(super::super::worker::WorkerExitError { code: Some(72) }.into())
            })
            .is_err()
        );
        assert_eq!(calls, 1, "a single-frame resource failure is terminal");
    }

    #[test]
    fn real_published_bridge_preserves_pixels_and_bundle_identity() {
        let fixture = tempfile::tempdir().unwrap();
        let movie = fixture.path().join("synthetic.mp4");
        let encoded = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-nostdin",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x240:r=30:d=2,drawbox=x=160:y=0:w=160:h=240:color=blue:t=fill",
                "-c:v",
                "libx264",
                "-threads",
                "1",
                "-g",
                "30",
                "-bf",
                "3",
                "-pix_fmt",
                "yuv420p",
                "-y",
            ])
            .arg(&movie)
            .output()
            .unwrap();
        assert!(encoded.status.success());
        let source = std::fs::read(&movie).unwrap();
        // Exercise ordinary offset mapping alongside the clamped requests below.
        // package.ts separately checks distinct clamped bundle identities.
        let times = [500, 700, 900, 1100, 1300, 1500];
        let requested = [0, 250, 500, 625, 750, 875, 1000, 1000, 1100, 1150, 1200, 1250, 1300];
        let assembled = record(&movie, &requested, 500, 900).unwrap();
        assert_eq!(
            assembled.iter().map(|f| f.t_ms).collect::<Vec<_>>(),
            requested
        );
        assert!(assembled.iter().all(|f| (f.width, f.height) == (320, 240)));
        transport::assert_matches_packaged(&movie, &requested, &assembled);
        let decoded = record(&movie, &times, 500, 900).unwrap();
        assert_eq!(decoded.len(), times.len());
        for (frame, time) in decoded.iter().zip(times) {
            assert_eq!(frame.t_ms, time);
            assert_eq!((frame.width, frame.height), (320, 240));
            for (x, channel) in [(80, 0), (240, 2)] {
                let at = (120 * 320 + x) * 4;
                assert!(
                    u16::from(frame.rgba[at + channel])
                        > u16::from(frame.rgba[at + (2 - channel)]) + 40
                );
            }
        }
        assert_eq!(std::fs::read(movie).unwrap(), source);
    }

    fn reply() -> serde_json::Value {
        serde_json::json!({"version":1,"frames":[{"requestIndex":0,"requestedMs":250,
            "actualMovieMs":0,"width":1,"height":1,"file":"frame-000.rgba"}]})
    }

    #[test]
    fn private_pixels_keep_bundle_identity_and_reject_malformed_contracts() {
        let output = tempfile::Builder::new()
            .permissions(std::fs::Permissions::from_mode(0o700))
            .tempdir()
            .unwrap();
        let directory = File::open(output.path()).unwrap();
        let file = output.path().join("frame-000.rgba");
        std::fs::write(&file, [255, 0, 0, 255]).unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        let decode = |value: serde_json::Value| {
            read_frames(
                output.path(),
                &directory,
                &serde_json::to_vec(&value).unwrap(),
                &[250],
                1,
            )
        };
        let frames = decode(reply()).unwrap();
        assert_eq!(frames[0].t_ms, 250);
        assert_eq!(frames[0].rgba, [255, 0, 0, 255]);
        for (key, value) in [
            ("requestIndex", serde_json::json!(1)),
            ("requestedMs", serde_json::json!(0)),
            ("file", serde_json::json!("../private")),
            ("width", serde_json::json!(0)),
            ("height", serde_json::json!(2)),
        ] {
            let mut bad = reply();
            bad["frames"][0][key] = value;
            assert!(decode(bad).is_err(), "must reject {key}");
        }
        assert!(decode(serde_json::json!({"version":1,"frames":[]})).is_err());
        std::fs::write(&file, [255, 0, 0]).unwrap();
        assert!(decode(reply()).is_err());
    }

    #[test]
    fn output_cannot_read_symlinks_or_hardlinks_to_other_private_files() {
        let secret = tempfile::tempdir().unwrap();
        let source = secret.path().join("private");
        std::fs::write(&source, [42, 43, 44, 45]).unwrap();
        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o600)).unwrap();
        for hard in [false, true] {
            let output = tempfile::Builder::new()
                .permissions(std::fs::Permissions::from_mode(0o700))
                .tempdir()
                .unwrap();
            let directory = File::open(output.path()).unwrap();
            let target = output.path().join("frame-000.rgba");
            if hard {
                std::fs::hard_link(&source, &target).unwrap();
            } else {
                symlink(&source, &target).unwrap();
            }
            assert!(
                read_frames(
                    output.path(),
                    &directory,
                    &serde_json::to_vec(&reply()).unwrap(),
                    &[250],
                    1
                )
                .is_err()
            );
        }
        assert_eq!(std::fs::read(source).unwrap(), [42, 43, 44, 45]);
    }
}
