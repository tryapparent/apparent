//! Descriptor-relative storage. Never repair permissions on pre-existing objects.
use anyhow::{Context, Result, bail, ensure};
use std::ffi::{CString, OsStr};
use std::fs::{File, Metadata};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

fn c(value: &OsStr) -> Result<CString> {
    Ok(CString::new(value.as_bytes()).context("invalid path")?)
}

fn open_at(dir: &File, name: &OsStr, flags: i32) -> Result<File> {
    let name = c(name)?;
    // O_NONBLOCK means a malicious FIFO cannot hang validation.
    let fd = unsafe {
        libc::openat(
            dir.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK,
            0o600,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

fn private(meta: &Metadata, directory: bool) -> Result<()> {
    ensure!(
        meta.uid() == unsafe { libc::geteuid() },
        "trace storage must belong to the current user"
    );
    ensure!(
        if directory {
            meta.is_dir()
        } else {
            meta.is_file() && meta.nlink() == 1
        },
        "unsafe trace storage type or hard link"
    );
    ensure!(
        meta.mode() & 0o7777 == if directory { 0o700 } else { 0o600 },
        "trace storage must already be private (0700 directories, 0600 files)"
    );
    Ok(())
}

fn chmod_new(file: &File, mode: libc::mode_t) -> Result<()> {
    // Explicitly restrict the ACL mask before any content is written, even with default ACLs.
    ensure!(
        unsafe { libc::fchmod(file.as_raw_fd(), mode) } == 0,
        "could not protect new trace storage"
    );
    #[cfg(target_os = "macos")]
    mac_acl::clear_new(file)?;
    Ok(())
}

// Darwin ACLs are independent of the Unix mode mask. Remove inherited ACLs only
// on objects just created by us; refuse extended ACLs on pre-existing objects.
#[cfg(target_os = "macos")]
mod mac_acl {
    use super::*;
    use std::ffi::c_void;
    const EXTENDED: i32 = 0x100;
    unsafe extern "C" {
        fn acl_init(count: i32) -> *mut c_void;
        fn acl_free(acl: *mut c_void) -> i32;
        fn acl_get_fd_np(fd: i32, kind: i32) -> *mut c_void;
        fn acl_set_fd_np(fd: i32, acl: *mut c_void, kind: i32) -> i32;
        fn acl_size(acl: *mut c_void) -> libc::ssize_t;
    }
    pub fn clear_new(file: &File) -> Result<()> {
        let acl = unsafe { acl_init(0) };
        ensure!(!acl.is_null(), "could not create private trace ACL");
        let result = unsafe { acl_set_fd_np(file.as_raw_fd(), acl, EXTENDED) };
        unsafe {
            acl_free(acl);
        }
        ensure!(result == 0, "could not restrict inherited trace ACL");
        Ok(())
    }
    pub fn check(file: &File) -> Result<()> {
        let acl = unsafe { acl_get_fd_np(file.as_raw_fd(), EXTENDED) };
        if acl.is_null() {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ENOENT) {
                return Ok(());
            }
            return Err(error.into());
        }
        let empty = unsafe { acl_init(0) };
        if empty.is_null() {
            unsafe {
                acl_free(acl);
            }
            bail!("could not inspect trace ACL");
        }
        let actual_size = unsafe { acl_size(acl) };
        let empty_size = unsafe { acl_size(empty) };
        unsafe {
            acl_free(acl);
            acl_free(empty);
        }
        ensure!(
            actual_size >= 0 && actual_size == empty_size,
            "extended ACL on existing trace storage is not allowed"
        );
        Ok(())
    }
}

fn check_private(file: &File, directory: bool) -> Result<()> {
    private(&file.metadata()?, directory)?;
    #[cfg(target_os = "macos")]
    mac_acl::check(file)?;
    Ok(())
}

pub(super) fn absolute(path: &Path) -> Result<PathBuf> {
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()?.join(path)
    };
    ensure!(
        !path
            .components()
            .any(|part| matches!(part, Component::ParentDir)),
        "parent path components are not allowed"
    );
    Ok(path)
}

fn directory_at(parent: &File, name: &OsStr, must_be_private: bool) -> Result<File> {
    let mut created = false;
    let file = match open_at(parent, name, libc::O_RDONLY | libc::O_DIRECTORY) {
        Ok(file) => file,
        Err(error) => {
            if error
                .downcast_ref::<std::io::Error>()
                .and_then(|e| e.raw_os_error())
                != Some(libc::ENOENT)
            {
                return Err(error);
            }
            let name_c = c(name)?;
            let result = unsafe { libc::mkdirat(parent.as_raw_fd(), name_c.as_ptr(), 0o700) };
            if result < 0 {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() != Some(libc::EEXIST) {
                    return Err(error.into());
                }
            } else {
                created = true;
            }
            open_at(parent, name, libc::O_RDONLY | libc::O_DIRECTORY)?
        }
    };
    if created {
        chmod_new(&file, 0o700)?;
    }
    if must_be_private || created {
        check_private(&file, true)?;
    }
    Ok(file)
}

pub(super) struct Store {
    pub root: PathBuf,
    dir: File,
}

pub(super) struct Guard {
    _lock: File,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let root = absolute(path)?;
        ensure!(
            root != Path::new("/"),
            "trace root cannot be filesystem root"
        );
        let mut dir = File::open("/")?;
        let parts: Vec<_> = root
            .components()
            .filter_map(|p| match p {
                Component::Normal(n) => Some(n),
                _ => None,
            })
            .collect();
        for (index, part) in parts.iter().enumerate() {
            dir = directory_at(&dir, part, index + 1 == parts.len())?;
        }
        Ok(Self { root, dir })
    }

    pub fn lock(&self) -> Result<Guard> {
        check_private(&self.dir, true)?;
        let lock = match self.create(".lock") {
            Ok(file) => file,
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .and_then(|e| e.raw_os_error())
                    == Some(libc::EEXIST) =>
            {
                self.read(".lock")?
            }
            Err(error) => return Err(error),
        };
        check_private(&lock, false)?;
        loop {
            if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) } == 0 {
                break;
            }
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::Interrupted {
                return Err(error.into());
            }
        }
        // A renamed/replaced lock must not split writers into different lock domains.
        let current = self.read(".lock")?;
        let a = lock.metadata()?;
        let b = current.metadata()?;
        ensure!(
            a.dev() == b.dev() && a.ino() == b.ino(),
            "trace lock was replaced"
        );
        Ok(Guard { _lock: lock })
    }

    pub fn read(&self, name: &str) -> Result<File> {
        super::filename(name)?;
        let file = open_at(&self.dir, OsStr::new(name), libc::O_RDONLY)?;
        check_private(&file, false)?;
        Ok(file)
    }

    pub fn create(&self, name: &str) -> Result<File> {
        super::filename(name)?;
        let file = open_at(
            &self.dir,
            OsStr::new(name),
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL,
        )?;
        chmod_new(&file, 0o600)?;
        check_private(&file, false)?;
        Ok(file)
    }

    pub fn remove(&self, name: &str) -> Result<()> {
        super::filename(name)?;
        let name = c(OsStr::new(name))?;
        ensure!(
            unsafe { libc::unlinkat(self.dir.as_raw_fd(), name.as_ptr(), 0) } == 0,
            "could not remove trace temporary file"
        );
        Ok(())
    }

    pub fn write_json(&self, name: &str, value: &impl serde::Serialize, new: bool) -> Result<()> {
        super::filename(name)?;
        if new {
            // Caller holds the persistent store lock; never overwrite an existing trace.
            match self.read(name) {
                Ok(_) => bail!("trace ID collision"),
                Err(error)
                    if error
                        .downcast_ref::<std::io::Error>()
                        .and_then(|e| e.raw_os_error())
                        == Some(libc::ENOENT) => {}
                Err(error) => return Err(error),
            }
        } else {
            self.read(name)?;
        }
        let temporary = format!("tmp-{}", super::ident()?);
        let result = (|| -> Result<()> {
            let mut file = self.create(&temporary)?;
            serde_json::to_writer_pretty(&mut file, value)?;
            file.write_all(b"\n")?;
            ensure!(
                file.metadata()?.len() <= 64 * 1024 * 1024,
                "trace JSON exceeds storage limit"
            );
            file.sync_all()?;
            let from = c(OsStr::new(&temporary))?;
            let to = c(OsStr::new(name))?;
            ensure!(
                unsafe {
                    libc::renameat(
                        self.dir.as_raw_fd(),
                        from.as_ptr(),
                        self.dir.as_raw_fd(),
                        to.as_ptr(),
                    )
                } == 0,
                "could not publish trace"
            );
            self.dir.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = self.remove(&temporary);
        }
        result
    }

    pub fn trace_ids(&self) -> Result<Vec<String>> {
        // read_dir uses the pathname only for enumeration; every file is opened relative
        // to our pinned descriptor and validated again before it is consumed.
        let mut ids = Vec::new();
        for entry in std::fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_str().context("invalid trace storage filename")?;
            if let Some(id) = name.strip_suffix(".json") {
                super::token(id)?;
                ids.push(id.to_owned());
            }
        }
        ids.sort();
        Ok(ids)
    }
}

pub(super) fn input(path: &Path) -> Result<File> {
    let absolute = absolute(path)?;
    let mut dir = File::open("/")?;
    let mut parts = absolute
        .components()
        .filter_map(|p| match p {
            Component::Normal(n) => Some(n),
            _ => None,
        })
        .peekable();
    while let Some(part) = parts.next() {
        let file = open_at(
            &dir,
            part,
            if parts.peek().is_some() {
                libc::O_RDONLY | libc::O_DIRECTORY
            } else {
                libc::O_RDONLY
            },
        )?;
        if parts.peek().is_none() {
            ensure!(
                file.metadata()?.is_file(),
                "artifact must be a regular file"
            );
            return Ok(file);
        }
        dir = file;
    }
    bail!("artifact must be a regular file")
}

pub(super) fn random() -> Result<[u8; 16]> {
    let mut bytes = [0; 16];
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes)
}
