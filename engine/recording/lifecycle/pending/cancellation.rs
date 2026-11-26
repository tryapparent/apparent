use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use super::recover;
use super::super::{fd_path, verify_directory};

pub(crate) struct PendingStartCancellation {
    directory: File,
    requested: AtomicBool,
}

impl PendingStartCancellation {
    pub(super) fn new(directory: File) -> Self {
        Self {
            directory,
            requested: AtomicBool::new(false),
        }
    }

    pub(crate) fn request(&self) -> anyhow::Result<()> {
        if !self.requested() {
            recover::cancel(&fd_path(&self.directory))?;
            self.requested.store(true, Ordering::Release);
        }
        Ok(())
    }

    pub(crate) fn requested(&self) -> bool {
        self.requested.load(Ordering::Acquire)
    }

    pub(crate) fn abandon(&self, bundle_dir: &Path, stop: impl FnOnce()) -> anyhow::Result<()> {
        let durable = if self.requested() {
            Ok(())
        } else {
            recover::cancel(&fd_path(&self.directory))
        };
        stop();
        durable?;
        verify_directory(&self.directory, bundle_dir)?;
        recover::delete_cancelled(bundle_dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use super::super::ScreenCaptureSession;

    fn prepared_bundle(bundle: &Path) -> Arc<PendingStartCancellation> {
        let preparation = ScreenCaptureSession::prepare_start(bundle, false, true)
            .unwrap()
            .protect(bundle)
            .unwrap();
        preparation.pending_cancellation.unwrap()
    }

    #[test]
    fn accepted_pending_cancellation_blocks_narration_recovery_before_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let bundle = root.path().join("test.apparent");
        let pending = prepared_bundle(&bundle);
        std::fs::write(bundle.join("audio.wav"), b"synthetic audio").unwrap();
        std::fs::write(bundle.join(".audio-recording"), b"").unwrap();
        assert!(recover::owed(&bundle));
        assert!(!pending.requested());
        pending.request().unwrap();
        assert!(pending.requested());
        assert!(!recover::owed(&bundle));
        pending.abandon(&bundle, || {
            assert!(bundle.join(recover::CANCELLED).is_file());
        }).unwrap();
        pending.request().unwrap();
        assert!(!bundle.exists());
    }

    #[test]
    fn failed_marker_write_does_not_acknowledge_pending_cancellation() {
        let root = tempfile::tempdir().unwrap();
        let bundle = root.path().join("test.apparent");
        let pending = prepared_bundle(&bundle);
        let marker = bundle.join(recover::CANCELLED);
        std::fs::create_dir(&marker).unwrap();
        assert!(pending.request().is_err());
        assert!(!pending.requested());
        std::fs::remove_dir(marker).unwrap();
        pending.request().unwrap();
        assert!(pending.requested());
    }

    #[test]
    fn pending_cancel_marks_only_the_owned_directory_and_leaves_replacement() {
        let root = tempfile::tempdir().unwrap();
        let bundle = root.path().join("test.apparent");
        let original = root.path().join("original.apparent");
        let pending = prepared_bundle(&bundle);
        std::fs::rename(&bundle, &original).unwrap();
        std::fs::create_dir(&bundle).unwrap();
        pending.request().unwrap();
        assert!(original.join(recover::CANCELLED).is_file());
        assert!(pending.abandon(&bundle, || {}).is_err());
        assert!(bundle.is_dir());
        assert!(!bundle.join(recover::CANCELLED).exists());
    }
}
