//! Application resource adapter for Agent's published-Engine frame workflow.
use crate::shared::model::RgbaFrame;
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{
    ffi::CString,
    fs::{File, OpenOptions},
    io::Read,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    },
    path::Path,
    process::Command,
    time::Duration,
};

const SAFE_TIME: u64 = 9_007_199_254_740_991;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
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

pub(crate) fn frames(
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
        "Invalid Agent frame request"
    );
    let (node, worker, engine) =
        super::worker::assets("Agent media", "agent-media", "apparent-engine-frames")?;
    let movie = std::fs::canonicalize(movie).context("Could not locate Agent movie")?;
    let alias = if movie.to_str().is_none() {
        Some(super::worker::private_movie_alias(&movie)?)
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
    let bytes = super::worker::run(
        Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(worker)
            .arg(engine)
            .arg(input)
            .arg(output.path())
            .arg(video_offset_ms.to_string())
            .arg(max_edge.to_string())
            .arg(
                times
                    .iter()
                    .map(u64::to_string)
                    .collect::<Vec<_>>()
                    .join(","),
            ),
        Duration::from_secs(305),
    )?;
    read_frames(output.path(), &directory, &bytes, times, max_edge)
}

fn read_frames(
    output: &Path,
    directory: &File,
    bytes: &[u8],
    times: &[u64],
    max_edge: u32,
) -> Result<Vec<RgbaFrame>> {
    let identity = directory.metadata()?;
    let reply: Reply = serde_json::from_slice(bytes).context("Invalid Agent frame response")?;
    ensure!(
        reply.version == 1 && reply.frames.len() == times.len(),
        "Incomplete Agent frames"
    );
    let current = std::fs::symlink_metadata(output)?;
    ensure!(
        current.is_dir()
            && current.dev() == identity.dev()
            && current.ino() == identity.ino()
            && current.uid() == unsafe { libc::geteuid() }
            && current.mode() & 0o777 == 0o700,
        "Agent output directory changed"
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
            "Invalid Agent frame identity or dimensions"
        );
        let name = CString::new(name).unwrap();
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        ensure!(fd >= 0, "Missing private Agent frame");
        let mut file = unsafe { File::from_raw_fd(fd) };
        let metadata = file.metadata()?;
        let size = count * 4;
        ensure!(
            metadata.is_file()
                && metadata.uid() == unsafe { libc::geteuid() }
                && metadata.mode() & 0o777 == 0o600
                && metadata.nlink() == 1
                && metadata.len() == size,
            "Unsafe Agent frame file"
        );
        let mut rgba = Vec::with_capacity(size as usize);
        (&mut file).take(size + 1).read_to_end(&mut rgba)?;
        ensure!(
            rgba.len() as u64 == size && file.metadata()?.len() == size,
            "Incomplete Agent frame pixels"
        );
        // Agent's TypeScript mapping owns the bundle clock. Never choose a
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
        "Unexpected Agent output files"
    );
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn real_published_bridge_matches_retained_decoder_with_observed_latency() {
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
        // Avoid the known old offset-clamping ambiguity for this comparison.
        // package.ts separately checks distinct clamped bundle identities.
        let times = [500, 700, 900, 1100, 1300, 1500];
        let mut observations = Vec::new();
        for trial in 0..3 {
            // Alternate order; this remains a tiny warm-fixture observation,
            // not a controlled benchmark or an independent-build speedup claim.
            for published in if trial % 2 == 0 {
                [false, true]
            } else {
                [true, false]
            } {
                let started = std::time::Instant::now();
                let decoded = if published {
                    frames(&movie, &times, 500, 900)
                } else {
                    crate::capture::engine::bundle::bundle_processing::movie_frames_at(
                        &movie, &times, 500, 900,
                    )
                }
                .unwrap();
                observations.push((published, started.elapsed().as_micros()));
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
            }
        }
        eprintln!(
            "Agent six-frame latency observations (published, microseconds): {observations:?}"
        );
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
