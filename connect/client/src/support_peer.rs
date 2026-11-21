use anyhow::{Result, ensure};

pub fn check_support_peer(uid: u32) -> Result<()> {
    let fd = 3;
    let mut address: libc::sockaddr_storage = unsafe { std::mem::zeroed() };
    let mut address_len = std::mem::size_of_val(&address) as libc::socklen_t;
    let address_result = unsafe {
        libc::getsockname(fd, (&mut address as *mut libc::sockaddr_storage).cast(), &mut address_len)
    };
    ensure!(address_result == 0 && i32::from(address.ss_family) == libc::AF_UNIX,
        "Support peer descriptor must be a Unix socket");
    let mut peer: libc::ucred = unsafe { std::mem::zeroed() };
    let mut peer_len = std::mem::size_of_val(&peer) as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(fd, libc::SOL_SOCKET, libc::SO_PEERCRED,
            (&mut peer as *mut libc::ucred).cast(), &mut peer_len)
    };
    ensure!(result == 0 && peer_len as usize == std::mem::size_of_val(&peer) && peer.pid > 0,
        "Support peer credentials unavailable");
    ensure!(uid != 0 && uid != unsafe { libc::geteuid() } && peer.uid == uid,
        "Support peer is not the configured agent account");
    Ok(())
}
