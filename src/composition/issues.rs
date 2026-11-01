//! Explicit, text-only GitHub feedback. Never reads captures, config secrets or logs.
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result, ensure};
use clap::Args;
use serde_json::{Value, json};

const REPO: &str = "tryapparent/apparent";
const MAX_BODY: usize = 60_000;

#[derive(Args)]
#[command(after_help = "Examples:\n  apparent issue --title 'Improve zoom help' --body 'Explain the time syntax.'\n  apparent issue --title 'Improve zoom help' --body-file feedback.md --submit\n\nDefault: print a JSON preview without contacting GitHub. --submit publishes publicly\nusing gh's github.com login. Review the exact repository, title and body with the\nuser before submitting on their behalf. No files or diagnostics are attached.\nRequires the default-off issueReporting experiment; --experiment issueReporting\nenables it for this invocation only. See desktop/docs/issue-reporting.md.")]
pub(crate) struct IssueArgs {
    /// Short issue title.
    #[arg(long)]
    title: String,
    /// Exact public issue description (Markdown).
    #[arg(long, required_unless_present = "body_file", conflicts_with = "body_file")]
    body: Option<String>,
    /// Read the exact description from a UTF-8 text file (not uploaded as an attachment).
    #[arg(long, value_name = "PATH")]
    body_file: Option<PathBuf>,
    /// Publish to tryapparent/apparent. Without this flag, no network or login is needed.
    #[arg(long)]
    submit: bool,
    /// Enable the candidate for this invocation without changing preferences.
    #[arg(long, value_parser = ["issueReporting"])]
    experiment: Option<String>,
}

pub(crate) fn command(args: IssueArgs) -> Result<()> {
    if let Some(name) = &args.experiment {
        crate::shared::handoff::enable_experiment(name);
    }
    ensure!(crate::shared::handoff::experiment("issueReporting"),
        "issue reporting is experimental; rerun with --experiment issueReporting (nothing sent)");
    let body = match args.body {
        Some(body) => body,
        None => {
            use std::io::Read;
            let path = args.body_file.context("provide --body or --body-file")?;
            let mut options = std::fs::OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                // Opening a FIFO must not wait for a writer before the regular-file check.
                options.custom_flags(libc::O_NONBLOCK);
            }
            let file = options.open(&path)
                .with_context(|| format!("could not read {} (nothing sent)", path.display()))?;
            ensure!(file.metadata()?.is_file(), "--body-file must be a regular text file (nothing sent)");
            let mut body = String::new();
            file.take(MAX_BODY as u64 + 1).read_to_string(&mut body)
                .context("--body-file must contain UTF-8 text (nothing sent)")?;
            body
        }
    };
    validate(&args.title, &body)?;
    let result = if args.submit {
        submit(&args.title, &body)?
    } else {
        json!({"repository": REPO, "title": args.title, "body": body, "submitted": false})
    };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

fn validate(title: &str, body: &str) -> Result<()> {
    ensure!(!title.trim().is_empty() && title.chars().count() <= 256
        && !title.chars().any(char::is_control),
        "title must be 1–256 characters with no control characters (nothing sent)");
    ensure!(!body.trim().is_empty() && body.len() <= MAX_BODY && !body.contains('\0'),
        "body must be nonempty UTF-8 text, at most 60000 bytes, without NUL (nothing sent)");
    Ok(())
}

fn gh(args: &[&str]) -> Result<String> {
    let mut command = Command::new("gh");
    command.args(args).env("GH_HOST", "github.com")
        .env("GH_PROMPT_DISABLED", "1").env("GH_PAGER", "cat");
    let output = run_gh(&mut command, Duration::from_secs(30))
        .context("gh could not complete within its output/time limits; install GitHub CLI and run `gh auth login --hostname github.com`. If submission was attempted, check https://github.com/tryapparent/apparent/issues before retrying; it may already exist")?;
    ensure!(output.status.success(),
        "GitHub CLI failed ({}). Check `gh auth status --hostname github.com` and repository access. If submission was attempted, check https://github.com/tryapparent/apparent/issues before retrying; it may already exist",
        output.status);
    // Do not echo gh stderr: it may include private request data or credentials.
    String::from_utf8(output.stdout).context("GitHub CLI returned non-UTF-8 output")
}

