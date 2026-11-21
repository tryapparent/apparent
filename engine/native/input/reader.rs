fn read_loop(fds: Vec<OwnedFd>) {
    let clocks: Vec<_> = fds
        .iter()
        .map(|fd| {
            let clock = libc::CLOCK_MONOTONIC;
            if unsafe { libc::ioctl(fd.as_raw_fd(), 0x400445a0_u64 as libc::c_ulong, &clock) } == 0
            {
                clock
            } else {
                libc::CLOCK_REALTIME
            }
        })
        .collect();
    let axes: Vec<Option<[(i32, i32); 2]>> = fds.iter().map(absolute_axes).collect();
    let mut polls: Vec<libc::pollfd> = fds
        .iter()
        .map(|fd| libc::pollfd {
            fd: fd.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        })
        .collect();
    let mut pending = ReadBuffers::new(&clocks);
    loop {
        let timeout = if pending.queues.iter().all(VecDeque::is_empty) {
            1_000
        } else {
            0
        };
        let ready = unsafe { libc::poll(polls.as_mut_ptr(), polls.len() as _, timeout) };
        if ready < 0 {
            std::thread::sleep(Duration::from_millis(100));
            continue;
        }
        let events = read_ready_events(&mut polls, &axes, &clocks, &mut pending);
        if let Some(reader) = READER.get() {
            if polls.iter().any(|poll| poll.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0)
                || events.iter().any(|event| event.kind == EV_SYN && event.code == SYN_DROPPED)
            {
                reader.shortcut_state_lost.store(true, Ordering::Release);
            }
            apply_events(reader, events);
        }
    }
}
