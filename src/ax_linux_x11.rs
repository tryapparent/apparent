//! Dedicated local X transport. x11rb owns protocol/auth handshake encoding;
//! every socket operation shares one absolute deadline, including setup replies.
use std::io;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::net::UnixStream;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use x11rb::reexports::x11rb_protocol::xauth::{Family, get_auth};
use x11rb::rust_connection::RustConnection;
use x11rb::rust_connection::{PollMode, Stream};
use x11rb::utils::RawFdContainer;

struct LocalDisplay {
    path: String,
    screen: usize,
    auth_name: Vec<u8>,
    auth_data: Vec<u8>,
}
static DISPLAY: OnceLock<Option<LocalDisplay>> = OnceLock::new();

/// Called only by the background label worker. Filesystem auth discovery can
/// stall; input must decline until it finishes, never wait on this initializer.
pub(crate) fn prepare() {
    DISPLAY.get_or_init(|| {
        let display = std::env::var("DISPLAY").ok()?;
        let (number, screen) = local_display(&display)?;
        let mut hostname = [0u8; 256];
        // SAFETY: gethostname writes at most the supplied valid buffer length.
        if unsafe { libc::gethostname(hostname.as_mut_ptr().cast(), hostname.len()) } != 0 {
            return None;
        }
        let end = hostname.iter().position(|b| *b == 0)?;
        let (auth_name, auth_data) = get_auth(Family::LOCAL, &hostname[..end], number)
            .ok()
            .flatten()
            .unwrap_or_default();
        if auth_name.len() > 256 || auth_data.len() > 256 {
            return None;
        }
        Some(LocalDisplay {
            path: format!("/tmp/.X11-unix/X{number}"),
            screen,
            auth_name,
            auth_data,
        })
    });
}

fn local_display(display: &str) -> Option<(u16, usize)> {
    // Deliberately no DNS, TCP, SSH forwarding or alternate protocol fallback.
    let display = display.strip_prefix(':')?;
    let (number, screen) = display.split_once('.').unwrap_or((display, "0"));
    if number.is_empty()
        || !number.bytes().all(|c| c.is_ascii_digit())
        || screen.is_empty()
        || !screen.bytes().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    Some((number.parse().ok()?, screen.parse().ok()?))
}

pub(super) fn connect(
    deadline: Instant,
) -> Result<(RustConnection<DeadlineStream>, usize), &'static str> {
    let display = DISPLAY
        .get()
        .and_then(Option::as_ref)
        .ok_or("local-x11-not-ready")?;
    let stream = DeadlineStream::connect(&display.path, deadline).map_err(|_| "x11-connect")?;
    let conn = RustConnection::connect_to_stream_with_auth_info(
        stream,
        display.screen,
        display.auth_name.clone(),
        display.auth_data.clone(),
    )
    .map_err(|_| "x11-setup")?;
    Ok((conn, display.screen))
}

