use anyhow::Result;
use std::path::Path;
use std::sync::{Arc, Mutex};

use super::super::persistence::{Samples, Writer};

pub(crate) struct PreparedAudio {
    pub(super) samples: Arc<Mutex<Samples>>,
    pub(super) writer: Writer,
    pub(super) error: Arc<Mutex<Option<String>>>,
}

impl PreparedAudio {
    pub(crate) fn new(bundle_dir: &Path) -> Result<Self> {
        Self::with_writer(|samples, error| Writer::start(bundle_dir, samples, error))
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn from_staged(
        bundle_dir: &Path,
        file: std::fs::File,
        lease: super::super::persistence::Lease,
    ) -> Result<Self> {
        Self::with_writer(|samples, error| {
            Writer::start_prepared(bundle_dir, file, lease, samples, error)
        })
    }

    fn with_writer(
        start: impl FnOnce(Arc<Mutex<Samples>>, Arc<Mutex<Option<String>>>) -> Result<Writer>,
    ) -> Result<Self> {
        let samples = Arc::new(Mutex::new(Samples::default()));
        let error = Arc::new(Mutex::new(None));
        let writer = start(Arc::clone(&samples), Arc::clone(&error))?;
        Ok(Self { samples, writer, error })
    }
}
