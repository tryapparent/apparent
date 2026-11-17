//! Native admission and replacement of one bundle-owned media file.
use anyhow::{Context, Result, ensure};
use std::ffi::{CString, OsStr, OsString};
use std::fs::{File, Metadata, OpenOptions};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};

#[derive(PartialEq, Eq)]
struct Identity(u64, u64);
fn identity(metadata: &Metadata) -> Identity {
    Identity(metadata.dev(), metadata.ino())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{PermissionsExt, symlink};

    #[test]
    fn staging_is_private_with_permissive_umask() {
        const CHILD: &str = "APPARENT_RETENTION_STAGE_TEST_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let name = concat!(module_path!(), "::staging_is_private_with_permissive_umask");
            let name = name.split_once("::").unwrap().1;
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", name, "--nocapture"])
                .env(CHILD, "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
            return;
        }
        // SAFETY: only this isolated child changes its process-wide umask.
        unsafe {
            libc::umask(0);
        }
        let root = tempfile::Builder::new()
            .permissions(std::fs::Permissions::from_mode(0o700))
            .tempdir()
            .unwrap();
        let staged = stage(&root.path().join("capture.apparent")).unwrap();
        assert_eq!(staged.path().metadata().unwrap().mode() & 0o777, 0o700);
        assert!(
            staged
                .path()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .ends_with(".shrinking.mov")
        );
        std::fs::write(staged.path().join("video.mov"), b"synthetic").unwrap();
        assert_eq!(staged.path().metadata().unwrap().mode() & 0o777, 0o700);
    }

    fn fixture() -> (tempfile::TempDir, PathBuf, tempfile::TempDir) {
        let root = tempfile::tempdir().unwrap();
        let bundle = root.path().join("capture.apparent");
        std::fs::create_dir_all(bundle.join("media")).unwrap();
        std::fs::write(bundle.join("media/video.mov"), b"original video").unwrap();
        let staged = tempfile::tempdir_in(root.path()).unwrap();
        std::fs::write(staged.path().join("video.mov"), b"small").unwrap();
        (root, bundle, staged)
    }

    #[test]
    fn admits_nested_regular_media_and_replaces_it_preserving_permissions() {
        let (_root, bundle, staged) = fixture();
        let path = bundle.join("media/video.mov");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        let video = Video::open(&bundle, Path::new("media/video.mov")).unwrap();
        assert_eq!(video.path(), path);
        assert_eq!(video.bytes(), 14);
        video.replace(&staged, OsStr::new("video.mov"), 5).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"small");
        assert_eq!(std::fs::metadata(path).unwrap().mode() & 0o777, 0o640);
        assert!(!staged.path().join("video.mov").exists());
    }

    #[test]
    fn refuses_escapes_symlinks_and_nonregular_inputs() {
        let (root, bundle, _staged) = fixture();
        let outside = root.path().join("outside.mov");
        std::fs::write(&outside, b"outside").unwrap();
        symlink(&outside, bundle.join("linked.mov")).unwrap();
        symlink(root.path(), bundle.join("ancestor")).unwrap();
        symlink(&bundle, root.path().join("linked.apparent")).unwrap();
        let fifo = CString::new(bundle.join("pipe.mov").as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        for relative in [
            "",
            ".",
            "../outside.mov",
            "media/../../outside.mov",
            "linked.mov",
            "ancestor/outside.mov",
            "media",
            "pipe.mov",
        ] {
            assert!(
                Video::open(&bundle, Path::new(relative)).is_err(),
                "{relative}"
            );
        }
        assert!(Video::open(&bundle, &outside).is_err());
        assert!(
            Video::open(
                &root.path().join("linked.apparent"),
                Path::new("media/video.mov")
            )
            .is_err()
        );
        assert_eq!(std::fs::read(outside).unwrap(), b"outside");
    }

    #[test]
    fn refuses_changed_source_or_rebound_parent_before_commit() {
        for mutation in ["contents", "inode", "parent", "root"] {
            let (root, bundle, staged) = fixture();
            let path = bundle.join("media/video.mov");
            let video = Video::open(&bundle, Path::new("media/video.mov")).unwrap();
            match mutation {
                "contents" => std::fs::write(&path, b"changed source contents").unwrap(),
                "inode" => {
                    std::fs::rename(&path, bundle.join("old.mov")).unwrap();
                    std::fs::write(&path, b"replacement").unwrap();
                }
                "parent" => {
                    std::fs::rename(bundle.join("media"), bundle.join("old-media")).unwrap();
                    symlink(root.path(), bundle.join("media")).unwrap();
                    std::fs::write(root.path().join("video.mov"), b"outside").unwrap();
                }
                "root" => {
                    std::fs::rename(&bundle, root.path().join("old.apparent")).unwrap();
                    std::fs::create_dir_all(bundle.join("media")).unwrap();
                    std::fs::write(&path, b"replacement").unwrap();
                }
                _ => unreachable!(),
            }
            let before = std::fs::read(&path).unwrap();
            assert!(
                video.replace(&staged, OsStr::new("video.mov"), 5).is_err(),
                "{mutation}"
            );
            assert_eq!(std::fs::read(path).unwrap(), before, "{mutation}");
            assert_eq!(
                std::fs::read(staged.path().join("video.mov")).unwrap(),
                b"small"
            );
        }
    }

    #[test]
    fn refuses_invalid_encoder_output_without_changing_source() {
        for invalid in ["symlink", "hardlink", "size", "empty", "traversal"] {
            let (root, bundle, staged) = fixture();
            let outside = root.path().join("video.mov");
            std::fs::write(&outside, b"small").unwrap();
            let video = Video::open(&bundle, Path::new("media/video.mov")).unwrap();
            let output = staged.path().join("video.mov");
            let mut bytes = 5;
            let mut name = OsStr::new("video.mov");
            match invalid {
                "symlink" => {
                    std::fs::remove_file(&output).unwrap();
                    symlink(&outside, &output).unwrap();
                }
                "hardlink" => std::fs::hard_link(&output, root.path().join("linked.mov")).unwrap(),
                "size" => bytes = 6,
                "empty" => {
                    std::fs::write(output, []).unwrap();
                    bytes = 0;
                }
                "traversal" => name = OsStr::new("../video.mov"),
                _ => unreachable!(),
            }
            assert!(video.replace(&staged, name, bytes).is_err(), "{invalid}");
            assert_eq!(
                std::fs::read(bundle.join("media/video.mov")).unwrap(),
                b"original video"
            );
        }
    }
}

