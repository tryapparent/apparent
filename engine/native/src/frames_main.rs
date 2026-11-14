//! Finite explicit-time snapshots. Workflow, sampling and crop choices belong to callers.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
compile_error!("Engine supports Linux and macOS only");

#[cfg(target_os = "linux")]
mod frame_linux;
mod frame_output;

use frame_output::{MAX_EDGE, MAX_FRAMES, MAX_TIME, Output, Result};
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

fn run() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() == 1 && args[0] == "--version" {
        println!("apparent-engine-frames {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if args.len() != 5 || args[0] != "frames-v1" {
        return Err("invalid_request");
    }
    let movie = PathBuf::from(&args[1]);
    let destination = PathBuf::from(&args[2]);
    let edge = args[3]
        .to_str()
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or("invalid_request")?;
    let times: Vec<u64> = args[4]
        .to_str()
        .ok_or("invalid_request")?
        .split(',')
        .map(|t| t.parse::<u64>().map_err(|_| "invalid_request"))
        .collect::<Result<_>>()?;
    if !movie.is_absolute()
        || !destination.is_absolute()
        || movie.to_str().is_none()
        || edge > MAX_EDGE
        || times.is_empty()
        || times.len() > MAX_FRAMES
        || times.iter().any(|t| *t > MAX_TIME)
    {
        return Err("invalid_request");
    }
    // Captured MP4/QuickTime files only, never a playlist or a network source.
    // Like probe-v1, this is a trusted local-file capability, not a hostile-codec sandbox.
    let mut source = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(&movie)
        .map_err(|_| "decode_failed")?;
    if !source.metadata().map_err(|_| "decode_failed")?.is_file() {
        return Err("decode_failed");
    }
    let mut header = [0_u8; 8];
    source
        .read_exact(&mut header)
        .map_err(|_| "decode_failed")?;
    match &header[4..8] {
        b"ftyp" | b"moov" | b"mdat" | b"wide" | b"free" | b"skip" | b"pnot" => (),
        _ => return Err("decode_failed"),
    }
    let output = Output::open(&destination)?;
    #[cfg(target_os = "linux")]
    {
        let frames = frame_linux::decode(&movie, &times, edge, output)?;
        let reply = serde_json::json!({"version": 1, "frames": frames});
        println!(
            "{}",
            serde_json::to_string(&reply).map_err(|_| "decode_failed")?
        );
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::process::CommandExt;
        let executable = std::env::current_exe().map_err(|_| "unavailable")?;
        let sibling = executable
            .parent()
            .ok_or("unavailable")?
            .join("apparent-engine-frames-native");
        let fd = output.inherited_fd()?;
        let _error = std::process::Command::new(sibling)
            .arg(movie)
            .arg(fd.to_string())
            .arg(edge.to_string())
            .arg(&args[4])
            .exec();
        Err("unavailable")
    }
}

fn main() {
    if let Err(code) = run() {
        eprintln!("Engine frames: {code}");
        std::process::exit(match code {
            "resource_limit" => 72,
            "unavailable" => 69,
            _ => 1,
        });
    }
}
