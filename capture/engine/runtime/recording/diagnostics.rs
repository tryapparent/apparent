//! Content-free native failure provenance. These markers never own workflow or reporting.
//! Keep the original error chain for local diagnosis; transports must not format it.
use std::{error::Error, fmt, panic::Location};

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Stage {
    PhoneStop,
    PhoneBundle,
    AudioStop,
    AudioErrorState,
    AudioSampleState,
    AudioWriterJoin,
    AudioWriterBacklog,
    AudioWriterHistory,
    AudioWriterLength,
    AudioWriterWrite,
    AudioWriterCheckpoint,
    AudioWriterRead,
    AudioWavEncode,
    AudioWavRead,
    AudioWavFormat,
    NotesReceipt,
    NotesRead,
    RecoveryJournal,
    NoSafeFrames,
    AudioPersist,
    SourcePreflight,
    BundleBuild,
    AudioMissing,
    Publication,
    PublicationCoordinate,
    PublicationValidate,
    PublicationSync,
    PublicationCleanup,
}

#[derive(Debug)]
pub(crate) struct Failure {
    pub stage: Stage,
    pub location: &'static Location<'static>,
    source: anyhow::Error,
}

impl fmt::Display for Failure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Preserve existing local/UI error wording. Only the typed fields are
        // eligible for reporting; the source is never serialized.
        fmt::Display::fmt(&self.source, formatter)
    }
}

impl Error for Failure {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        Some(self.source.as_ref())
    }
}

/// Capture provenance before errors cross executors, preserving typed OS causes.
#[track_caller]
pub(crate) fn at<T>(result: anyhow::Result<T>, stage: Stage) -> anyhow::Result<T> {
    let location = Location::caller();
    result.map_err(|source| {
        anyhow::Error::new(Failure {
            stage,
            location,
            source,
        })
    })
}

pub(crate) trait Diagnose<T> {
    #[track_caller]
    fn stage(self, stage: Stage) -> anyhow::Result<T>;
}

impl<T> Diagnose<T> for anyhow::Result<T> {
    #[track_caller]
    fn stage(self, stage: Stage) -> anyhow::Result<T> {
        at(self, stage)
    }
}
