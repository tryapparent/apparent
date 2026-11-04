use anyhow::{Context, Result, ensure};
use std::{fs::{File, OpenOptions}, path::Path, os::{fd::AsRawFd, unix::fs::{MetadataExt, OpenOptionsExt}}};

pub(super) fn acquire(installation: &Path) -> Result<File> {
    ensure!(!installation.symlink_metadata().is_ok_and(|m| m.file_type().is_symlink()), "Symlink installation");
    let parent = installation.parent().context("Installation parent missing")?.canonicalize()?;
    let mut name = std::ffi::OsString::from(".");
    name.push(installation.file_name().context("Installation name missing")?);
    name.push(".recipient.lock");
    let path = parent.join(name);
    let file = OpenOptions::new().read(true).write(true).create(true).mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK).open(path)?;
    let m = file.metadata()?;
    ensure!(m.is_file() && m.uid() == unsafe { libc::geteuid() } && m.mode() & 0o7777 == 0o600 && m.nlink() == 1, "Unsafe installation lock");
    ensure!(unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_SH | libc::LOCK_NB) } == 0, "Installation busy");
    Ok(file)
}

pub(super) fn for_root(root: &Path) -> Result<Option<File>> {
    let directory = root.parent().context("Package directory missing")?;
    if directory.file_name().is_some_and(|s| s == "MacOS") && directory.parent().is_some_and(|p| p.file_name().is_some_and(|s| s == "Contents")) {
        acquire(directory.parent().unwrap().parent().context("App directory missing")?).map(Some)
    } else {
        // Linux's updater exchanges the outer image; it never mutates this tree.
        // A mounted AppImage is read-only: do not create a lock inside usr/.
        Ok(None)
    }
}
