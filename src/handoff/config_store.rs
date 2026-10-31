//! Policy-free JSON config storage, an interim donor for a shared Engine package.
//!
//! One canonical file and stable sidecar lock serialize the complete read/edit/publish
//! transaction across processes. Callers own schema, defaults, validation and consent.
//! A caller that also needs another lock must take that lock first (Connect: queue
//! then config). Closures must only edit JSON: no queue acquisition, network or UI.
//!
//! Reads are uncached. Only a missing file becomes an empty object for a write;
//! malformed, unreadable and non-object existing files are refused byte-unchanged.
//! Parent descriptors pin publication; symlinks are refused at the file boundary.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};

/// The single preference file: `APPARENT_CONFIG`, otherwise the user's canonical path.
pub fn default_config_path() -> PathBuf {
    std::env::var_os("APPARENT_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".config/apparent/config.json")
        })
}

/// Read untyped JSON without applying Desktop preference policy.
/// Unlike a transaction, this read does not take the advisory writer lock.
pub fn read_value_from(path: &Path) -> Result<serde_json::Value> {
    serde_json::from_slice(
        &fs::read(path).with_context(|| format!("Could not read {}", path.display()))?,
    )
    .with_context(|| format!("Invalid config at {}", path.display()))
}

/// Set one top-level key (`null` removes it), preserving unrelated JSON and using
/// private `0600` publication. No schema or preference policy is applied here.
pub fn set_config_value_in(path: &Path, key: &str, value: serde_json::Value) -> Result<()> {
    update_config_in(path, |config| {
        if value.is_null() {
            config.as_object_mut().unwrap().remove(key);
        } else {
            config[key] = value;
        }
        Ok(())
    })
}

/// Read the latest object, edit it and atomically publish while holding one
/// interprocess sidecar lock. Nested reads and multi-key edits belong inside
/// `edit`, not in a snapshot taken before this call. An edit error or unwind
/// publishes nothing and releases the lock. The closure must retain an object.
///
/// This transaction never acquires other application locks or runs outside work.
/// The temporary file is synced before rename, as in the original writer; this
/// does not add a parent-directory fsync or promise new crash-durability semantics.
pub fn update_config_in(
    path: &Path,
    edit: impl FnOnce(&mut serde_json::Value) -> Result<()>,
) -> Result<()> {
    use std::io::{Read, Write};
    use std::os::fd::AsRawFd;
    #[cfg(test)]
    config_write_hook("before_lock", path);
    let writer = ConfigWriter::acquire(path)?;
    let mut config: serde_json::Value =
        match writer.open(&writer.name, libc::O_RDONLY | libc::O_NONBLOCK) {
            Ok(mut file) => {
                ensure!(file.metadata()?.is_file(), "Config must be a regular file");
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes)?;
                let parsed: serde_json::Value = serde_json::from_slice(&bytes)
                    .with_context(|| format!("Invalid config at {}", path.display()))?;
                anyhow::ensure!(
                    parsed.is_object(),
                    "Config at {} must be an object",
                    path.display()
                );
                parsed
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
            Err(error) => {
                return Err(error).with_context(|| format!("Could not read {}", path.display()));
            }
        };
    #[cfg(test)]
    config_write_hook("snapshot", path);
    edit(&mut config)?;
    let tmp = temporary_name();
    let mut body = serde_json::to_vec_pretty(&config)?;
    body.push(b'\n');
    let result = (|| -> Result<()> {
        let mut file = writer.open(&tmp, libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL)?;
        file.write_all(&body)?;
        file.sync_all()?;
        let fd = writer.directory.as_raw_fd();
        if unsafe { libc::renameat(fd, tmp.as_ptr(), fd, writer.name.as_ptr()) } != 0 {
            return Err(std::io::Error::last_os_error()).context("Could not publish config");
        }
        Ok(())
    })();
    if result.is_err() {
        unsafe {
            libc::unlinkat(writer.directory.as_raw_fd(), tmp.as_ptr(), 0);
        }
    }
    result
}

