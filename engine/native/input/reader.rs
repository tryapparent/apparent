#[derive(Clone, Copy, Debug)]
pub(crate) struct NoteEdge {
    pub at: Instant,
    pub shift: Option<bool>,
}

impl Held {
    pub(crate) fn note_blocked(&self) -> bool {
        self.keys.iter().any(|code| {
            !matches!(*code, code::KEY_LEFTSHIFT | code::KEY_RIGHTSHIFT | 0x140..=0x14f)
        })
    }

    fn push_note_edge(&mut self, at: Instant, shift: Option<bool>) {
        if self.note_edges.len() == 64 {
            self.note_edges.clear();
            self.note_edges.push_back(NoteEdge { at, shift: None });
        } else {
            self.note_edges.push_back(NoteEdge { at, shift });
        }
    }
}

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

fn take_snapshot(reader: &Reader) -> (Held, VecDeque<NoteEdge>) {
    let mut state = reader
        .held
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let events = std::mem::take(&mut state.button_events);
    let lost = std::mem::take(&mut state.button_events_lost);
    let mut note_edges = std::mem::take(&mut state.note_edges);
    if std::mem::take(&mut state.note_pointer_moved)
        && note_edges.iter().filter(|edge| edge.shift.is_some()).take(2).count() == 2
    {
        let at = note_edges.back().unwrap().at;
        note_edges.clear();
        note_edges.push_back(NoteEdge { at, shift: None });
    }
    let mut held = state.clone();
    held.button_events = events;
    held.button_events_lost = lost;
    held.keys.extend(
        reader
            .pressed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .drain(),
    );
    (held, note_edges)
}

fn apply_events(reader: &Reader, events: Vec<PendingEvent>) {
    let mut held = reader
        .held
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut pressed = reader
        .pressed
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for event in events {
        let PendingEvent {
            kind,
            code,
            value,
            axes,
            at,
            time_source,
            modifiers_known,
        } = event;
        match (kind, axes) {
            (EV_SYN, _) if code == SYN_DROPPED => {
                held.note_edges.clear();
                held.push_note_edge(at, None);
            }
            (EV_KEY, _) if value == 0 || value == 1 => {
                let was_shift = held.shift();
                if value == 1 {
                    held.keys.insert(code);
                    pressed.insert(code);
                } else {
                    held.keys.remove(&code);
                }
                if was_shift != held.shift() && !held.note_blocked() {
                    held.push_note_edge(at, Some(!was_shift));
                } else if value == 1 && !matches!(code, code::KEY_LEFTSHIFT | code::KEY_RIGHTSHIFT | 0x140..=0x14f) {
                    held.push_note_edge(at, None);
                }
                if matches!(code, code::BTN_LEFT | code::BTN_RIGHT) {
                    if held.button_events.len() == 512 {
                        held.button_events.remove(0);
                        held.button_events_lost = true;
                        crate::capture::engine::runtime::apparent_log(
                            "input button queue overflow",
                        );
                    }
                    let modifiers = ButtonModifiers::from_held(&held);
                    held.button_events.push(ButtonEvent {
                        at,
                        time_source,
                        button: code,
                        pressed: value == 1,
                        modifiers,
                        modifiers_known,
                    });
                }
            }
            (EV_ABS, Some(ranges)) if code == ABS_X || code == ABS_Y => {
                let (min, max) = ranges[usize::from(code)];
                let at = f64::from(value - min) / f64::from(max - min);
                let mut point = held.absolute.unwrap_or([0.5, 0.5]);
                point[usize::from(code)] = at.clamp(0.0, 1.0);
                held.note_pointer_moved |= held.absolute != Some(point);
                held.absolute = Some(point);
            }
            (EV_REL, _) if code == REL_X || code == REL_Y => {
                held.note_pointer_moved |= value != 0;
                held.absolute = None;
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod note_edge_tests {
    use super::*;

    fn reader() -> Reader {
        Reader {
            shortcut_state_lost: AtomicBool::new(false),
            held: Mutex::new(Held::default()),
            pressed: Mutex::new(HashSet::new()),
        }
    }

    #[test]
    fn delayed_poll_retains_both_shift_taps_and_interruption() {
        let reader = reader();
        let at = Instant::now();
        let event = |code, value, offset| PendingEvent {
            kind: EV_KEY,
            code,
            value,
            axes: None,
            at: at + Duration::from_millis(offset),
            time_source: "evdev_monotonic",
            modifiers_known: true,
        };
        let shift = code::KEY_LEFTSHIFT;
        apply_events(&reader, vec![
            event(shift, 1, 0), event(shift, 0, 60),
            event(shift, 1, 68), event(shift, 0, 128),
            event(code::KEY_ESC, 1, 200), event(code::KEY_ESC, 0, 208),
        ]);
        let (_, edges) = take_snapshot(&reader);
        assert_eq!(
            edges.into_iter().map(|edge| (edge.at.duration_since(at).as_millis(), edge.shift)).collect::<Vec<_>>(),
            [(0, Some(true)), (60, Some(false)), (68, Some(true)), (128, Some(false)), (200, None)]
        );
        assert!(take_snapshot(&reader).1.is_empty());
    }

    #[test]
    fn coalesced_shift_edges_with_pointer_motion_interrupt_note_placement() {
        let reader = reader();
        let start = Instant::now();
        let event = |kind, code, value, offset| PendingEvent {
            kind,
            code,
            value,
            axes: None,
            at: start + Duration::from_millis(offset),
            time_source: "evdev_monotonic",
            modifiers_known: true,
        };
        apply_events(&reader, vec![
            event(EV_KEY, code::KEY_LEFTSHIFT, 1, 0),
            event(EV_REL, REL_X, 20, 10),
            event(EV_KEY, code::KEY_LEFTSHIFT, 0, 20),
        ]);
        let (_, edges) = take_snapshot(&reader);
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].shift, None);
    }

}
