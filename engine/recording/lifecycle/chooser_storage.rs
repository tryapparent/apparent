use std::ffi::{CStr, CString};
use std::fs::File;
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};

use crate::capture::engine::bundle::bundle_processing::publication::Directory;
use crate::capture::engine::bundle::recover;
use crate::capture::engine::runtime::apparent_log;
use crate::capture::engine::runtime::audio::{
    audio::PreparedAudio,
    persistence::{Lease, Writer},
};
use crate::shared::handoff::default_captures_dir;

use super::start::SCREEN_PROTECTION_BYTES;

pub(crate) struct ChooserStorage {
    parent_path: PathBuf,
    parent: Directory,
    name: CString,
    dir: Directory,
    audio: Option<File>,
    owned: bool,
}

pub(super) enum Promotion {
    Ready(ChooserStorage, Option<PreparedAudio>),
    Fallback { microphone: bool },
}

impl ChooserStorage {
    pub(super) fn prepare_for_chooser() -> Option<Self> {
        use crate::capture::engine::runtime::audio::mic;
        Self::prepare(default_captures_dir(), mic::enabled())
            .inspect_err(|error| {
                apparent_log(format!(
                    "Screen chooser storage preparation skipped: {error:#}"
                ))
            })
            .ok()
    }

    fn prepare(parent_path: PathBuf, microphone: bool) -> Result<Self> {
        let leaf = format!(".cancelled-{}", crate::shared::ids::make_bundle_id());
        Self::create(parent_path, &leaf, microphone)
    }

    fn create(parent_path: PathBuf, leaf: &str, microphone: bool) -> Result<Self> {
        let parent = Directory::open(&parent_path, true)?;
        let name = CString::new(leaf)?;
        syscall(unsafe { libc::mkdirat(parent.0.as_raw_fd(), name.as_ptr(), 0o700) })?;
        let dir = parent.child(leaf, false)?;
        let mut owned = Self {
            parent_path,
            parent,
            name,
            dir,
            audio: None,
            owned: true,
        };
        owned
            .dir
            .write(recover::UNSAFE_VIDEO, SCREEN_PROTECTION_BYTES)?;
        if microphone {
            owned.audio = Some(Writer::prepare_wav(owned.dir.leaf("audio.wav", true)?)?);
            owned.dir.0.sync_all()?;
        }
        Ok(owned)
    }

    pub(super) fn reserve_final(bundle: &Path, microphone: bool) -> Result<Promotion> {
        let parent = bundle.parent().context("Screen bundle has no parent")?;
        let leaf = bundle
            .file_name()
            .and_then(|name| name.to_str())
            .context("Screen bundle has no UTF-8 name")?;
        let mut storage = Self::create(parent.to_owned(), leaf, microphone)?;
        let wav = storage.audio.take();
        let lease = wav
            .as_ref()
            .map(|_| Lease::create(&storage.pinned_path()))
            .transpose()?;
        storage.activate(bundle, wav, lease)
    }

    pub(super) fn matches(&self, new_bundle: &Path, microphone: bool) -> bool {
        self.audio.is_some() == microphone
            && new_bundle.parent() == Some(self.parent_path.as_path())
    }

    pub(super) fn promote(self, bundle: &Path) -> Result<Promotion> {
        self.promote_with_rename(bundle, rename_no_replace)
    }