fn temporary_name() -> std::ffi::CString {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    // Process identity, clock and counter isolate concurrent writers without an
    // application bundle-ID dependency. O_EXCL still arbitrates actual creation.
    std::ffi::CString::new(format!(
        ".config-{}-{nanos}-{}.tmp",
        std::process::id(),
        COUNT.fetch_add(1, Ordering::Relaxed)
    ))
    .expect("numeric temporary name contains no NUL")
}

struct ConfigWriter {
    directory: fs::File,
    // Closing this descriptor releases flock, including on error/unwind.
    _lock: fs::File,
    name: std::ffi::CString,
}

impl ConfigWriter {
    fn acquire(path: &Path) -> Result<Self> {
        use std::os::fd::AsRawFd;
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent)?;
        let parent = parent.canonicalize()?;
        let mut directory = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open("/")?;
        let mut private_ancestor = false;
        for component in parent.components().skip(1) {
            let name = std::ffi::CString::new(component.as_os_str().as_bytes())?;
            directory = Self::open_at(&directory, &name, libc::O_RDONLY | libc::O_DIRECTORY)?;
            let meta = directory.metadata()?;
            ensure!(
                (meta.uid() == 0 || meta.uid() == unsafe { libc::geteuid() })
                    && (meta.mode() & 0o022 == 0
                        || meta.mode() & libc::S_ISVTX as u32 != 0
                        || private_ancestor),
                "Config ancestry must be trusted or sticky"
            );
            private_ancestor |= meta.mode() & 0o077 == 0;
        }
        let meta = directory.metadata()?;
        ensure!(
            meta.uid() == unsafe { libc::geteuid() }
                && (meta.mode() & 0o022 == 0 || private_ancestor),
            "Config directory must be owned and not writable by other users"
        );
        let name = path.file_name().context("Config has no filename")?;
        let name = std::ffi::CString::new(name.as_bytes())?;
        let lock_name = std::ffi::CString::new([name.as_bytes(), b".lock"].concat())?;
        let lock = Self::open_at(
            &directory,
            &lock_name,
            libc::O_RDWR | libc::O_CREAT | libc::O_NONBLOCK,
        )?;
        let meta = lock.metadata()?;
        ensure!(
            meta.is_file()
                && meta.uid() == unsafe { libc::geteuid() }
                && meta.mode() & 0o077 == 0
                && meta.nlink() == 1,
            "Config lock must be an owned private regular file"
        );
        loop {
            if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) } == 0 {
                break;
            }
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::Interrupted {
                return Err(error.into());
            }
        }
        let current =
            Self::open_at(&directory, &lock_name, libc::O_RDONLY | libc::O_NONBLOCK)?.metadata()?;
        ensure!(
            current.dev() == meta.dev()
                && current.ino() == meta.ino()
                && lock.metadata()?.nlink() == 1,
            "Config lock changed while waiting"
        );
        Ok(Self {
            directory,
            _lock: lock,
            name,
        })
    }

    fn open(&self, name: &std::ffi::CStr, flags: i32) -> std::io::Result<fs::File> {
        Self::open_at(&self.directory, name, flags)
    }

    fn open_at(
        directory: &fs::File,
        name: &std::ffi::CStr,
        flags: i32,
    ) -> std::io::Result<fs::File> {
        use std::os::fd::{AsRawFd, FromRawFd};
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                flags | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                // C variadic arguments require promotion: Darwin's mode_t is u16.
                0o600 as libc::c_uint,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(unsafe { fs::File::from_raw_fd(fd) })
    }
}

#[cfg(test)]
thread_local! {
    static CONFIG_WRITE_HOOK: std::cell::RefCell<Option<Box<dyn FnMut(&str, &Path)>>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) fn set_config_write_hook(hook: Option<Box<dyn FnMut(&str, &Path)>>) {
    CONFIG_WRITE_HOOK.with(|slot| *slot.borrow_mut() = hook);
}

#[cfg(test)]
fn config_write_hook(point: &str, path: &Path) {
    CONFIG_WRITE_HOOK.with(|slot| {
        if let Ok(mut slot) = slot.try_borrow_mut()
            && let Some(hook) = slot.as_mut()
        {
            hook(point, path);
        }
    });
}

#[cfg(test)]
#[path = "config_store_tests.rs"]
mod tests;
