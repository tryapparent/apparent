//! Bounded delivery to the private Electron child. Capture never waits for its reader.
use std::{
    io::{self, Write},
    os::fd::AsRawFd,
    process::ChildStdin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

const MAX_MESSAGES: usize = 32;
const MAX_BYTES: usize = 16 * 1024 * 1024;
const DEADLINE: Duration = Duration::from_secs(2);

struct Shared {
    stopped: AtomicBool,
    bytes: AtomicUsize,
    lost: Box<dyn Fn() + Send + Sync>,
    acknowledgements: Mutex<std::collections::VecDeque<(String,Instant)>>,
}
impl Shared {
    fn fail(&self) {
        if !self.stopped.swap(true, Ordering::AcqRel) {
            (self.lost)();
        }
    }
}

struct Message {
    bytes: Vec<u8>,
    queued: Instant,
}

pub(super) struct Input {
    queue: mpsc::SyncSender<Message>,
    shared: Arc<Shared>,
    max_bytes: usize,
}

impl Input {
    pub(super) fn new(
        pipe: ChildStdin,
        lost: impl Fn() + Send + Sync + 'static,
    ) -> io::Result<Self> {
        Self::with_limits(pipe, lost, MAX_MESSAGES, MAX_BYTES, DEADLINE)
    }

    fn with_limits(
        mut pipe: ChildStdin,
        lost: impl Fn() + Send + Sync + 'static,
        messages: usize,
        max_bytes: usize,
        deadline: Duration,
    ) -> io::Result<Self> {
        // Only this worker owns the descriptor. O_NONBLOCK also bounds retirement
        // when a live child stops reading without closing its output.
        let fd = pipe.as_raw_fd();
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let (queue, receiver) = mpsc::sync_channel::<Message>(messages);
        let shared = Arc::new(Shared {
            stopped: AtomicBool::new(false),
            bytes: AtomicUsize::new(0),
            lost: Box::new(lost),
            acknowledgements: Mutex::new(std::collections::VecDeque::new()),
        });
        let monitor=shared.clone();
        std::thread::Builder::new().name("onboarding-ack".into()).spawn(move || {
            while !monitor.stopped.load(Ordering::Acquire) {
                let expired=monitor.acknowledgements.lock().unwrap().front().is_some_and(|(_,time)|time.elapsed()>=deadline);
                if expired {monitor.fail();break;}
                std::thread::sleep(Duration::from_millis(10));
            }
        })?;
        let worker = shared.clone();
        std::thread::Builder::new()
            .name("onboarding-input".into())
            .spawn(move || {
                while !worker.stopped.load(Ordering::Acquire) {
                    let message = match receiver.recv() {
                        Ok(message) => message,
                        Err(_) => break,
                    };
                    let mut offset = 0;
                    while offset < message.bytes.len() && !worker.stopped.load(Ordering::Acquire) {
                        // Deadline includes queue residence, not just time inside write.
                        if message.queued.elapsed() >= deadline {
                            worker.fail();
                            break;
                        }
                        match pipe.write(&message.bytes[offset..]) {
                            Ok(0) => {
                                worker.fail();
                                break;
                            }
                            Ok(n) => offset += n,
                            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                                std::thread::sleep(Duration::from_millis(5))
                            }
                            Err(_) => {
                                worker.fail();
                                break;
                            }
                        }
                    }
                    worker
                        .bytes
                        .fetch_sub(message.bytes.len(), Ordering::AcqRel);
                }
            })?;
        Ok(Self {
            queue,
            shared,
            max_bytes,
        })
    }

    pub(super) fn expect(&self, sequence:String) {
        let mut pending=self.shared.acknowledgements.lock().unwrap();
        if pending.len()>=MAX_MESSAGES {drop(pending);self.shared.fail();return;}
        pending.push_back((sequence,Instant::now()));
    }
    pub(super) fn ack(&self, sequence:&str) {
        let mut pending=self.shared.acknowledgements.lock().unwrap();
        if pending.front().is_some_and(|(id,_)|id==sequence) {pending.pop_front();}
        else {drop(pending);self.shared.fail();}
    }

    /// Already-serialized JSON line, including its newline. Never drop a barrier
    /// and continue: overflow revokes the transport through its scoped EOF path.
    pub(super) fn send(&self, bytes: Vec<u8>) -> bool {
        if self.shared.stopped.load(Ordering::Acquire) {
            return false;
        }
        let len = bytes.len();
        if self
            .shared
            .bytes
            .try_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                used.checked_add(len)
                    .filter(|total| *total <= self.max_bytes)
            })
            .is_err()
        {
            self.shared.fail();
            return false;
        }
        if self
            .queue
            .try_send(Message {
                bytes,
                queued: Instant::now(),
            })
            .is_err()
        {
            self.shared.bytes.fetch_sub(len, Ordering::AcqRel);
            self.shared.fail();
            return false;
        }
        true
    }
}

impl Drop for Input {
    fn drop(&mut self) {
        self.shared.stopped.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Read,
        process::{Child, Command, Stdio},
    };

    struct Process(Child);
    impl Drop for Process {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    fn child(program: &str) -> Process {
        let mut command = Command::new(program);
        if program == "sleep" {
            command.arg("30");
        }
        Process(
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap(),
        )
    }
    fn input(child: &mut Process, messages: usize, bytes: usize) -> (Input, mpsc::Receiver<()>) {
        let (tx, rx) = mpsc::channel();
        let input = Input::with_limits(
            child.0.stdin.take().unwrap(),
            move || {
                let _ = tx.send(());
            },
            messages,
            bytes,
            Duration::from_millis(100),
        )
        .unwrap();
        (input, rx)
    }

