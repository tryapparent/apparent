//! Bounded, parent-owned stdio transport. Rendering cannot own capture lifetime.
use super::{Command as Action, View};
mod diagnostics;
use diagnostics::{Observation, ReaderStop, WriterStop};
include!("../../../../engine/diagnostics/performance/pill_session.rs");
use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Default)]
struct Mailbox {
    state: Option<serde_json::Value>,
    place: Option<[f64; 2]>,
    position: Option<(u64, [f64; 2])>,
    activate: Option<u32>,
    closed: bool,
    completions: std::collections::VecDeque<serde_json::Value>,
}

pub type Selection = (Option<PathBuf>, Option<PathBuf>);

pub struct Session {
    completion_generations: std::collections::HashSet<u64>,
    t3_eligible: bool,
    mailbox: Arc<(Mutex<Mailbox>, Condvar)>,
    activated: Arc<AtomicBool>,
    activation: Option<Instant>,
    actions: flume::Receiver<(Instant, Action)>,
    alive: Arc<AtomicBool>,
    observation: Arc<Mutex<Observation>>,
    ready: Arc<AtomicBool>,
    window_changed: Arc<AtomicBool>,
    hovered: Arc<AtomicBool>,
    sharing_confirmation: Arc<Mutex<Option<u64>>>,
    moved: Arc<AtomicBool>,
    child: Option<crate::capture::ui_process::UiChild>,
    opened: Instant,
    sent: Instant,
    pub view: View,
    generation: u64,
    selection: Selection,
    window_id: Arc<AtomicU32>,
    child_pid: u32,
    #[cfg(all(test, target_os = "linux"))]
    pin: Arc<AtomicBool>,
    #[cfg(target_os = "linux")]
    pin_admission: Arc<Mutex<super::pin::Admission>>,
    #[cfg(target_os = "linux")]
    drag_position: Arc<Mutex<Option<[f64; 4]>>>,
    frame: Arc<Mutex<Option<(u64, [f64; 4], Instant)>>>,
}

fn assets() -> Option<(PathBuf, PathBuf)> {
    let executable = std::env::current_exe().ok()?;
    let parent = executable.parent()?;
    #[cfg(target_os = "macos")]
    let root = parent.parent()?.join("Resources/settings");
    #[cfg(target_os = "linux")]
    let root = parent.parent()?.join("share/apparent/settings");
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend");
    let mut candidates = vec![(root.join("app"), root.join("runtime"))];
    if cfg!(debug_assertions) {
        candidates.push((source.clone(), source.join("node_modules/electron/dist")));
    }
    for (app, runtime) in candidates {
        #[cfg(target_os = "macos")]
        let runtime = runtime.join("Electron.app/Contents/MacOS/Electron");
        #[cfg(target_os = "linux")]
        let runtime = runtime.join("electron");
        if runtime.is_file()
            && app.join("dist/pill/index.html").is_file()
            && app.join("electron/pill/main.cjs").is_file()
        {
            return Some((app, runtime));
        }
    }
    None
}

impl Session {
    pub fn set_t3_eligible(&mut self, eligible: bool) { self.t3_eligible = eligible; }

    pub fn has_completion(&self, generation: u64) -> bool {
        self.completion_generations.contains(&generation)
    }

    /// Private finalizer facts survive UI dismissal and never enter the renderer.
    pub fn complete(&mut self, generation: u64, text: Option<String>) {
        if self.has_completion(generation) { return; }
        let (lock, wake) = &*self.mailbox;
        let mut pending = lock.lock().unwrap();
        if pending.completions.len() >= 64 { return; }
        pending.completions.push_back(serde_json::json!({"type":"handoff-ready",
            "capture":Self::capture_key(generation),"text":text}));
        self.completion_generations.insert(generation);
        if self.completion_generations.len() > 64 {
            if let Some(oldest) = self.completion_generations.iter().copied().min() {
                self.completion_generations.remove(&oldest);
            }
        }
        wake.notify_one();
    }