    fn promote_with_rename(
        mut self,
        bundle: &Path,
        rename: impl FnOnce(libc::c_int, &CStr, &CStr) -> io::Result<()>,
    ) -> Result<Promotion> {
        ensure!(
            bundle.parent() == Some(&self.parent_path),
            "Screen storage location changed"
        );
        let final_name = CString::new(
            bundle
                .file_name()
                .and_then(|name| name.to_str())
                .context("Screen bundle has no UTF-8 name")?,
        )?;
        let current_parent = Directory::open(&self.parent_path, false)?;
        ensure!(
            same_directory(&self.parent.0, &current_parent.0)?,
            "Screen storage location changed"
        );
        ensure!(self.still_owned()?, "Provisional screen directory changed");
        let wav = self.audio.take();
        let fallback = Promotion::Fallback {
            microphone: wav.is_some(),
        };
        let lease = if let Some(ref file) = wav {
            if let Err(error) = file.set_modified(std::time::SystemTime::now()) {
                if error.kind() == io::ErrorKind::Unsupported {
                    return Ok(fallback);
                }
                return Err(error.into());
            }
            Some(Lease::create(&self.pinned_path())?)
        } else {
            None
        };
        let fd = self.parent.0.as_raw_fd();
        if let Err(error) = rename(fd, &self.name, &final_name) {
            if matches!(
                error.raw_os_error(),
                Some(libc::EINVAL | libc::ENOSYS | libc::EOPNOTSUPP)
            ) {
                return Ok(fallback);
            }
            return Err(error.into());
        }
        self.name = final_name;
        self.activate(bundle, wav, lease)
    }

    fn activate(self, bundle: &Path, wav: Option<File>, lease: Option<Lease>) -> Result<Promotion> {
        self.parent.0.sync_all()?;
        self.verify_bundle(bundle)?;
        let audio = wav
            .zip(lease)
            .map(|(file, lease)| PreparedAudio::from_staged(bundle, file, lease.in_bundle(bundle)))
            .transpose()?;
        Ok(Promotion::Ready(self, audio))
    }

    pub(super) fn verify_bundle(&self, bundle: &Path) -> Result<()> {
        verify_directory(&self.dir.0, bundle)
    }

    pub(super) fn directory(&self) -> io::Result<File> {
        self.dir.0.try_clone()
    }

    pub(super) fn pinned_path(&self) -> PathBuf {
        fd_path(&self.dir.0)
    }

    pub(super) fn cancel(&self) -> Result<()> {
        self.dir.write(recover::CANCELLED, b"")
    }

    pub(super) fn release(mut self) {
        self.owned = false;
    }

    fn still_owned(&self) -> Result<bool> {
        let child = self.parent.child(self.name.to_str()?, false)?;
        same_directory(&self.dir.0, &child.0)
    }
}

impl Drop for ChooserStorage {
    fn drop(&mut self) {
        if !self.owned {
            return;
        }
        if !self.name.as_bytes().starts_with(b".cancelled-")
            && let Err(error) = self.cancel()
        {
            apparent_log(format!(
                "Could not mark failed screen startup cancelled: {error:#}"
            ));
            return;
        }
        if !matches!(self.still_owned(), Ok(true)) {
            return;
        }
        for name in [
            "recording.mp4",
            "audio.wav",
            ".audio-recording",
            recover::UNFINISHED,
            recover::UNSAFE_VIDEO,
        ] {
            if let Err(error) = self.dir.remove(name) {
                apparent_log(format!(
                    "Could not remove failed screen startup artifact: {error:#}"
                ));
                return;
            }
        }
        if let Err(error) = self.dir.remove(recover::CANCELLED) {
            apparent_log(format!(
                "Could not clean up failed screen startup: {error:#}"
            ));
            return;
        }
        if let Err(error) = unlink(&self.parent, &self.name, libc::AT_REMOVEDIR)
            .and_then(|()| self.parent.0.sync_all())
        {
            apparent_log(format!(
                "Could not discard provisional screen storage: {error}"
            ));
        }
    }
}

pub(crate) fn verify_directory(pinned: &File, path: &Path) -> Result<()> {
    let current = Directory::open(path, false)?;
    ensure!(
        same_directory(pinned, &current.0)?,
        "Screen capture directory changed"
    );
    Ok(())
}

pub(crate) fn fd_path(file: &File) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd()))
}

pub(crate) fn file_matches_path(file: &File, path: &Path) -> bool {
    file.metadata()
        .ok()
        .zip(std::fs::symlink_metadata(path).ok())
        .is_some_and(|(a, b)| (a.dev(), a.ino()) == (b.dev(), b.ino()))
}

