use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};

static SELECTION: Mutex<Weak<AtomicBool>> = Mutex::new(Weak::new());

pub(crate) fn pending() -> bool {
    SELECTION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .strong_count()
        != 0
}

pub(crate) fn reserve() -> Option<Arc<AtomicBool>> {
    let mut selection = SELECTION.lock().unwrap_or_else(|error| error.into_inner());
    if selection.strong_count() != 0 {
        return None;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *selection = Arc::downgrade(&cancel);
    Some(cancel)
}

pub(crate) fn cancel() {
    if let Some(selection) = SELECTION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .upgrade()
    {
        selection.store(true, Ordering::Release);
    }
}

pub(crate) const PREFERENCE: &str = "permissions.skipScreenSelection";

pub(crate) fn supported() -> bool {
    #[cfg(target_os = "linux")]
    if !crate::capture::desktop::linux::wayland_session() {
        return false;
    }
    true
}

pub(crate) fn requested() -> bool {
    use crate::shared::handoff::{Config, default_config_path, load_config_from};
    if cfg!(test) {
        enabled_in(&Config::default())
    } else {
        enabled_in(&load_config_from(&default_config_path()))
    }
}

pub(crate) fn enabled_in(config: &crate::shared::handoff::Config) -> bool {
    preference(config) == crate::permission_admission::ScreenSelection::Picker
}

pub(crate) fn preference(
    config: &crate::shared::handoff::Config,
) -> crate::permission_admission::ScreenSelection {
    selection_for_saved(config.skip_screen_selection)
}

pub(crate) fn selection_for_saved(skip: Option<bool>) -> crate::permission_admission::ScreenSelection {
    #[cfg(target_os = "linux")]
    let direct_needs_opt_in = crate::capture::desktop::linux::gnome();
    #[cfg(not(target_os = "linux"))]
    let direct_needs_opt_in = false;
    crate::permission_admission::screen_selection(
        supported(),
        direct_needs_opt_in,
        skip,
    )
}

pub(crate) struct DisplaySelection {
    stop: Arc<AtomicBool>,
    #[cfg(target_os = "linux")]
    receiver: flume::Receiver<anyhow::Result<SelectedDisplay>>,
    #[cfg(target_os = "macos")]
    picker: super::macos_picker::PendingDisplay,
}

pub(crate) struct SelectedDisplay {
    pub(crate) target: crate::shared::model::TargetInfo,
    pub(crate) source: super::PreparedSource,
    #[cfg(target_os = "linux")]
    pub(crate) storage: Option<super::ChooserStorage>,
}

#[cfg(target_os = "linux")]
impl Drop for DisplaySelection {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}

#[cfg(target_os = "linux")]
fn select_linux(stop: &AtomicBool) -> anyhow::Result<SelectedDisplay> {
    std::thread::scope(|scope| {
        let store = std::thread::Builder::new()
            .name("apparent-chooser-storage".into())
            .spawn_scoped(scope, super::ChooserStorage::prepare_for_chooser);
        let result = crate::capture::desktop::linux::portal::choose_display(stop);
        let storage = store.ok().and_then(|job| job.join().ok()).flatten();
        let (target, source) = result?;
        Ok(SelectedDisplay { target, source: super::PreparedSource::Ready(source), storage })
    })
}

impl DisplaySelection {
    pub(crate) fn begin(#[cfg(target_os = "macos")] excluded_windows: &[u32]) -> Option<Self> {
        Self::start(
            #[cfg(target_os = "macos")]
            excluded_windows,
        )
        .unwrap_or_else(|error| {
            crate::capture::engine::runtime::apparent_log(format!(
                "Could not open the screen picker: {error:#}"
            ));
            None
        })
    }

    fn start(#[cfg(target_os = "macos")] excluded_windows: &[u32]) -> anyhow::Result<Option<Self>> {
        let Some(stop) = reserve() else {
            return Ok(None);
        };
        #[cfg(target_os = "linux")]
        let receiver = {
            let (sender, receiver) = flume::bounded(1);
            let worker = Arc::clone(&stop);
            std::thread::Builder::new()
                .name("apparent-display-picker".into())
                .spawn(move || {
                    let result = select_linux(&worker);
                    drop(worker);
                    let _ = sender.send(result);
                })?;
            receiver
        };
        #[cfg(target_os = "macos")]
        let picker = super::macos_picker::PendingDisplay::present(excluded_windows)?;
        Ok(Some(Self {
            stop,
            #[cfg(target_os = "linux")]
            receiver,
            #[cfg(target_os = "macos")]
            picker,
        }))
    }

    pub(crate) async fn acquire<F: Future<Output = ()>>(
        self,
        wait: impl FnMut() -> F,
    ) -> Option<SelectedDisplay> {
        let result = self.receive(wait).await;
        result.unwrap_or_else(|error| {
            crate::capture::engine::runtime::apparent_log(format!(
                "No screen recording was started: {error:#}"
            ));
            None
        })
    }

    async fn receive<F: Future<Output = ()>>(
        self,
        wait: impl FnMut() -> F,
    ) -> anyhow::Result<Option<SelectedDisplay>> {
        #[cfg(target_os = "linux")]
        let result = {
            let _ = wait;
            self.receiver.recv_async().await?.map(Some)
        };
        #[cfg(target_os = "macos")]
        let result = self.picker.choose(&self.stop, wait).await
            .map(|selected| selected.map(|(target, source)| SelectedDisplay { target, source }));
        if self.stop.load(Ordering::Acquire) {
            return Ok(None);
        }
        result
    }
}
