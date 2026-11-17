//! Application-owned process/resources for finite headless product workers.
//! Owners supply packaged capabilities; this module has no workflow or config policy.
use anyhow::{Context, Result, ensure};
use std::{
    io::{ErrorKind, Read, Seek, SeekFrom, Write},
    os::{
        fd::AsRawFd,
        unix::{fs::PermissionsExt, process::CommandExt},
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Debug)]
pub(crate) struct WorkerExitError {
    pub(crate) code: Option<i32>,
}
impl std::fmt::Display for WorkerExitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Headless worker failed")
    }
}
impl std::error::Error for WorkerExitError {}

fn candidates(package: &str) -> Result<Vec<(PathBuf, PathBuf)>> {
    let executable = std::env::current_exe()?;
    let parent = executable
        .parent()
        .context("Missing application directory")?;
    #[cfg(target_os = "macos")]
    let settings = parent
        .parent()
        .context("Missing app bundle")?
        .join("Resources/settings");
    #[cfg(target_os = "linux")]
    let settings = parent
        .parent()
        .context("Missing app prefix")?
        .join("share/apparent/settings");
    let mut roots = vec![(settings.join("app"), settings.join("runtime"))];
    if cfg!(any(test, debug_assertions)) {
        let frontend =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend");
        roots.push((
            frontend.clone(),
            frontend.join("node_modules/electron/dist"),
        ));
    }
    Ok(roots.into_iter().map(|(app, runtime)| {
        #[cfg(target_os = "macos")]
        let node = runtime.join("Electron.app/Contents/MacOS/Electron");
        #[cfg(target_os = "linux")]
        let node = runtime.join("electron");
        let root = app.join("electron").join(package);
        (node, root)
    }).collect())
}

pub(crate) fn policy_assets(label: &str, package: &str, worker_file: &str) -> Result<(PathBuf, PathBuf)> {
    for (node, root) in candidates(package)? {
        let worker = root.join(worker_file);
        if node.is_file() && worker.is_file() {
            return Ok((node, worker));
        }
    }
    anyhow::bail!("Packaged {label} unavailable; prepare application assets or reinstall the complete app")
}

pub(crate) fn assets(
    label: &str,
    package: &str,
    capability: &str,
    worker_file: &str,
) -> Result<(PathBuf, PathBuf, PathBuf)> {
    for (node, root) in candidates(package)? {
        let worker = root.join(worker_file);
        let engine = root.join("native").join(capability);
        if node.is_file() && worker.is_file() && engine.is_file() {
            return Ok((node, worker, engine));
        }
    }
    anyhow::bail!(
        "Packaged {label}/Engine unavailable; prepare native prerequisites or reinstall the complete app"
    )
}

pub(crate) fn private_movie_alias(movie: &Path) -> Result<tempfile::TempDir> {
    let directory = tempfile::Builder::new()
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir()
        .context("Could not prepare media path")?;
    std::os::unix::fs::symlink(movie, directory.path().join("movie.mp4"))?;
    Ok(directory)
}

/// Keep the leader unreaped until its whole group is cleaned. A reader that
/// inherits stdout cannot extend the deadline, and a reused PID is never signalled.
pub(crate) fn run(command: &mut Command, timeout: Duration, max_output: usize) -> Result<Vec<u8>> {
    ensure!(
        (1..=128 * 1024).contains(&max_output),
        "Invalid worker output budget"
    );
    run_bounded(command.stdin(Stdio::null()), timeout, max_output)
}

/// Prepare a bounded held input whose privacy does not depend on process umask.
pub(crate) fn private_input(bytes: &[u8]) -> Result<std::fs::File> {
    ensure!(bytes.len() <= 16 * 1024 * 1024, "Invalid worker input budget");
    let mut input = tempfile::tempfile().context("Could not prepare private worker input")?;
    // tempfile() can inherit 0666 masked by the caller's umask. Make the held
    // inode private before writing text, including with umask 000 or 022.
    input.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    input.write_all(bytes)?;
    input.seek(SeekFrom::Start(0))?;
    Ok(input)
}

/// A held finite file carries private text without argv, pipe-writer deadlocks,
/// or a child reopening a mutable pathname. Existing small-reply callers keep
/// their original budget; only this explicit entrypoint permits larger replies.
pub(crate) fn run_with_input(
    command: &mut Command,
    input: std::fs::File,
    timeout: Duration,
    max_output: usize,
) -> Result<Vec<u8>> {
    let metadata = input.metadata()?;
    ensure!(metadata.is_file() && metadata.len() <= 16 * 1024 * 1024,
        "Invalid worker input budget");
    ensure!((1..=16 * 1024 * 1024).contains(&max_output), "Invalid worker output budget");
    run_bounded(command.stdin(Stdio::from(input)), timeout, max_output)
}