pub(crate) struct DeadlineStream {
    inner: UnixStream,
    deadline: Mutex<Instant>,
}
impl DeadlineStream {
    pub(crate) fn from_socket(socket: UnixStream, deadline: Instant) -> io::Result<Self> {
        socket.set_nonblocking(true)?;
        Ok(Self {
            inner: socket,
            deadline: Mutex::new(deadline),
        })
    }
    fn connect(path: &str, deadline: Instant) -> io::Result<Self> {
        // SAFETY: socket returns a new owned descriptor, immediately wrapped for
        // cleanup on every exit. NONBLOCK applies to connect itself, not just replies.
        let fd = unsafe {
            libc::socket(
                libc::AF_UNIX,
                libc::SOCK_STREAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
                0,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let socket = unsafe { UnixStream::from_raw_fd(fd) };
        // SAFETY: zero is a valid initial sockaddr_un representation.
        let mut address: libc::sockaddr_un = unsafe { std::mem::zeroed() };
        address.sun_family = libc::AF_UNIX as _;
        if path.len() >= address.sun_path.len() || path.as_bytes().contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "local X socket path",
            ));
        }
        for (slot, byte) in address.sun_path.iter_mut().zip(path.bytes()) {
            *slot = byte as _;
        }
        let stream = Self::from_socket(socket, deadline)?;
        stream.check_deadline()?;
        // SAFETY: address is initialized, AF_UNIX, and its full size is supplied.
        let result = unsafe {
            libc::connect(
                stream.inner.as_raw_fd(),
                (&address as *const libc::sockaddr_un).cast(),
                std::mem::size_of_val(&address) as _,
            )
        };
        if result != 0 {
            let error = io::Error::last_os_error();
            // A full Unix listen queue returns EAGAIN: decline rather than retry.
            if error.raw_os_error() != Some(libc::EINPROGRESS) {
                return Err(error);
            }
            stream.poll(PollMode::Writable)?;
            let mut error: libc::c_int = 0;
            let mut len = std::mem::size_of_val(&error) as libc::socklen_t;
            // SAFETY: both output buffers have the declared sizes.
            if unsafe {
                libc::getsockopt(
                    stream.inner.as_raw_fd(),
                    libc::SOL_SOCKET,
                    libc::SO_ERROR,
                    (&mut error as *mut libc::c_int).cast(),
                    &mut len,
                )
            } != 0
            {
                return Err(io::Error::last_os_error());
            }
            if error != 0 {
                return Err(io::Error::from_raw_os_error(error));
            }
        }
        stream.check_deadline()?;
        Ok(stream)
    }
    pub(super) fn set_deadline(&self, deadline: Instant) {
        *self
            .deadline
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = deadline;
    }
    fn remaining(&self) -> io::Result<std::time::Duration> {
        let deadline = *self
            .deadline
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match deadline.checked_duration_since(Instant::now()) {
            Some(left) if !left.is_zero() => Ok(left),
            _ => {
                // No blocking ungrab roundtrip on timeout. Shutdown tells the server
                // this dedicated client is gone, releasing any grab; drop closes FD.
                // SAFETY: the descriptor stays owned by inner throughout this call.
                unsafe {
                    libc::shutdown(self.inner.as_raw_fd(), libc::SHUT_RDWR);
                }
                Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "X acquisition/lookup deadline",
                ))
            }
        }
    }
    fn check_deadline(&self) -> io::Result<()> {
        self.remaining().map(|_| ())
    }
}
impl Stream for DeadlineStream {
    fn poll(&self, mode: PollMode) -> io::Result<()> {
        loop {
            let left = self.remaining()?;
            let events = (if mode.readable() { libc::POLLIN } else { 0 })
                | (if mode.writable() { libc::POLLOUT } else { 0 });
            let mut fd = libc::pollfd {
                fd: self.inner.as_raw_fd(),
                events,
                revents: 0,
            };
            // Round up sub-ms waits; never reset the absolute deadline on EINTR.
            let timeout = left.as_millis().saturating_add(1).min(i32::MAX as u128) as i32;
            // SAFETY: fd points to one valid pollfd for the duration of poll.
            let result = unsafe { libc::poll(&mut fd, 1, timeout) };
            self.check_deadline()?;
            if result > 0 {
                return Ok(());
            }
            if result < 0 {
                let error = io::Error::last_os_error();
                if error.kind() != io::ErrorKind::Interrupted {
                    return Err(error);
                }
            }
        }
    }
    fn read(&self, buf: &mut [u8], _fds: &mut Vec<RawFdContainer>) -> io::Result<usize> {
        loop {
            self.check_deadline()?;
            let mut iov = libc::iovec {
                iov_base: buf.as_mut_ptr().cast(),
                iov_len: buf.len(),
            };
            // No FD-passing extensions are requested by this core/Shape-only
            // client. Reject ancillary data, rather than silently losing it.
            // Linux closes undisclosed SCM_RIGHTS when no control buffer fits.
            // SAFETY: zero initializes optional msghdr pointers/lengths; iov
            // references the caller's writable buffer for this synchronous call.
            let mut msg: libc::msghdr = unsafe { std::mem::zeroed() };
            msg.msg_iov = &mut iov;
            msg.msg_iovlen = 1;
            let count = unsafe {
                libc::recvmsg(
                    self.inner.as_raw_fd(),
                    &mut msg,
                    libc::MSG_DONTWAIT | libc::MSG_CMSG_CLOEXEC,
                )
            };
            if count >= 0 {
                if msg.msg_flags & libc::MSG_CTRUNC != 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::Unsupported,
                        "unexpected X ancillary data",
                    ));
                }
                return Ok(count as usize);
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
            // Unlike DefaultStream's internal retry loop, recheck the deadline
            // on every interrupted syscall, not only once around the operation.
        }
    }
    fn write(&self, buf: &[u8], fds: &mut Vec<RawFdContainer>) -> io::Result<usize> {
        if !fds.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "X descriptor passing is unsupported",
            ));
        }
        loop {
            self.check_deadline()?;
            // SAFETY: buf is readable for its supplied length; the socket is
            // owned/nonblocking. NOSIGNAL prevents peer loss from raising SIGPIPE.
            let count = unsafe {
                libc::send(
                    self.inner.as_raw_fd(),
                    buf.as_ptr().cast(),
                    buf.len(),
                    libc::MSG_DONTWAIT | libc::MSG_NOSIGNAL,
                )
            };
            if count >= 0 {
                return Ok(count as usize);
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::time::Duration;

    #[test]
    fn silent_x_setup_is_bounded_and_closes_the_dedicated_client() {
        let (client, mut peer) = UnixStream::pair().unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        let at = Instant::now();
        let stream = DeadlineStream::from_socket(client, at + Duration::from_millis(75)).unwrap();
        assert!(RustConnection::connect_to_stream(stream, 0).is_err());
        assert!(
            at.elapsed() >= Duration::from_millis(60),
            "waited for the silent peer, not an immediate refusal"
        );
        assert!(at.elapsed() < Duration::from_millis(300));
        let mut request = Vec::new();
        peer.read_to_end(&mut request).unwrap();
        assert!(!request.is_empty(), "x11rb actually sent its setup request");
    }

    #[test]
    fn stalled_reply_and_expired_write_share_the_absolute_deadline() {
        let (client, mut peer) = UnixStream::pair().unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        let at = Instant::now();
        let stream = DeadlineStream::from_socket(client, at + Duration::from_millis(75)).unwrap();
        assert_eq!(
            stream.poll(PollMode::Readable).unwrap_err().kind(),
            io::ErrorKind::TimedOut
        );
        assert_eq!(
            stream
                .write(b"no late request", &mut vec![])
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
        assert!(at.elapsed() < Duration::from_millis(300));
        let mut byte = [0];
        assert_eq!(peer.read(&mut byte).unwrap(), 0);
        assert_eq!(local_display(":12.1"), Some((12, 1)));
        assert_eq!(local_display("remote:12"), None);
        assert_eq!(local_display("localhost:12"), None);
    }

    #[test]
    fn x11rb_reply_and_grab_check_stalls_shutdown_before_connection_drop() {
        use x11rb::protocol::xproto::{ConnectionExt as _, Setup};
        for checked_grab in [false, true] {
            let (client, mut peer) = UnixStream::pair().unwrap();
            peer.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
            let at = Instant::now();
            let stream =
                DeadlineStream::from_socket(client, at + Duration::from_millis(75)).unwrap();
            // Library-provided setup type, not a handwritten X protocol peer.
            let conn = RustConnection::for_connected_stream(
                stream,
                Setup {
                    resource_id_base: 0x20_0000,
                    resource_id_mask: 0x1f_ffff,
                    maximum_request_length: u16::MAX,
                    ..Default::default()
                },
            )
            .unwrap();
            if checked_grab {
                assert!(conn.grab_server().unwrap().check().is_err());
            } else {
                assert!(conn.get_input_focus().unwrap().reply().is_err());
            }
            assert!(at.elapsed() >= Duration::from_millis(60));
            assert!(at.elapsed() < Duration::from_millis(300));
            let mut requests = Vec::new();
            peer.read_to_end(&mut requests).unwrap();
            assert!(!requests.is_empty(), "the request reached the real socket");
            // conn is deliberately still alive: timeout itself must disconnect,
            // not wait for later snapshot/queue destruction to release a grab.
            drop(conn);
        }
    }
}
