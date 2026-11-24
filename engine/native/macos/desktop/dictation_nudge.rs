use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    ptr::NonNull,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, channel},
    },
    time::{Duration, Instant},
};

use crate::shared::handoff::{default_config_path, preference_value, update_config_in};

include!(concat!(env!("OUT_DIR"), "/frog-nudge.rs"));

const APPS: [(&str, &str); 2] = [
    ("com.electron.wispr-flow", "dictationFrogAlternation"),
    ("com.superduper.superwhisper", "superwhisperFrogAlternation"),
];

use objc2::rc::autoreleasepool;
use objc2_app_kit::NSRunningApplication;
use objc2_core_audio::{
    AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectPropertyAddress,
    kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyElementMain,
    kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject, kAudioProcessPropertyBundleID,
    kAudioProcessPropertyIsRunningInput, kAudioProcessPropertyPID,
};
use objc2_core_foundation::{CFRetained, CFString};
use objc2_foundation::NSString;

fn property(selector: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    }
}

fn read<T>(object: u32, selector: u32, data: &mut [T], size: &mut u32) -> bool {
    unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&mut property(selector)),
            0,
            std::ptr::null(),
            NonNull::from(size),
            NonNull::from(data).cast(),
        ) == 0
    }
}

fn read_one<T: Default>(object: u32, selector: u32) -> Option<T> {
    let mut data = [T::default()];
    let mut bytes = std::mem::size_of::<T>() as u32;
    if !read(object, selector, &mut data, &mut bytes) || bytes as usize != std::mem::size_of::<T>()
    {
        return None;
    }
    let [value] = data;
    Some(value)
}

fn mic_state(bundle_id: &str) -> usize {
    autoreleasepool(|_| {
        let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(
            &NSString::from_str(bundle_id),
        );
        if apps.is_empty() {
            return 0;
        }
        let system = kAudioObjectSystemObject as u32;
        let list = kAudioHardwarePropertyProcessObjectList;
        let mut bytes = 0;
        let status = unsafe {
            AudioObjectGetPropertyDataSize(
                system,
                NonNull::from(&mut property(list)),
                0,
                std::ptr::null(),
                NonNull::from(&mut bytes),
            )
        };
        if status != 0 || bytes % 4 != 0 || bytes > 64 * 1024 {
            return 0;
        }
        if bytes == 0 {
            return 1;
        }
        let mut objects = vec![0_u32; bytes as usize / 4];
        if !read(system, list, &mut objects, &mut bytes) {
            return 0;
        }
        let mut unresolved = false;
        for object in objects.into_iter().take(bytes as usize / 4) {
            let bundle = read_one::<*mut CFString>(object, kAudioProcessPropertyBundleID)
                .and_then(NonNull::new)
                .map(|ptr| unsafe { CFRetained::from_raw(ptr) }.to_string());
            let identified = bundle.as_deref().is_some_and(|id| {
                id == bundle_id
                    || id
                        .strip_prefix(bundle_id)
                        .is_some_and(|suffix| suffix.starts_with('.'))
            }) || read_one::<libc::pid_t>(object, kAudioProcessPropertyPID)
                .is_some_and(|pid| apps.iter().any(|app| app.processIdentifier() == pid));
            if identified {
                match read_one::<u32>(object, kAudioProcessPropertyIsRunningInput) {
                    Some(0) => {}
                    Some(_) => return 2,
                    None => unresolved = true,
                }
            }
        }
        usize::from(!unresolved)
    })
}

fn eligible(enabled: bool, blocked: bool) -> bool {
    ELIGIBLE[usize::from(enabled) * 2 + usize::from(blocked)]
}

fn enabled(config: &serde_json::Value) -> bool {
    preference_value(config, "labs.dictationFrog").is_some_and(|value| value == true)
}