    pub fn open(mut view: View, generation: u64, selection: Selection) -> anyhow::Result<Self> {
        view.read_doodles(None);
        let (app, runtime) =
            assets().ok_or_else(|| anyhow::anyhow!("Packaged recording pill unavailable"))?;
        let mut launch = Command::new(&runtime);
        #[cfg(target_os = "linux")]
        {
            launch.arg("--ozone-platform=x11");
            launch.arg(format!("--force-device-scale-factor={}", crate::capture::desktop::linux::x11::ui_scale()));
        }
        launch.arg(app.join("electron/pill/main.cjs"));
        crate::capture::desktop::workflow::electron::configure_sandbox(&mut launch, &runtime)?;
        let mut child = launch
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let mut stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let child_pid = child.id();
        let alive = Arc::new(AtomicBool::new(true));
        let observation = Arc::new(Mutex::new(Observation::default()));
        let ready = Arc::new(AtomicBool::new(false));
        let window_id = Arc::new(AtomicU32::new(0));
        let window_changed = Arc::new(AtomicBool::new(false));
        let changed_window = window_changed.clone();
        let identified = window_id.clone();
        let frame = Arc::new(Mutex::new(None));
        let frame_readback = frame.clone();
        let mailbox = Arc::new((Mutex::new(Mailbox::default()), Condvar::new()));
        let outgoing = mailbox.clone();
        let writing = alive.clone();
        let write_observation = observation.clone();
        std::thread::spawn(move || {
            let stopped = 'writer: loop {
                let (lock, wake) = &*outgoing;
                let mut pending = lock.lock().unwrap();
                while !pending.closed
                    && pending.state.is_none()
                    && pending.place.is_none()
                    && pending.position.is_none()
                    && pending.activate.is_none()
                    && pending.completions.is_empty()
                {
                    pending = wake.wait(pending).unwrap();
                }
                if pending.closed {
                    break WriterStop::OwnerClosed;
                }
                let state = pending.state.take();
                let completions = std::mem::take(&mut pending.completions);
                let place = pending.place.take();
                let position = pending.position.take();
                let activate = pending.activate.take();
                drop(pending);
                let messages = position
                    .map(|(revision, point)| serde_json::json!({"type":"position","revision":revision,"point":point}))
                    .into_iter()
                    .chain(place
                    .map(|point| serde_json::json!({"type":"place","point":point}))
                    .into_iter())
                    .chain(completions)
                    .chain(state)
                    .chain(activate.map(|id| serde_json::json!({"type":"activate","windowId":id})));
                for message in messages {
                    if serde_json::to_writer(&mut stdin, &message).is_err() {
                        break 'writer WriterStop::FrameWrite;
                    }
                    if stdin.write_all(b"\n").is_err() {
                        break 'writer WriterStop::NewlineWrite;
                    }
                    if stdin.flush().is_err() {
                        break 'writer WriterStop::Flush;
                    }
                    observe_flushed_state(&write_observation, &message);
                }
            };
            write_observation.lock().unwrap().writer_stop = Some(stopped);
            writing.store(false, Ordering::Release);
        });
        let activated = Arc::new(AtomicBool::new(false));
        let acknowledged = activated.clone();
        let (commands, actions) = flume::bounded(16);
        let hovered = Arc::new(AtomicBool::new(false));
        let hovering = hovered.clone();
        let sharing_confirmation = Arc::new(Mutex::new(None));
        let confirmation = sharing_confirmation.clone();
        let moved = Arc::new(AtomicBool::new(false));
        let moving = moved.clone();
        let pin_needed = Arc::new(AtomicBool::new(false));
        #[cfg(target_os = "linux")]
        let pin_admission = Arc::new(Mutex::new(super::pin::Admission::default()));
        #[cfg(target_os = "linux")]
        let read_admission = pin_admission.clone();
        let pin_context = Arc::new(Mutex::new(None::<String>));
        #[cfg(target_os = "linux")]
        let pin_request = pin_needed.clone();
        #[cfg(target_os = "linux")]
        let pin_diagnostics = pin_context.clone();
        let reading = alive.clone();
        let read_observation = observation.clone();
        let mounted = ready.clone();
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stdout);
            #[cfg(target_os = "linux")]
            let mut motion_rules = Vec::new();
            let stopped = loop {
                let line = match diagnostics::read_frame(&mut reader) {
                    Ok(line) => line,
                    Err(reason) => break reason,
                };
                {
                    let value = match serde_json::from_slice::<serde_json::Value>(&line) {
                        Ok(value) => value,
                        Err(_) => break ReaderStop::InvalidJson,
                    };
                    #[cfg(target_os = "linux")]
                    if let Some(id) = value.get("releasePickerFocus").and_then(|v| v.as_u64()) {
                        let current = identified.load(Ordering::Acquire);
                        if current != 0 && id == u64::from(current)
                            && crate::capture::desktop::linux::hyprland::running()
                            && let Err(error) = crate::capture::desktop::linux::hyprland::release_pill_focus(current, child_pid)
                        {
                            crate::capture::engine::runtime::apparent_log(format!("Pill focus release failed: {error:#}"));
                        }
                        continue;
                    }
                    #[cfg(target_os = "linux")]
                    if let Some(id) = value.get("retiredWindowId").and_then(|v| v.as_u64()).and_then(|id| u32::try_from(id).ok()) {
                        if id != identified.load(Ordering::Acquire)
                            && let Some(index) = motion_rules.iter().position(|old| *old == id)
                        {
                            match crate::capture::desktop::linux::hyprland::release_pill_motion(id, child_pid) {
                                Ok(()) => { motion_rules.remove(index); }
                                Err(error) => crate::capture::engine::runtime::apparent_log(format!("Retired pill motion cleanup failed: {error:#}")),
                            }
                        }
                        continue;
                    }
                    if value.get("activated").and_then(|v| v.as_bool()) == Some(true)
                        && let Some(id) = value.get("windowId").and_then(|v| v.as_u64())
                    {
                        if id == u64::from(identified.load(Ordering::Acquire)) {
                            acknowledged.store(true, Ordering::Release);
                        }
                        continue;
                    }
                    if let Some(frame) = value.get("frame") {
                        let Some(receipt) = geometry_receipt(&value, frame) else {
                            break ReaderStop::InvalidFrame;
                        };
                        *frame_readback.lock().unwrap() = Some(receipt);
                        continue;
                    }
                    if value.get("pin").and_then(|v| v.as_bool()) == Some(true) {
                        let phase = value.get("phase").and_then(|v| v.as_str())
                            .filter(|phase| matches!(*phase, "hidden" | "selecting" | "recording" | "processing" | "completed"))
                            .unwrap_or("unknown");
                        *pin_context.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(format!(
                            "phase={phase} child_activated={:?} renderer_ready={:?} visible={:?}",
                            value.get("activated").and_then(|v| v.as_bool()),
                            value.get("rendererReady").and_then(|v| v.as_bool()),
                            value.get("visible").and_then(|v| v.as_bool()),
                        ));
                        pin_needed.store(true, Ordering::Release);
                        continue;
                    }
                    if value.get("ready").and_then(|v| v.as_bool()) == Some(true) {
                        let Some(id) = value
                            .get("windowId")
                            .and_then(|v| v.as_u64())
                            .and_then(|v| u32::try_from(v).ok())
                            .filter(|v| *v != 0)
                        else {
                            break ReaderStop::InvalidWindowId;
                        };
                        let previous = identified.load(Ordering::Acquire);
                        #[cfg(target_os = "linux")]
                        if previous != 0 && previous != id {
                            read_admission.lock().unwrap().replace_window();
                        }
                        identified.store(id, Ordering::Release);
                        #[cfg(target_os = "linux")]
                        if crate::capture::desktop::linux::hyprland::running() && !motion_rules.contains(&id) {
                            if motion_rules.len() >= 16 { break ReaderStop::PinPreparation; }
                            match crate::capture::desktop::linux::hyprland::prepare_pill_motion(id, child_pid) {
                                Ok(true) => motion_rules.push(id),
                                Ok(false) => {}, // Older Hyprlang retains compositor-owned motion.
                                Err(error) => {
                                    crate::capture::engine::runtime::apparent_log(format!("Pill motion preparation failed: {error:#}"));
                                    // Even a partial registration must be retired.
                                    motion_rules.push(id);
                                    break ReaderStop::PinPreparation;
                                }
                            }
                        }
                        if previous != 0 && previous != id {
                            changed_window.store(true, Ordering::Release);
                        }
                        mounted.store(true, Ordering::Release);
                        continue;
                    }
                    if value.get("moved").and_then(|v| v.as_bool()) == Some(true) {
                        moving.store(true, Ordering::Release);
                        continue;
                    }
                    if let Some(active) = value.get("sharingConfirmation").and_then(|v| v.as_bool()) {
                        let Some(revision) = value.get("revision").and_then(|v| v.as_u64()) else { break ReaderStop::InvalidCommand; };
                        let mut held = confirmation.lock().unwrap();
                        if active { *held = Some(revision); }
                        else if *held == Some(revision) { *held = None; }
                        continue;
                    }
                    if let Some(value) = value.get("hovered").and_then(|v| v.as_bool()) {
                        hovering.store(value, Ordering::Release);
                        continue;
                    }
                }
                let Ok(command) = serde_json::from_slice::<Action>(&line) else {
                    break ReaderStop::InvalidCommand;
                };
                match commands.try_send((Instant::now(), command)) {
                    Ok(()) => {},
                    Err(flume::TrySendError::Full(_)) => break ReaderStop::ActionQueueFull,
                    Err(flume::TrySendError::Disconnected(_)) => break ReaderStop::ActionQueueClosed,
                }
            };
            read_observation.lock().unwrap().reader_stop = Some(stopped);
            reading.store(false, Ordering::Release);
            #[cfg(target_os = "linux")]
            for id in motion_rules {
                if let Err(error) = crate::capture::desktop::linux::hyprland::release_pill_motion(id, child_pid) {
                    crate::capture::engine::runtime::apparent_log(format!("Pill motion cleanup failed: {error:#}"));
                }
            }
        });
        let mut session = Self {
            completion_generations: Default::default(),
            t3_eligible: false,
            mailbox,
            activated,
            activation: None,
            actions,
            alive,
            observation,
            ready,
            window_changed,
            hovered,
            sharing_confirmation,
            moved,
            child: Some(crate::capture::ui_process::UiChild::new(child)),
            opened: Instant::now(),
            sent: Instant::now() - Duration::from_secs(1),
            view,
            generation,
            selection,
            window_id,
            child_pid,
            #[cfg(all(test, target_os = "linux"))]
            pin: pin_request.clone(),
            #[cfg(target_os = "linux")]
            pin_admission,
            #[cfg(target_os = "linux")]
            drag_position: Arc::new(Mutex::new(None)),
            frame,
        };
        #[cfg(target_os = "linux")]
        if crate::capture::desktop::linux::hyprland::running() {
            let alive = session.alive.clone();
            let id = session.window_id.clone();
            let activated = session.activated.clone();
            let admission = session.pin_admission.clone();
            std::thread::spawn(move || {
                // Compositor requests can block; neither GUI ticks nor the state
                // writer may wait for them. Coalesce remap/drag notifications.
                while alive.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(120));
                    // Preserve an early/coalesced request until main acknowledges
                    // activation. A hidden surface cannot satisfy native admission.
                    if !activated.load(Ordering::Acquire)
                        || !pin_request.swap(false, Ordering::AcqRel)
                    {
                        continue;
                    }
                    let Some(epoch) = admission.lock().unwrap().begin() else { continue; };
                    let context = pin_diagnostics.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
                        .clone().unwrap_or_else(|| "presentation context unavailable".into());
                    let xid = id.load(Ordering::Acquire);
                    let current = || alive.load(Ordering::Acquire)
                        && id.load(Ordering::Acquire) == xid
                        && crate::capture::ui_process::owns(child_pid as i32);
                    let error = super::pin::reconcile(&admission, epoch, current, || {
                        anyhow::ensure!(xid != 0, "Recording pill has no native window identity");
                        crate::capture::desktop::linux::hyprland::pin_pill_for_process(xid, child_pid, || {
                            current() && admission.lock().unwrap().current(epoch)
                        })
                    }, || std::thread::sleep(Duration::from_millis(120)));
                    if let Some(error) = error {
                        crate::capture::engine::runtime::apparent_log(format!(
                            "Electron recording pill: could not pin on Hyprland: {error:#} ({context}; activation_ack={})",
                            activated.load(Ordering::Acquire),
                        ));
                    }
                }
            });
        }
        session.send();
        Ok(session)
    }
    pub fn window_number(&self) -> Option<u32> {
        match self.window_id.load(Ordering::Acquire) {
            0 => None,
            id => Some(id),
        }
    }
    pub fn healthy(&self) -> bool {
        #[cfg(target_os = "linux")]
        if !self.pin_admission.lock().unwrap().healthy() { return false; }
        self.alive.load(Ordering::Acquire)
            && (self.ready() || self.opened.elapsed() < Duration::from_secs(5))
            && self.activation.is_none_or(|since| {
                self.activated.load(Ordering::Acquire) || since.elapsed() < Duration::from_secs(1)
            })
    }
    /// Sample before recovery drops/kills the exact owned child. These are
    /// observations only; the existing health and dispatch gates stay authoritative.
    pub(super) fn failure_context(&mut self) -> serde_json::Value {
        let child = self.child.as_mut().map(|child| diagnostics::child_status(child.try_wait()));
        serde_json::json!({
            "pid": self.child_pid,
            "child": child,
            "alive": self.alive.load(Ordering::Acquire),
            "ready": self.ready(),
            "age_ms": self.opened.elapsed().as_millis(),
            "activation_ack": self.activated.load(Ordering::Acquire),
            "activation_age_ms": self.activation.map(|at| at.elapsed().as_millis()),
            "last_queued_state": {
                "phase": diagnostics::known_phase(&self.view.phase),
                "revision": self.view.revision,
                "age_ms": self.sent.elapsed().as_millis(),
            },
            "pipe": self.observation.lock().unwrap().snapshot(),
        })
    }
    pub fn ready(&self) -> bool {
        self.ready.load(Ordering::Acquire)
    }
    pub fn take_window_changed(&self) -> bool {
        self.window_changed.swap(false, Ordering::AcqRel)
    }
    pub fn moved(&self) -> bool {
        self.moved.load(Ordering::Acquire)
    }
    pub fn hovered(&self) -> bool {
        self.hovered.load(Ordering::Acquire)
    }
    pub fn confirming_public_share(&self) -> bool {
        self.alive.load(Ordering::Acquire) && self.ready()
            && self.view.admits_sharing_confirmation(*self.sharing_confirmation.lock().unwrap())
    }
    pub fn update(&mut self, mut view: View, generation: u64, selection: Selection) {
        view.read_doodles((self.generation == generation).then_some(&self.view));
        #[cfg(target_os = "linux")]
        {
            let position = self.drag_position.lock().unwrap().take();
            if let Some(rect) = position.filter(|_| generation == self.generation) {
                self.moved.store(true, Ordering::Release);
                let (lock, wake) = &*self.mailbox;
                lock.lock().unwrap().position = Some((self.view.revision, [rect[0], rect[1]]));
                wake.notify_one();
            }
        }
        view.revision = self.view.revision;
        if view.phase == self.view.phase
            && generation == self.generation
            && selection == self.selection
        {
            view.notice = self.view.notice.clone();
        }
        let mut semantic = view.clone();
        semantic.clock.clear();
        semantic.input_waveform = None;
        let transcript_visible = semantic.transcript.is_some();
        semantic.transcript = None;
        let mut previous = self.view.clone();
        previous.clock.clear();
        previous.input_waveform = None;
        let previous_transcript_visible = previous.transcript.is_some();
        previous.transcript = None;
        let changed =
            semantic != previous || transcript_visible != previous_transcript_visible || self.generation != generation || self.selection != selection;
        if changed {
            view.revision += 1;
        }
        self.generation = generation;
        self.selection = selection;
        self.view = view;
        if changed || self.sent.elapsed() >= Duration::from_millis(100) {
            self.send();
        }
    }
    fn send(&mut self) {
        #[cfg(target_os = "linux")]
        self.pin_admission.lock().unwrap().update(self.view.phase != "hidden", self.generation);
        let (lock, wake) = &*self.mailbox;
        lock.lock().unwrap().state = Some(serde_json::json!({"type":"state","view":self.view,
            "capture":Self::capture_key(self.generation),"t3Eligible":self.t3_eligible}));
        self.observation.lock().unwrap().queued_state(&self.view.phase);
        self.sent = Instant::now();
        wake.notify_one();
    }
    pub fn activate(&mut self) {
        self.activation = Some(Instant::now());
        self.activated.store(false, Ordering::Release);
        let (lock, wake) = &*self.mailbox;
        lock.lock().unwrap().activate = self.window_number();
        wake.notify_one();
    }
    pub fn place(&self, point: [f64; 2]) {
        self.moved.store(false, Ordering::Release);
        self.frame.lock().unwrap().take();
        #[cfg(target_os = "linux")]
        self.drag_position.lock().unwrap().take();
        let (lock, wake) = &*self.mailbox;
        let mut pending = lock.lock().unwrap();
        pending.position = None;
        pending.place = Some(point);
        drop(pending);
        wake.notify_one();
    }
    pub fn actions(&mut self) -> Vec<crate::capture::desktop::native::pill::PillAction> {
        let mut admitted = vec![];
        let before = self.view.revision;
        while let Ok((received, command)) = self.actions.try_recv() {
            // A drag changes only this owned window. Rust rechecks the current
            // capture's revision/policy before the native adapter reads the OS
            // button state and geometry. Main supplies the OS press point.
            #[cfg(target_os = "linux")]
            if command.action == "drag" {
                if let (Some(id), Some(point)) = (
                    self.window_number(),
                    self.view.drag_point(&command, received.elapsed() < Duration::from_secs(1)),
                )
                {
                    super::super::linux::begin_electron_pill_drag(
                        id, self.child_pid, self.alive.clone(), self.drag_position.clone(), point.map(f64::from),
                    );
                }
                continue;
            }
            if let Some(action) = self
                .view
                .consume(command, received.elapsed() < Duration::from_secs(1))
            {
                admitted.push(action);
            }
        }
        if self.view.revision != before {
            self.send();
        }
        admitted
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Release);
        let (lock, wake) = &*self.mailbox;
        lock.lock().unwrap().closed = true;
        wake.notify_one();
        if let Some(mut child) = self.child.take() {
            std::thread::spawn(move || {
                for _ in 0..20 {
                    if !matches!(child.try_wait(), Ok(None)) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                let _ = child.kill();
                let _ = child.wait();
            });
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod native_tests {
    use super::*;

    #[test]
    #[ignore = "requires owned disposable Hyprland guest and packaged Electron assets"]
    fn cancelled_native_pin_keeps_child_for_next_capture() {
        assert!(crate::capture::desktop::linux::hyprland::running());
        let view = View {
            revision: 1,
            clock: "00:01".into(),
            notice: None, note_tip: None,
            reduced_motion: true,
            transcript: None,
            input_waveform: None,
            doodle_ink: None,
            presentation: super::super::Presentation {
                phase: "recording".into(),
                ..Default::default()
            },
        };
        let mut session = Session::open(view.clone(), 1, Default::default()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while !session.ready() && Instant::now() < deadline {
            session.update(view.clone(), 1, Default::default());
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(session.ready() && session.healthy());
        session.activate();
        std::thread::sleep(Duration::from_millis(600));
        let mut hidden = view.clone();
        hidden.presentation.phase = "hidden".into();
        session.update(hidden, 1, Default::default());
        // Model a show/resize notification already in flight when Cancel hides
        // the surface. The real worker, child and compositor handle the request.
        session.pin.store(true, Ordering::Release);
        std::thread::sleep(Duration::from_millis(1800));
        assert!(session.healthy());
        session.update(view, 2, Default::default());
        std::thread::sleep(Duration::from_millis(600));
        assert!(session.healthy());
        crate::capture::desktop::linux::hyprland::pin_pill_for_process(
            session.window_number().unwrap(), session.child_pid, || true,
        ).expect("next capture must map the same owned Electron child");
    }
}