#[derive(PartialEq, Eq)]
struct Snapshot(u64, u64, u64, i64, i64, i64, i64, u32, u64);
fn snapshot(metadata: &Metadata) -> Snapshot {
    Snapshot(
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec(),
        metadata.mode(),
        metadata.nlink(),
    )
}

fn directory(path: &Path) -> Result<File> {
    Ok(OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?)
}

pub(super) fn stage(bundle: &Path) -> Result<tempfile::TempDir> {
    let name = bundle
        .file_stem()
        .context("Bundle has no name")?
        .to_string_lossy();
    Ok(tempfile::Builder::new()
        .prefix(&format!(".{name}."))
        .suffix(".shrinking.mov")
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir_in(bundle.parent().context("Bundle has no parent")?)?)
}

fn member(parent: &File, name: &OsStr, is_directory: bool) -> Result<File> {
    let name = CString::new(name.as_bytes())?;
    let flags = libc::O_RDONLY
        | libc::O_NOFOLLOW
        | libc::O_CLOEXEC
        | libc::O_NONBLOCK
        | if is_directory { libc::O_DIRECTORY } else { 0 };
    // SAFETY: the parent descriptor and NUL-terminated name stay live for openat.
    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
    if fd < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    // SAFETY: openat returned a new descriptor, transferred exactly once to File.
    Ok(unsafe { File::from_raw_fd(fd) })
}

pub(super) struct Video {
    root_path: PathBuf,
    relative: PathBuf,
    path: PathBuf,
    name: OsString,
    root: File,
    parent: File,
    file: File,
    original: Snapshot,
}

impl Video {
    pub(super) fn open(root_path: &Path, relative: &Path) -> Result<Self> {
        ensure!(
            !relative.as_os_str().is_empty() && relative.as_os_str().as_bytes().len() <= 4096,
            "Invalid bundle video name"
        );
        let names: Vec<_> = relative
            .components()
            .map(|component| match component {
                Component::Normal(name) => Ok(name),
                _ => anyhow::bail!("Bundle video must be relative without parent traversal"),
            })
            .collect::<Result<_>>()?;
        let (name, ancestors) = names.split_last().context("Bundle video has no name")?;
        let root = directory(root_path)?;
        let mut parent = root.try_clone()?;
        for name in ancestors {
            parent = member(&parent, name, true)?;
        }
        let file = member(&parent, name, false)?;
        let metadata = file.metadata()?;
        ensure!(metadata.is_file(), "Bundle video must be a regular file");
        Ok(Self {
            root_path: root_path.to_path_buf(),
            relative: relative.to_path_buf(),
            path: root_path.join(relative),
            name: name.to_os_string(),
            root,
            parent,
            file,
            original: snapshot(&metadata),
        })
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
    pub(super) fn bytes(&self) -> u64 {
        self.original.2
    }

    fn current(&self) -> Result<()> {
        let now = Self::open(&self.root_path, &self.relative)?;
        ensure!(
            identity(&now.root.metadata()?) == identity(&self.root.metadata()?)
                && identity(&now.parent.metadata()?) == identity(&self.parent.metadata()?)
                && now.original == self.original
                && snapshot(&self.file.metadata()?) == self.original,
            "Bundle video changed while it was being shrunk"
        );
        Ok(())
    }

    /// The target parent stays descriptor-anchored even if a pathname is rebound
    /// after the identity check. No directory symlink can redirect this rename.
    pub(super) fn replace(
        &self,
        staged: &tempfile::TempDir,
        name: &OsStr,
        bytes: u64,
    ) -> Result<()> {
        self.current()?;
        let parent = directory(staged.path())?;
        ensure!(
            Path::new(name).components().count() == 1
                && matches!(
                    Path::new(name).components().next(),
                    Some(Component::Normal(_))
                ),
            "Invalid staged video name"
        );
        let encoded = member(&parent, name, false)?;
        let metadata = encoded.metadata()?;
        ensure!(
            metadata.is_file() && metadata.nlink() == 1 && metadata.len() == bytes && bytes > 0,
            "Invalid staged video"
        );
        encoded.set_permissions(self.file.metadata()?.permissions())?;
        let from = CString::new(name.as_bytes())?;
        let to = CString::new(self.name.as_bytes())?;
        // SAFETY: both held directories and NUL-terminated names stay live.
        if unsafe {
            libc::renameat(
                parent.as_raw_fd(),
                from.as_ptr(),
                self.parent.as_raw_fd(),
                to.as_ptr(),
            )
        } != 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    }
}
