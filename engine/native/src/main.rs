//! A single finite native operation. Exec keeps cancellation addressed to the
//! actual media reader, with no intermediary process left owning a child.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
compile_error!("Engine supports Linux and macOS only");

use std::os::unix::process::CommandExt;
use std::path::Path;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::process::Command;

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() == 1 && args[0] == "--version" {
        println!("apparent-engine-media {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if args.len() != 2 || args[0] != "probe-v1" {
        return Err("usage: apparent-engine-media probe-v1 /absolute/movie".into());
    }
    let movie = Path::new(&args[1]);
    if !movie.is_absolute() || !movie.is_file() {
        return Err("probe-v1 requires an existing absolute local file".into());
    }
    let mut command = reader()?;
    command.arg(movie);
    Err(format!(
        "native movie reader unavailable: {}",
        command.exec().kind()
    ))
}

#[cfg(target_os = "linux")]
fn reader() -> Result<Command, String> {
    // FFprobe is an explicit Linux runtime prerequisite, as for existing export.
    // A file cannot turn into an HTTP request or an arbitrary input protocol.
    let mut command = Command::new("ffprobe");
    command.args([
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-show_entries",
        "format=duration:stream=index,codec_type,width,height,avg_frame_rate,duration,start_time:stream_side_data=displaymatrix",
        "-of",
        "json",
        "-i",
    ]);
    Ok(command)
}

#[cfg(target_os = "macos")]
fn reader() -> Result<Command, String> {
    let executable: PathBuf = std::env::current_exe().map_err(|_| "cannot locate Engine")?;
    let sibling = executable
        .parent()
        .ok_or("cannot locate Engine directory")?
        .join("apparent-engine-probe");
    Ok(Command::new(sibling))
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