    #[test]
    fn live_reader_without_policy_ack_expires_even_after_consuming_the_entire_line() {
        let mut child=child("cat");let (input,lost)=input(&mut child,32,MAX_BYTES);
        input.expect("1".into());assert!(input.send(b"fact\n".to_vec()));
        let mut bytes=[0;5];child.0.stdout.as_mut().unwrap().read_exact(&mut bytes).unwrap();
        assert_eq!(&bytes,b"fact\n");
        lost.recv_timeout(Duration::from_secs(2)).expect("reading is not acknowledgement");
        assert!(child.0.try_wait().unwrap().is_none());
    }
    #[test]
    fn timely_ack_retires_deadline_and_wrong_ack_revokes() {
        let mut child=child("cat");let (input,lost)=input(&mut child,32,MAX_BYTES);
        input.expect("1".into());input.ack("1");
        assert!(lost.recv_timeout(Duration::from_millis(180)).is_err());
        input.expect("2".into());input.ack("1");lost.recv_timeout(Duration::from_secs(1)).unwrap();
    }

    #[test]
    fn real_pipe_preserves_complete_json_line_order() {
        let mut child = child("cat");
        let (input, lost) = input(&mut child, 32, MAX_BYTES);
        let expected = b"{\"type\":\"reset\"}\n{\"type\":\"ink\"}\n{\"type\":\"saved\"}\n";
        for line in expected.split_inclusive(|byte| *byte == b'\n') {
            assert!(input.send(line.to_vec()));
        }
        let mut actual = vec![0; expected.len()];
        child
            .0
            .stdout
            .as_mut()
            .unwrap()
            .read_exact(&mut actual)
            .unwrap();
        assert_eq!(actual, expected);
        assert!(lost.try_recv().is_err());
    }

    #[test]
    fn stalled_live_reader_never_blocks_sender_and_expires_once() {
        let mut child = child("sleep");
        let (input, lost) = input(&mut child, 32, MAX_BYTES);
        let start = Instant::now();
        assert!(input.send(vec![b'x'; 1024 * 1024]));
        assert!(
            start.elapsed() < Duration::from_millis(50),
            "GUI sender waited for pipe capacity"
        );
        lost.recv_timeout(Duration::from_secs(2))
            .expect("live nonreader must revoke transport");
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "deadline must work without child EOF"
        );
        assert!(!input.send(b"late\n".to_vec()));
        assert!(lost.try_recv().is_err(), "failure is emitted once");
    }

    #[test]
    fn deadline_includes_time_queued_even_when_the_pipe_is_writable() {
        let mut child = child("cat");
        let (input, lost) = input(&mut child, 32, MAX_BYTES);
        let bytes = b"expired barrier\n".to_vec();
        input.shared.bytes.fetch_add(bytes.len(), Ordering::AcqRel);
        input
            .queue
            .try_send(Message {
                bytes,
                queued: Instant::now() - Duration::from_secs(2),
            })
            .unwrap();
        lost.recv_timeout(Duration::from_secs(1)).unwrap();
        let mut output = Vec::new();
        child
            .0
            .stdout
            .as_mut()
            .unwrap()
            .read_to_end(&mut output)
            .unwrap();
        assert!(
            output.is_empty(),
            "expired barriers must not be delivered late"
        );
    }

    #[test]
    fn byte_overflow_revokes_instead_of_silently_dropping_a_barrier() {
        let mut child = child("sleep");
        let (input, lost) = input(&mut child, 32, 100);
        assert!(!input.send(vec![b'x'; 101]));
        lost.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(!input.send(b"reset\n".to_vec()));
        assert!(lost.try_recv().is_err());
    }

    #[test]
    fn event_overflow_revokes_a_blocked_queue() {
        let mut child = child("sleep");
        let (input, lost) = input(&mut child, 1, MAX_BYTES);
        assert!(input.send(vec![b'x'; 1024 * 1024]));
        // At most one write is in flight and one message is queued.
        let accepted = (0..3)
            .take_while(|_| input.send(b"barrier\n".to_vec()))
            .count();
        assert!(accepted <= 1);
        lost.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(!input.send(b"saved\n".to_vec()));
    }

    #[test]
    fn broken_pipe_reports_loss_without_waiting_for_stdout_eof() {
        let mut child = child("sleep");
        let (input, lost) = input(&mut child, 32, MAX_BYTES);
        child.0.kill().unwrap();
        child.0.wait().unwrap();
        assert!(input.send(b"state\n".to_vec()));
        lost.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(!input.send(b"later\n".to_vec()));
    }

    #[test]
    fn retirement_cancels_a_stalled_writer_without_false_failure() {
        let mut child = child("sleep");
        let (input, lost) = input(&mut child, 32, MAX_BYTES);
        assert!(input.send(vec![b'x'; 1024 * 1024]));
        let shared = input.shared.clone();
        let start = Instant::now();
        drop(input);
        while Arc::strong_count(&shared) > 1 && start.elapsed() < Duration::from_secs(1) {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            Arc::strong_count(&shared),
            1,
            "writer and descriptor retired"
        );
        assert!(
            lost.try_recv().is_err(),
            "intentional retirement is not a crash"
        );
    }
}
