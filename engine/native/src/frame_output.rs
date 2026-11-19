use crate::output::Directory;
#[cfg(target_os = "linux")]
use crate::output::output_write_error;
pub use crate::output::Result;
use std::io::Write;
#[cfg(target_os = "macos")]
use std::os::fd::AsRawFd;
use std::path::Path;
pub const MAX_FRAMES: usize = 480;
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
    directory: Directory,
    pixels: u64,
}
impl Output {
    pub fn open(path: &Path) -> Result<Self> {
        Ok(Self {
            directory: Directory::open(path)?,
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
        let mut file = self.directory.create_private(&name)?;
        file.write_all(rgba).map_err(output_write_error)?;
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
