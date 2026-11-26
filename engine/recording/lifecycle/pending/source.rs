use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{Builder, JoinHandle};
use std::time::Duration;

use crate::capture::desktop::linux::{self, media::Source};
use crate::capture::desktop::workflow::performance::Startup;
use crate::shared::model::{CaptureMode, TargetInfo};

pub(crate) enum PreparedSource {
    Ready(Source),
    Pending(PendingSource),
}

impl PreparedSource {
    pub(crate) fn prepare_direct(target: &TargetInfo, startup: Option<Startup>) -> Option<PendingSource> {
        PendingSource::prepare(target, startup)
    }

    pub(crate) fn acquire(self, stopping: &AtomicBool) -> anyhow::Result<Source> {
        match self {
            Self::Ready(source) => Ok(source),
            Self::Pending(pending) => pending.acquire(stopping),
        }
    }
}

pub(crate) struct PendingSource {
    start: Option<flume::Sender<()>>,
    stopping: Arc<AtomicBool>,
    ready: flume::Receiver<anyhow::Result<Source>>,
    worker: Option<JoinHandle<()>>,
}

impl PendingSource {
    pub(crate) fn prepare(target: &TargetInfo, startup: Option<Startup>) -> Option<Self> {
        if target.mode != CaptureMode::Display || !linux::wayland_session() || !linux::hyprland() {
            return None;
        }
        let target = target.clone();
        let stopping = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stopping);
        let (start, gate) = flume::bounded(1);
        let (publish, ready) = flume::bounded(1);
        let worker = Builder::new().name("apparent-prepare-screen-source".into()).spawn(move || {
            let result = linux::portal::source_for_start(&target, &worker_stop, startup.as_ref(), Some(gate));
            let _ = publish.send(result);
        }).ok()?;
        Some(Self { start: Some(start), stopping, ready, worker: Some(worker) })
    }

    pub(crate) fn admit(mut self) -> PreparedSource {
        if let Some(start) = self.start.take() {
            let _ = start.send(());
        }
        PreparedSource::Pending(self)
    }

    fn acquire(self, stopping: &AtomicBool) -> anyhow::Result<Source> {
        while !stopping.load(Ordering::Acquire) {
            match self.ready.recv_timeout(Duration::from_millis(20)) {
                Ok(source) => return source,
                Err(flume::RecvTimeoutError::Timeout) => {}
                Err(error) => return Err(error.into()),
            }
        }
        anyhow::bail!("Screen sharing was cancelled")
    }
}

impl Drop for PendingSource {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        drop(self.start.take());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