fn same_directory(a: &File, b: &File) -> Result<bool> {
    let a = a.metadata()?;
    let b = b.metadata()?;
    Ok((a.dev(), a.ino()) == (b.dev(), b.ino()))
}

fn unlink(dir: &Directory, name: &CStr, flags: libc::c_int) -> io::Result<()> {
    syscall(unsafe { libc::unlinkat(dir.0.as_raw_fd(), name.as_ptr(), flags) })
}

fn rename_no_replace(fd: libc::c_int, source: &CStr, destination: &CStr) -> io::Result<()> {
    syscall(unsafe {
        libc::renameat2(
            fd,
            source.as_ptr(),
            fd,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    })
}

fn syscall(result: libc::c_int) -> io::Result<()> {
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::engine::runtime::audio::persistence;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{Duration, SystemTime};

    fn private_root() -> io::Result<tempfile::TempDir> {
        tempfile::Builder::new()
            .permissions(std::fs::Permissions::from_mode(0o700))
            .tempdir()
    }

    #[test]
    fn chooser_storage_cancel_before_admission_never_exposes_recoverable_media() -> Result<()> {
        let parent = private_root()?;
        let store = ChooserStorage::prepare(parent.path().to_path_buf(), true)?;
        let stage = parent.path().join(store.name.to_str()?);
        assert_eq!(
            std::fs::read(stage.join(recover::UNSAFE_VIDEO))?,
            SCREEN_PROTECTION_BYTES
        );
        assert_eq!(std::fs::metadata(stage.join("audio.wav"))?.len(), 44);
        assert!(!stage.join(persistence::RECORDING).exists());
        assert!(!recover::owed(&stage));
        assert!(
            recover::pending(parent.path(), SystemTime::now() + Duration::from_secs(60)).is_empty()
        );
        drop(store);
        assert!(!stage.exists());
        assert_eq!(std::fs::read_dir(parent.path())?.count(), 0);
        Ok(())
    }

    #[test]
    fn chooser_storage_promotes_a_locked_writer_and_keeps_no_staging_entry() -> Result<()> {
        let parent = private_root()?;
        let store = ChooserStorage::prepare(parent.path().to_path_buf(), true)?;
        let stage = parent.path().join(store.name.to_str()?);
        let destination = parent.path().join("record.apparent");
        assert!(store.matches(&destination, true));
        assert!(!store.matches(&destination, false));
        assert!(!store.matches(&parent.path().join("other/record.apparent"), true));
        let Promotion::Ready(storage, Some(audio)) = store.promote(&destination)? else {
            anyhow::bail!("Missing prepared narration");
        };
        assert!(!stage.exists());
        assert_eq!(
            std::fs::read(destination.join(recover::UNSAFE_VIDEO))?,
            SCREEN_PROTECTION_BYTES
        );
        assert!(persistence::live(&destination));
        assert!(!recover::owed(&destination));
        drop(audio);
        let lease = Lease::acquire(&destination)?;
        lease.remove()?;
        assert_eq!(std::fs::metadata(destination.join("audio.wav"))?.len(), 44);
        assert!(!destination.join(persistence::RECORDING).exists());
        storage.release();
        Ok(())
    }

    #[test]
    fn chooser_storage_destination_collision_preserves_existing_capture() -> Result<()> {
        let parent = private_root()?;
        let destination = parent.path().join("record.apparent");
        std::fs::create_dir(&destination)?;
        let existing = destination.join("existing");
        std::fs::write(&existing, b"owned by another capture")?;
        let store = ChooserStorage::prepare(parent.path().to_path_buf(), true)?;
        let stage = parent.path().join(store.name.to_str()?);
        assert!(store.promote(&destination).is_err());
        assert!(!stage.exists());
        assert_eq!(std::fs::read(existing)?, b"owned by another capture");
        Ok(())
    }

    #[test]
    fn chooser_storage_silent_capture_has_no_narration_artifacts() -> Result<()> {
        let parent = private_root()?;
        let store = ChooserStorage::prepare(parent.path().to_path_buf(), false)?;
        let destination = parent.path().join("record.apparent");
        let Promotion::Ready(storage, None) = store.promote(&destination)? else {
            anyhow::bail!("Silent capture opened narration");
        };
        assert!(destination.join(recover::UNSAFE_VIDEO).is_file());
        assert!(!destination.join("audio.wav").exists());
        assert!(!destination.join(persistence::RECORDING).exists());
        storage.release();
        Ok(())
    }

    #[test]
    fn chooser_storage_rollback_leaves_a_replacement_directory_intact() -> Result<()> {
        let parent = private_root()?;
        let store = ChooserStorage::prepare(parent.path().to_path_buf(), true)?;
        let stage = parent.path().join(store.name.to_str()?);
        let relocated = parent.path().join(".cancelled-relocated-fixture");
        std::fs::rename(&stage, &relocated)?;
        std::fs::create_dir(&stage)?;
        std::fs::write(stage.join("audio.wav"), b"replacement")?;
        drop(store);
        assert_eq!(std::fs::read(stage.join("audio.wav"))?, b"replacement");
        Ok(())
    }

    #[test]
    fn chooser_storage_unsupported_rename_falls_back_after_owned_cleanup() -> Result<()> {
        let parent = private_root()?;
        let store = ChooserStorage::prepare(parent.path().to_path_buf(), true)?;
        let destination = parent.path().join("record.apparent");
        let result = store.promote_with_rename(&destination, |_, _, _| {
            Err(io::Error::from_raw_os_error(libc::EOPNOTSUPP))
        })?;
        assert!(matches!(result, Promotion::Fallback { microphone: true }));
        assert_eq!(std::fs::read_dir(parent.path())?.count(), 0);
        std::fs::create_dir(&destination)?;
        assert!(ChooserStorage::reserve_final(&destination, true).is_err());
        assert_eq!(std::fs::read_dir(&destination)?.count(), 0);
        std::fs::remove_dir(&destination)?;
        let Promotion::Ready(storage, Some(audio)) =
            ChooserStorage::reserve_final(&destination, true)?
        else {
            anyhow::bail!("Fallback did not open the exclusively reserved capture");
        };
        assert!(persistence::live(&destination));
        drop(audio);
        drop(storage);
        assert!(!destination.exists());
        Ok(())
    }

    #[test]
    fn chooser_storage_refuses_parent_replacement_between_check_and_promotion() -> Result<()> {
        let root = private_root()?;
        let parent = root.path().join("captures");
        let moved = root.path().join("moved");
        let store = ChooserStorage::prepare(parent.clone(), true)?;
        let destination = parent.join("record.apparent");
        let result = store.promote_with_rename(&destination, |fd, source, target| {
            std::fs::rename(&parent, &moved)?;
            std::fs::create_dir(&parent)?;
            std::fs::write(parent.join("belongs-to-replacement"), b"keep")?;
            rename_no_replace(fd, source, target)
        });
        assert!(result.is_err());
        assert!(!destination.exists());
        assert_eq!(
            std::fs::read(parent.join("belongs-to-replacement"))?,
            b"keep"
        );
        assert_eq!(std::fs::read_dir(moved)?.count(), 0);
        Ok(())
    }

    #[test]
    fn chooser_storage_failed_track_start_cleans_the_promoted_bundle() -> Result<()> {
        let root = private_root()?;
        let store = ChooserStorage::prepare(root.path().to_path_buf(), true)?;
        let destination = root.path().join("record.apparent");
        let Promotion::Ready(storage, Some(audio)) = store.promote(&destination)? else {
            anyhow::bail!("Missing promoted narration");
        };
        storage.cancel()?;
        drop(audio);
        assert!(!recover::owed(&destination));
        drop(storage);
        assert!(!destination.exists());
        Ok(())
    }
}
