use std::os::fd::{FromRawFd, IntoRawFd};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

pub(crate) fn folder_usage(root: &Path, admit: &impl Fn() -> bool) -> Result<u64, &'static str> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(root)
        .map_err(|_| "usage_unavailable")?;
    scan_directory(file, admit, &mut 0, 0)
}


pub(crate) fn scan_directory(
    file: std::fs::File,
    admit: &impl Fn() -> bool,
    entries: &mut usize,
    depth: usize,
) -> Result<u64, &'static str> {
    if !admit() || depth >= 256 {
        return Err("usage_unavailable");
    }
    struct Directory(*mut libc::DIR);
    impl Drop for Directory {
        fn drop(&mut self) {

            unsafe {
                libc::closedir(self.0);
            }
        }
    }
    let fd = file.into_raw_fd();

    let dir = unsafe { libc::fdopendir(fd) };
    if dir.is_null() {
        drop(unsafe { std::fs::File::from_raw_fd(fd) });
        return Err("usage_unavailable");
    }
    let dir = Directory(dir);
    let mut bytes = 0u64;
    loop {
        if !admit() {
            return Err("usage_unavailable");
        }


        let entry = unsafe {
            #[cfg(target_os = "linux")]
            {
                *libc::__errno_location() = 0;
            }
            #[cfg(target_os = "macos")]
            {
                *libc::__error() = 0;
            }
            libc::readdir(dir.0)
        };
        if entry.is_null() {
            if std::io::Error::last_os_error().raw_os_error() != Some(0) {
                return Err("usage_unavailable");
            }
            return Ok(bytes);
        }


        let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
        if [b".".as_slice(), b"..".as_slice()].contains(&name.to_bytes()) {
            continue;
        }
        *entries += 1;
        if *entries > 100_000 {
            return Err("usage_unavailable");
        }
        let mut meta = std::mem::MaybeUninit::<libc::stat>::uninit();
        if unsafe {
            libc::fstatat(
                fd,
                name.as_ptr(),
                meta.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            return Err("usage_unavailable");
        }
        let meta = unsafe { meta.assume_init() };
        let size = if meta.st_mode & libc::S_IFMT == libc::S_IFDIR {


            let child = unsafe {
                libc::openat(
                    fd,
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if child < 0 {
                return Err("usage_unavailable");
            }
            let child = unsafe { std::fs::File::from_raw_fd(child) };
            scan_directory(child, admit, entries, depth + 1)?
        } else {
            u64::try_from(meta.st_size).map_err(|_| "usage_unavailable")?
        };
        bytes = bytes.checked_add(size).ok_or("usage_unavailable")?;
    }
}
