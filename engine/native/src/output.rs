use std::fs::{File, OpenOptions, Permissions};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
pub type Result<T> = std::result::Result<T, &'static str>;
pub fn output_write_error(error: std::io::Error) -> &'static str {
    match error.raw_os_error() {
        Some(libc::ENOSPC | libc::EDQUOT) => "resource_limit",
        _ => "write_failed",
    }
}
pub struct Directory {
    directory: File,
}
impl Directory {
    pub fn open(path: &Path) -> Result<Self> {
        let path: std::path::PathBuf = path.components().collect();
        let directory = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&path)
            .map_err(|_| "unsafe_output")?;
        let meta = directory.metadata().map_err(|_| "unsafe_output")?;
        if meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o777 != 0o700 {
            return Err("unsafe_output");
        }
        directory.try_lock().map_err(|_| "unsafe_output")?;
        let mut entries = std::fs::read_dir(&path).map_err(|_| "unsafe_output")?;
        if entries.next().is_some() {
            return Err("unsafe_output");
        }
        let current = std::fs::symlink_metadata(&path).map_err(|_| "unsafe_output")?;
        if current.dev() != meta.dev() || current.ino() != meta.ino() {
            return Err("unsafe_output");
        }
        Ok(Self { directory })
    }

    pub fn create_private(&self, name: &str) -> Result<File> {
        if name.is_empty() || name == "." || name == ".." || name.contains('/') {
            return Err("unsafe_output");
        }
        let c_name = std::ffi::CString::new(name).map_err(|_| "unsafe_output")?;
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                c_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(output_write_error(std::io::Error::last_os_error()));
        }
        let file = unsafe { File::from_raw_fd(fd) };
        file.set_permissions(Permissions::from_mode(0o600))
            .map_err(output_write_error)?;
        Ok(file)
    }
}

impl AsRawFd for Directory {
    fn as_raw_fd(&self) -> std::os::fd::RawFd {
        self.directory.as_raw_fd()
    }
}