/// Drain only stdout without blocking. stderr goes directly to /dev/null: it is
/// neither retained in memory nor echoed. A descendant holding stdout cannot
/// extend the deadline. Limit returned JSON independently from its body size.
fn run_gh(command: &mut Command, timeout: Duration) -> Result<std::process::Output> {
    use std::io::{ErrorKind, Read};
    use std::os::fd::AsRawFd;
    use std::os::unix::process::CommandExt;
    use std::process::Stdio;
    use std::time::Instant;

    struct Running(std::process::Child, bool);
    impl Drop for Running {
        fn drop(&mut self) {
            if !self.1 {
                // Only this invocation's process group, never the agent's shell.
                unsafe { libc::kill(-(self.0.id() as i32), libc::SIGKILL); }
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
    }

    let deadline = Instant::now() + timeout;
    let mut child = Running(command.process_group(0).stdin(Stdio::null())
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?, false);
    let mut pipe = child.0.stdout.take().context("missing GitHub output pipe")?;
    let fd = pipe.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    ensure!(flags >= 0 && unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } >= 0,
        "could not make GitHub output nonblocking");
    let mut stdout = Vec::new();
    let mut eof = false;
    loop {
        ensure!(Instant::now() < deadline, "GitHub CLI exceeded its deadline");
        if !eof {
            let mut buffer = [0; 8192];
            match pipe.read(&mut buffer) {
                Ok(0) => eof = true,
                Ok(n) => {
                    ensure!(stdout.len() + n <= 512 * 1024, "GitHub output exceeded 512 KiB");
                    stdout.extend_from_slice(&buffer[..n]);
                    // Check the deadline between reads, even for continuous output.
                    continue;
                }
                Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {}
                Err(error) => return Err(error.into()),
            }
        }
        // Do not reap while a pipe is open: the unreaped leader reserves its
        // PID/PGID until timeout cleanup can no longer signal that group.
        if eof && let Some(status) = child.0.try_wait()? {
            child.1 = true;
            // Disarm cleanup before any fallible work after reaping. The PID
            // is no longer ours once try_wait returns an exit status.
            ensure!(Instant::now() < deadline, "GitHub CLI exceeded its deadline");
            return Ok(std::process::Output { status, stdout, stderr: Vec::new() });
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn issue_number(url: &str) -> Result<&str> {
    let number = url.strip_prefix("https://github.com/tryapparent/apparent/issues/")
        .context("GitHub returned an unexpected issue URL; check the repository before retrying")?;
    ensure!(!number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()) && !number.starts_with('0'),
        "GitHub returned an invalid issue URL; check the repository before retrying");
    Ok(number)
}

fn submit(title: &str, body: &str) -> Result<Value> {
    let output = gh(&["issue", "create", "--repo", REPO, "--title", title, "--body", body])?;
    let url = output.trim();
    let number: u64 = issue_number(url)?.parse()
        .context("GitHub returned an invalid issue number; check the repository before retrying")?;
    let readback = gh(&["issue", "view", url, "--repo", REPO, "--json", "url,number,title,body"])
        .with_context(|| format!("issue may have been created at {url}, but readback failed; inspect it before retrying"))?;
    let issue: Value = serde_json::from_str(&readback)
        .with_context(|| format!("invalid readback for {url}; inspect it before retrying"))?;
    ensure!(issue["url"] == url && issue["title"] == title && issue["body"] == body
        && issue["number"].as_u64() == Some(number),
        "issue exists at {url}, but readback did not match the submitted text; inspect it before retrying");
    Ok(json!({"repository": REPO, "title": title, "body": body, "submitted": true,
        "url": url, "number": issue["number"]}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser)]
    struct TestCli { #[command(flatten)] args: IssueArgs }

    #[test]
    fn preview_is_default_and_inputs_are_explicit() {
        let parsed = TestCli::try_parse_from(["issue", "--title", "A title", "--body", "Details"]).unwrap();
        assert!(!parsed.args.submit);
        assert!(TestCli::try_parse_from(["issue", "--title", "A title"]).is_err());
        assert!(TestCli::try_parse_from(["issue", "--title", "A", "--body", "B", "--body-file", "x"]).is_err());
        assert!(TestCli::try_parse_from(["issue", "--title", "A", "--body", "B", "--submit=false"]).is_err());
        assert!(TestCli::try_parse_from(["issue", "--title", "A", "--body", "B", "--experiment", "other"]).is_err());
        assert!(TestCli::try_parse_from(["issue", "--title", "A", "--body-file", "a file.md", "--submit"]).unwrap().args.submit);
    }

    #[test]
    fn validates_public_text_and_exact_repository_url() {
        validate("A title", "Markdown\n\nDetails 🐸").unwrap();
        for (title, body) in [(" ", "B"), ("A\nB", "B"), ("A", " "), ("A", "B\0")] {
            assert!(validate(title, body).is_err());
        }
        assert!(validate(&"a".repeat(257), "B").is_err());
        assert!(validate("A", &"b".repeat(MAX_BODY + 1)).is_err());
        assert_eq!(issue_number("https://github.com/tryapparent/apparent/issues/123").unwrap(), "123");
        for url in ["https://evil.test/issues/1", "https://github.com/tryapparent/apparent/issues/", "https://github.com/tryapparent/apparent/issues/01", "https://github.com/tryapparent/apparent/issues/1?x=2"] {
            assert!(issue_number(url).is_err());
        }
    }

    #[test]
    fn gh_deadline_includes_inherited_output_pipes() {
        let mut command = std::process::Command::new("sh");
        command.args(["-c", "sleep 2 & exit 0"]);
        let started = std::time::Instant::now();
        let output = run_gh(&mut command, Duration::from_millis(50));
        assert!(output.is_err(), "a descendant-held pipe must time out, not succeed");
        assert!(started.elapsed() < Duration::from_secs(1), "pipe draining escaped the deadline");
    }

    #[test]
    fn gh_output_is_bounded_and_stderr_is_discarded() {
        let mut flood = Command::new("sh");
        flood.args(["-c", "yes synthetic-output"]);
        let error = run_gh(&mut flood, Duration::from_secs(2)).unwrap_err();
        assert!(error.to_string().contains("512 KiB"), "{error}");
        let mut stderr = Command::new("sh");
        stderr.args(["-c", "printf synthetic-private-stderr >&2; printf ok"]);
        let output = run_gh(&mut stderr, Duration::from_secs(2)).unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"ok");
        assert!(output.stderr.is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn gh_reserves_leader_pid_until_pipe_cleanup_and_kills_descendants() {
        use std::time::Instant;
        let root = std::env::temp_dir().join(format!("issue-pid-{}", crate::shared::ids::make_bundle_id()));
        std::fs::create_dir(&root).unwrap();
        let leader_file = root.join("leader");
        let descendant_file = root.join("descendant");
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 10 & echo $! > \"$2\"; echo $$ > \"$1\"; exit 0", "fixture"])
            .arg(&leader_file).arg(&descendant_file);
        let runner = std::thread::spawn(move || run_gh(&mut command, Duration::from_secs(1)));
        let deadline = Instant::now() + Duration::from_millis(800);
        while !leader_file.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        // Let the command exit and the runner poll while its descendant holds stdout.
        std::thread::sleep(Duration::from_millis(50));
        let leader = std::fs::read_to_string(&leader_file).unwrap();
        let descendant = std::fs::read_to_string(&descendant_file).unwrap();
        let leader_reserved = std::path::Path::new("/proc").join(leader.trim()).exists();
        let result = runner.join().unwrap();
        // SIGKILL delivery is asynchronous. Observe actual disposal within a
        // bounded grace period instead of assuming a scheduler has run it yet.
        let stopped = || match std::fs::read_to_string(format!("/proc/{}/stat", descendant.trim())) {
            Ok(state) => state.split(") ").nth(1).is_some_and(|s| s.starts_with('Z') || s.starts_with('X')),
            Err(error) => error.kind() == std::io::ErrorKind::NotFound,
        };
        let cleanup_deadline = Instant::now() + Duration::from_secs(1);
        while !stopped() && Instant::now() < cleanup_deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        let descendant_stopped = stopped();
        std::fs::remove_dir_all(root).unwrap();
        assert!(result.is_err());
        assert!(leader_reserved, "leader was reaped before pipe cleanup, allowing PID reuse");
        assert!(descendant_stopped, "owned descendant survived timeout cleanup");
    }
}
