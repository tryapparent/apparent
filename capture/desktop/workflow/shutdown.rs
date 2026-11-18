//! Cooperative quit requests. Signal handlers only set an atomic flag; the GUI/CLI owns Stop.
use std::sync::atomic::{AtomicBool, Ordering};

static REQUESTED: AtomicBool = AtomicBool::new(false);
static PHASE_BUSY: AtomicBool = AtomicBool::new(false);

pub fn request() {
    REQUESTED.store(true, Ordering::Release);
}
pub fn requested() -> bool {
    REQUESTED.load(Ordering::Acquire)
}
/// A failed Stop leaves the app open to show the failure, rather than quitting silently.
pub fn clear_request() {
    REQUESTED.store(false, Ordering::Release);
}
/// A copy of ApparentCoordinator::capture_busy(), including detached workers.
pub fn set_phase_busy(busy: bool) {
    PHASE_BUSY.store(busy, Ordering::Release);
}
pub fn busy() -> bool {
    PHASE_BUSY.load(Ordering::Acquire)
}

#[cfg(target_os = "linux")]
pub(crate) fn check_app_exit() -> anyhow::Result<()> {
    if busy() {
        eprintln!("[{}] native_event_loop_ended_during_capture", crate::shared::clock::now_epoch_ms());
        anyhow::bail!("Native event loop ended during capture");
    }
    Ok(())
}

extern "C" fn signal(_signal: libc::c_int) {
    request();
}

/// Own only SIGINT/SIGTERM while the recorder or GUI is alive. Never touch other instances.
pub struct Signals(Vec<(libc::c_int, libc::sigaction)>);
impl Signals {
    pub fn install() -> anyhow::Result<Self> {
        REQUESTED.store(false, Ordering::Release);
        let mut guard = Self(Vec::new());
        for number in [libc::SIGINT, libc::SIGTERM] {
            let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
            let mut previous = unsafe { std::mem::zeroed() };
            action.sa_sigaction = signal as *const () as usize;
            action.sa_flags = libc::SA_RESTART;
            unsafe {
                libc::sigemptyset(&mut action.sa_mask);
            }
            anyhow::ensure!(
                unsafe { libc::sigaction(number, &action, &mut previous) } == 0,
                "Could not install recording signal handler: {}",
                std::io::Error::last_os_error()
            );
            guard.0.push((number, previous));
        }
        Ok(guard)
    }
}
impl Drop for Signals {
    fn drop(&mut self) {
        for (number, previous) in self.0.drain(..).rev() {
            unsafe {
                libc::sigaction(number, &previous, std::ptr::null_mut());
            }
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn supervise() -> Option<anyhow::Result<()>> {
    if super::error_reporting::native_supervisor::is_child() { return None; }
    Some((|| {
        let _signals = Signals::install()?;
        let config = crate::shared::handoff::default_config_path();
        super::error_reporting::native_supervisor::run(super::error_reporting::native_supervisor::Hooks {
            directory: config.with_file_name("native-errors"),
            consent: super::error_reporting::native_consent,
            deliver: super::error_reporting::deliver_native,
            requested,
        })
    })())
}
