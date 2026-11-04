//! Local inspection runs the bundled component, never PATH or a source fallback.
use anyhow::{Context, Result, ensure};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::Command,
};

const PROTOCOL: u64 = 1;
struct Snapshot {
    directory: PathBuf,
    executable: PathBuf,
}
impl Drop for Snapshot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn snapshot(root: &Path) -> Result<Snapshot> {
    let directory = root.parent().context("Missing application directory")?;
    let composition: serde_json::Value = serde_json::from_slice(
        &fs::read(directory.join("inspection-composition.json")).context(
            "Bundled inspection composition missing; reinstall the complete Apparent package",
        )?,
    )?;
    ensure!(
        composition["schema"] == 1
            && composition["compatibility"] == "inspection-host-v1"
            && composition["inspector"]["protocol"] == PROTOCOL,
        "Incompatible inspection composition"
    );
    let component = directory.join("inspection/apparent-inspect");
    let input = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&component)
        .context("Bundled inspector missing")?;
    ensure!(
        input.metadata()?.is_file(),
        "Inspector must be a regular file"
    );
    let mut bytes = Vec::new();
    input.take(32 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    ensure!(
        !bytes.is_empty()
            && bytes.len() <= 32 * 1024 * 1024
            && composition["inspectorRuntimeSha256"].as_str() == Some(digest(&bytes).as_str()),
        "Bundled inspector digest mismatch"
    );
    let target = format!(
        "{}-{}",
        std::env::consts::ARCH,
        if cfg!(target_os = "macos") {
            "apple-darwin"
        } else {
            "unknown-linux-gnu"
        }
    );
    ensure!(
        composition["inspector"]["target"] == target,
        "Bundled inspector target mismatch"
    );
    // Execute the checked byte snapshot, not the mutable installed pathname.
    // The package and its composition receipt are trusted through normal installation/signing.
    // This does not claim isolation from a malicious process running as the same OS user.
    let mut random = [0u8; 16];
    fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
    let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let directory = std::env::temp_dir().join(format!("apparent-inspect-{token}"));
    fs::DirBuilder::new().mode(0o700).create(&directory)?;
    let executable = directory.join("apparent-inspect");
    let snapshot = Snapshot {
        directory,
        executable,
    };
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o500)
        .open(&snapshot.executable)?;
    use std::io::Write;
    output.write_all(&bytes)?;
    output.sync_all()?;
    Ok(snapshot)
}

pub(crate) fn inspect(
    bundle: &Path,
    json: bool,
    marks: bool,
    experiments: &[String],
) -> Result<()> {
    let root = std::env::current_exe()?.canonicalize()?;
    let snapshot = snapshot(&root)?;
    let mut command = Command::new(&snapshot.executable);
    command.arg(bundle);
    if json {
        command.arg("--json");
    }
    if marks {
        command.arg("--marks");
    }
    for experiment in experiments {
        command.args(["--experiment", experiment]);
    }
    if crate::shared::handoff::experiment(crate::shared::handoff::AGENT_CONTEXT) {
        command.args(["--experiment", "agentContext"]);
    }
    let status = command
        .status()
        .context("Could not execute bundled inspector")?;
    drop(snapshot);
    if !status.success() {
        use std::os::unix::process::ExitStatusExt;
        std::process::exit(
            status
                .code()
                .unwrap_or_else(|| 128 + status.signal().unwrap_or(1)),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_replacement_cannot_change_verified_snapshot() {
        let base =
            std::env::temp_dir().join(format!("inspection-snapshot-test-{}", std::process::id()));
        fs::create_dir(&base).unwrap();
        fs::create_dir(base.join("inspection")).unwrap();
        let bytes = fs::read("/usr/bin/true").unwrap();
        fs::write(base.join("inspection/apparent-inspect"), &bytes).unwrap();
        let target = format!(
            "{}-{}",
            std::env::consts::ARCH,
            if cfg!(target_os = "macos") {
                "apple-darwin"
            } else {
                "unknown-linux-gnu"
            }
        );
        let receipt = serde_json::json!({"schema":1,"compatibility":"inspection-host-v1",
            "inspector":{"protocol":1,"target":target},"inspectorRuntimeSha256":digest(&bytes)});
        fs::write(
            base.join("inspection-composition.json"),
            serde_json::to_vec(&receipt).unwrap(),
        )
        .unwrap();
        let prepared = snapshot(&base.join("apparent")).unwrap();
        fs::write(
            base.join("inspection/apparent-inspect"),
            b"replaced after verification",
        )
        .unwrap();
        assert_eq!(fs::read(&prepared.executable).unwrap(), bytes);
        assert!(snapshot(&base.join("apparent")).is_err());
        let private = prepared.directory.clone();
        drop(prepared);
        assert!(!private.exists());
        fs::remove_dir_all(base).unwrap();
    }
}