fn finish_session(path: &Path, count: &str, blocked: &AtomicBool) -> bool {
    let mut due = false;
    update_config_in(path, |config| {
        anyhow::ensure!(
            eligible(enabled(config), blocked.load(Ordering::Acquire)),
            "Nudge unavailable"
        );
        let onboarding = config
            .as_object_mut()
            .unwrap()
            .entry("onboarding")
            .or_insert_with(|| serde_json::json!({}));
        let onboarding = onboarding
            .as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("Invalid onboarding"))?;
        let previous = onboarding.get(count).and_then(|v| v.as_u64()).unwrap_or(0);
        let (next, wave) = usize::try_from(previous)
            .ok()
            .and_then(|index| CYCLE.get(index))
            .copied()
            .unwrap_or(CYCLE[0]);
        onboarding.insert(count.into(), next.into());
        due = wave;
        Ok(())
    })
    .is_ok()
        && due
}

struct Nudge {
    blocked: Arc<AtomicBool>,
    due: Receiver<()>,
    child: Option<Child>,
    entry: PathBuf,
    runtime: PathBuf,
}

impl Nudge {
    fn start(app: PathBuf, runtime: PathBuf) -> Option<Self> {
        let entry = app.join("dist/frog-nudge/entry.cjs");
        if !entry.is_file() {
            return None;
        }
        let (send, due) = channel();
        let blocked = Arc::new(AtomicBool::new(true));
        let paused = blocked.clone();
        let config = default_config_path();
        std::thread::Builder::new()
            .name("dictation-nudge".into())
            .spawn(move || {
                let mut states = [(0, None); APPS.len()];
                let mut next_config_check = Instant::now();
                let mut watching = false;
                loop {
                    if Instant::now() >= next_config_check {
                        let saved = std::fs::read(&config)
                            .ok()
                            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                            .unwrap_or_default();
                        watching = enabled(&saved);
                        next_config_check = Instant::now() + Duration::from_millis(750);
                    }
                    if eligible(watching, paused.load(Ordering::Acquire)) {
                        for ((bundle, count), (previous, pending)) in
                            APPS.into_iter().zip(&mut states)
                        {
                            let state = mic_state(bundle);
                            if ENDED[*previous][state] {
                                *pending = Some(Instant::now());
                            } else if state != 1 {
                                *pending = None;
                            }
                            *previous = state;
                            if pending
                                .is_some_and(|at| at.elapsed() >= Duration::from_millis(SETTLE_MS))
                            {
                                *pending = None;
                                if finish_session(&config, count, &paused) && send.send(()).is_err()
                                {
                                    return;
                                }
                            }
                        }
                    } else {
                        states.fill((0, None));
                    }
                    std::thread::sleep(Duration::from_millis(if watching { 125 } else { 750 }));
                }
            })
            .ok()?;
        Some(Self {
            blocked,
            due,
            child: None,
            entry,
            runtime,
        })
    }

    fn tick(&mut self, blocked: bool) {
        self.blocked.store(blocked, Ordering::Release);
        if let Some(child) = &mut self.child {
            if blocked {
                child.stdin.take();
            }
            if !matches!(child.try_wait(), Ok(None)) {
                self.child = None;
            }
        }
        if blocked {
            while self.due.try_recv().is_ok() {}
        } else if self.child.is_none() && self.due.try_recv().is_ok() {
            self.child = Command::new(&self.runtime)
                .arg(&self.entry)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .ok();
        }
    }
}

struct FrogNudge(std::cell::RefCell<Option<Nudge>>);
impl gpui::Global for FrogNudge {}

pub(super) fn poll(cx: &mut gpui::App) {
    if !cx.has_global::<FrogNudge>() {
        let assets = crate::capture::desktop::settings::presentation::assets();
        cx.set_global(FrogNudge(std::cell::RefCell::new(
            assets.and_then(|(app, runtime)| Nudge::start(app, runtime)),
        )));
    }
    if let Some(nudge) = &mut *cx.global::<FrogNudge>().0.borrow_mut() {
        nudge.tick(
            super::super::shutdown::busy()
                || super::super::shutdown::requested()
                || crate::capture::desktop::ui::macos::reduce_motion(),
        );
    }
}
