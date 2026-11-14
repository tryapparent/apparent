//! Single-use private job output. It never publishes into an application bundle.
use std::fs::{File, OpenOptions, Permissions};
use std::io::Write;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;

pub type Result<T> = std::result::Result<T, &'static str>;
pub const MAX_FRAMES: usize = 48;
pub const MAX_EDGE: u32 = 16_384;
pub const MAX_FRAME_PIXELS: u64 = 64 * 1024 * 1024;
pub const MAX_JOB_PIXELS: u64 = 256 * 1024 * 1024;
pub const MAX_TIME: u64 = 9_007_199_254_740_991;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub request_index: usize,
    pub requested_ms: u64,
    pub actual_ms: i64,
    pub width: u32,
    pub height: u32,
    pub file: String,
}

pub struct Output {
    directory: File,
    pixels: u64,
}

impl Output {
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
        Ok(Self {
            directory,
            pixels: 0,
        })
    }

    #[cfg(target_os = "macos")]
    pub fn inherited_fd(&self) -> Result<i32> {
        let fd = self.directory.as_raw_fd();
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) } < 0 {
            return Err("unsafe_output");
        }
        Ok(fd)
    }

    #[cfg(target_os = "linux")]
    pub fn write(
        &mut self,
        index: usize,
        requested_ms: u64,
        actual_ms: i64,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> Result<Frame> {
        let pixels = u64::from(width) * u64::from(height);
        if width == 0
            || height == 0
            || width > MAX_EDGE
            || height > MAX_EDGE
            || pixels > MAX_FRAME_PIXELS
            || self.pixels + pixels > MAX_JOB_PIXELS
            || pixels * 4 != rgba.len() as u64
        {
            return Err("resource_limit");
        }
        let name = format!("frame-{index:03}.rgba");
        let c_name = std::ffi::CString::new(name.as_str()).unwrap();
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                c_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err("write_failed");
        }
        let mut file = unsafe { File::from_raw_fd(fd) };
        file.set_permissions(Permissions::from_mode(0o600))
            .map_err(|_| "write_failed")?;
        file.write_all(rgba).map_err(|_| "write_failed")?;
        self.pixels += pixels;
        Ok(Frame {
            request_index: index,
            requested_ms,
            actual_ms,
            width,
            height,
            file: name,
        })
    }
}