fn run_bounded(command: &mut Command, timeout: Duration, max_output: usize) -> Result<Vec<u8>> {
    struct Running {
        child: Child,
        armed: bool,
    }
    impl Drop for Running {
        fn drop(&mut self) {
            if self.armed {
                unsafe {
                    libc::killpg(self.child.id() as libc::pid_t, libc::SIGKILL);
                }
                let _ = self.child.wait();
            }
        }
    }
    let deadline = Instant::now() + timeout;
    let mut running = Running {
        child: command
            .process_group(0)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .context("Headless worker unavailable")?,
        armed: true,
    };
    let mut pipe = running
        .child
        .stdout
        .take()
        .context("Missing worker output")?;
    let fd = pipe.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    ensure!(
        flags >= 0 && unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } >= 0,
        "Could not bound worker output"
    );
    let mut output = Vec::new();
    let mut eof = false;
    loop {
        ensure!(
            Instant::now() < deadline,
            "Headless worker deadline exceeded"
        );
        if !eof {
            let mut chunk = [0; 8192];
            match pipe.read(&mut chunk) {
                Ok(0) => eof = true,
                Ok(n) => {
                    ensure!(
                        output.len() + n <= max_output,
                        "Headless worker output exceeded its limit"
                    );
                    output.extend_from_slice(&chunk[..n]);
                }
                Err(error)
                    if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {}
                Err(error) => return Err(error.into()),
            }
        }
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let observed = unsafe {
            libc::waitid(
                libc::P_PID,
                running.child.id() as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if observed != 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == ErrorKind::Interrupted {
                continue;
            }
            // Losing child ownership means its PID/PGID can no longer be used.
            running.armed = false;
            return Err(error.into());
        }
        if eof && unsafe { info.si_pid() } != 0 {
            unsafe {
                libc::killpg(running.child.id() as libc::pid_t, libc::SIGKILL);
            }
            let status = running.child.wait();
            running.armed = false;
            let status = status?;
            if !status.success() {
                return Err(WorkerExitError {
                    code: status.code(),
                }
                .into());
            }
            return Ok(output);
        }
        if eof {
            std::thread::sleep(Duration::from_millis(5));
        } else {
            let mut poll = libc::pollfd {
                fd,
                events: libc::POLLIN,
                revents: 0,
            };
            unsafe {
                libc::poll(&mut poll, 1, 5);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn held_input_supports_bounded_text_replies_without_widening_small_worker_budgets() {
        let bytes = vec![b'x'; 256 * 1024];
        let file = private_input(&bytes).unwrap();
        assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o600);
        let result = run_with_input(&mut Command::new("/bin/cat"), file, Duration::from_secs(2), bytes.len()).unwrap();
        assert_eq!(result, bytes);
        let oversized = tempfile::tempfile().unwrap();
        oversized.set_len(16*1024*1024+1).unwrap();
        assert!(run_with_input(&mut Command::new("/bin/cat"), oversized, Duration::from_secs(2), 1024).is_err());
    }

    #[test]
    fn media_alias_is_private_and_preserves_filename_bytes() {
        use std::os::unix::ffi::OsStringExt;
        let source = PathBuf::from(std::ffi::OsString::from_vec(
            b"/synthetic/non-utf8-\xff.mp4".to_vec(),
        ));
        let alias = private_movie_alias(&source).unwrap();
        assert_eq!(
            std::fs::metadata(alias.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::read_link(alias.path().join("movie.mp4")).unwrap(),
            source
        );
    }
    #[test]
    fn finite_output_is_returned_only_after_successful_exit() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "printf '{\"version\":1}'"]);
        assert_eq!(
            run(&mut command, Duration::from_secs(2), 32 * 1024).unwrap(),
            b"{\"version\":1}"
        );
        let mut failed = Command::new("/bin/sh");
        failed.args(["-c", "printf partial; exit 7"]);
        let error = run(&mut failed, Duration::from_secs(2), 32 * 1024).unwrap_err();
        assert_eq!(
            error.downcast_ref::<WorkerExitError>().unwrap().code,
            Some(7)
        );
    }
    #[test]
    fn reader_and_descendant_cannot_hold_the_parent_past_its_deadline() {
        let directory = tempfile::tempdir().unwrap();
        let effect = directory.path().join("forbidden");
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "(sleep 0.3; touch \"$1\") & wait", "record-test"])
            .arg(&effect);
        let started = Instant::now();
        assert!(run(&mut command, Duration::from_millis(50), 32 * 1024).is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
        std::thread::sleep(Duration::from_millis(400));
        assert!(
            !effect.exists(),
            "descendant must be killed before it can perform a late write"
        );
    }
    #[test]
    fn continuous_output_is_bounded_independently_of_time() {
        for limit in [32 * 1024, 128 * 1024] {
            let mut command = Command::new("/bin/sh");
            command.args([
                "-c",
                "while :; do printf '1234567890123456789012345678901234567890'; done",
            ]);
            assert!(
                run(&mut command, Duration::from_secs(2), limit)
                    .unwrap_err()
                    .to_string()
                    .contains("output exceeded")
            );
        }
    }
    #[test]
    fn finite_frame_envelope_fits_without_widening_metadata_or_unbounded_output() {
        for (limit, admitted) in [(32 * 1024, false), (128 * 1024, true)] {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "printf '%65536s' ''"]);
            let result = run(&mut command, Duration::from_secs(2), limit);
            if admitted {
                assert_eq!(result.unwrap().len(), 65536);
            } else {
                assert!(result.unwrap_err().to_string().contains("output exceeded"));
            }
        }
        for invalid in [0, 128 * 1024 + 1] {
            let mut unavailable = Command::new("/does-not-exist");
            assert!(
                run(&mut unavailable, Duration::from_secs(2), invalid)
                    .unwrap_err()
                    .to_string()
                    .contains("Invalid worker output budget")
            );
        }
    }
}
