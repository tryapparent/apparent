#[cfg(not(any(target_os = "linux", target_os = "macos")))]
compile_error!("Engine supports Linux and macOS only");

#[cfg(target_os = "macos")]
#[path = "audio_macos/aac_reader.rs"]
mod aac_reader;
#[cfg(target_os = "macos")]
#[path = "audio_macos/aac_stream.rs"]
mod aac_stream;
#[cfg(any(test, target_os = "macos"))]
mod audio_clock;
#[cfg(target_os = "linux")]
mod audio_linux;
#[cfg(any(test, target_os = "macos"))]
mod audio_mix;
#[cfg(target_os = "linux")]
mod audio_tracks;
#[cfg(target_os = "macos")]
#[path = "audio_macos/clock.rs"]
mod clock;
mod output;
#[cfg(target_os = "macos")]
#[path = "audio_macos/pcm.rs"]
mod pcm;
#[cfg(target_os = "macos")]
#[path = "audio_macos/resample.rs"]
mod resample;
#[cfg(target_os = "macos")]
#[path = "audio_macos/selected.rs"]
mod selected;
use output::{Directory, Result};
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

const MAX_SAMPLES: u64 = 1_u64 << 31;

fn run() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() == 1 && args[0] == "--version" {
        println!("apparent-engine-audio {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if args.len() != 5 || args[0] != "audio-v1" {
        return Err("invalid_request");
    }
    let movie = PathBuf::from(&args[1]);
    let directory = PathBuf::from(&args[2]);
    let samples = args[3]
        .to_str()
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or("invalid_request")?;
    let streams: Vec<u32> = args[4]
        .to_str()
        .ok_or("invalid_request")?
        .split(',')
        .map(|s| s.parse().map_err(|_| "invalid_request"))
        .collect::<Result<_>>()?;
    if !movie.is_absolute()
        || movie.to_str().is_none()
        || !directory.is_absolute()
        || !(1..=MAX_SAMPLES).contains(&samples)
        || streams.is_empty()
        || streams.len() > 1024
        || streams
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != streams.len()
    {
        return Err("invalid_request");
    }
    let mut source = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(&movie)
        .map_err(|_| "decode_failed")?;
    if !source.metadata().map_err(|_| "decode_failed")?.is_file() {
        return Err("decode_failed");
    }
    let mut header = [0; 8];
    source
        .read_exact(&mut header)
        .map_err(|_| "decode_failed")?;
    match &header[4..8] {
        b"ftyp" | b"moov" | b"mdat" | b"wide" | b"free" | b"skip" | b"pnot" => (),
        _ => return Err("decode_failed"),
    }
    let output = Directory::open(&directory)?;
    let mut file = output.create_private("audio.pcm")?;
    let no_core = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &no_core) } != 0 {
        return Err("unavailable");
    }
    #[cfg(target_os = "linux")]
    return audio_linux::decode(&source, &mut file, samples, &streams);
    #[cfg(target_os = "macos")]
    {
        let path = movie.to_str().ok_or("invalid_request")?;
        let indices: Vec<_> = streams.into_iter().map(|stream| stream as usize).collect();
        selected::decode(path, &indices, samples, &mut file).map(|_| ())
    }
}

fn main() {
    if let Err(code) = run() {
        eprintln!("Engine audio: {code}");
        std::process::exit(match code {
            "unavailable" => 69,
            "resource_limit" => 72,
            _ => 1,
        });
    }
}
