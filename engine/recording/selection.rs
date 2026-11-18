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

pub(crate) const PREFERENCE: &str = "chooseScreenEachTime";

pub(crate) fn supported() -> bool {
    #[cfg(target_os = "linux")]
    if !crate::capture::desktop::linux::wayland_session() {
        return false;
    }
    true
}

pub(crate) fn requested() -> bool {
    supported() && crate::shared::handoff::experiment(PREFERENCE)
}

pub(crate) fn enabled_in(config: &crate::shared::handoff::Config) -> bool {
    supported() && crate::shared::handoff::experiment_enabled_in(config, PREFERENCE)
}

pub(crate) struct DisplaySelection {
    stop: Arc<AtomicBool>,
    #[cfg(target_os = "linux")]
    receiver: flume::Receiver<anyhow::Result<Display>>,
    #[cfg(target_os = "macos")]
    picker: super::macos_picker::PendingDisplay,
}

type Display = (crate::shared::model::TargetInfo, super::PreparedSource);

impl DisplaySelection {
    pub(crate) fn begin() -> Option<Self> {
        Self::start().unwrap_or_else(|error| {
            crate::capture::engine::runtime::apparent_log(format!(
                "Could not open the screen picker: {error:#}"
            ));
            None
        })
    }

    fn start() -> anyhow::Result<Option<Self>> {
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
                    let result = crate::capture::desktop::linux::portal::choose_display(&worker);
                    drop(worker);
                    let _ = sender.send(result);
                })?;
            receiver
        };
        #[cfg(target_os = "macos")]
        let picker = super::macos_picker::PendingDisplay::present()?;
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
    ) -> Option<Display> {
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
    ) -> anyhow::Result<Option<Display>> {
        #[cfg(target_os = "linux")]
        let result = {
            let _ = wait;
            self.receiver.recv_async().await?.map(Some)
        };
        #[cfg(target_os = "macos")]
        let result = self.picker.choose(&self.stop, wait).await;
        if self.stop.load(Ordering::Acquire) {
            return Ok(None);
        }
        result
    }
}
