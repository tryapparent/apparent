//! Allowlisted projection of native provenance; never Display/Debug an error.
use crate::capture::engine::runtime::recording::diagnostics::{Failure, Stage};

#[derive(Clone, serde::Serialize)]
pub(super) struct Diagnostics {
    stages: Vec<Frame>,
    io_kind: Option<&'static str>,
    os_error_code: Option<i32>,
    wav_error_kind: Option<&'static str>,
}

#[derive(Clone, serde::Serialize)]
struct Frame {
    stage: Stage,
    file: Option<String>,
    line: u32,
}

impl Diagnostics {
    pub(super) fn from_error(error: &anyhow::Error) -> Self {
        let mut stages = Vec::new();
        let mut io_kind = None;
        let mut os_error_code = None;
        let mut wav_error_kind = None;
        // Also bound traversal for unexpected/cyclic dependency error chains.
        for cause in error.chain().take(64) {
            if let Some(failure) = cause.downcast_ref::<Failure>() {
                if stages.len() == 8 {
                    stages.remove(0);
                }
                stages.push(Frame {
                    stage: failure.stage,
                    file: super::source_file(failure.location.file()),
                    line: failure.location.line(),
                });
            }
            let wav_error = cause.downcast_ref::<hound::Error>();
            if wav_error_kind.is_none() {
                wav_error_kind = wav_error.map(|error| match error {
                    hound::Error::IoError(_) => "io",
                    hound::Error::FormatError(_) => "format",
                    hound::Error::TooWide => "too_wide",
                    hound::Error::UnfinishedSample => "unfinished_sample",
                    hound::Error::Unsupported => "unsupported",
                    hound::Error::InvalidSampleFormat => "invalid_sample_format",
                });
            }
            if io_kind.is_none() {
                // hound 3.5 exposes its I/O cause only through legacy cause(),
                // not source(). Preserve the structured cause without formatting
                // the WAV error or traversing arbitrary deprecated causes.
                let io_error = cause.downcast_ref::<std::io::Error>().or_else(|| match wav_error {
                    Some(hound::Error::IoError(error)) => Some(error),
                    _ => None,
                });
                if let Some(error) = io_error {
                    use std::io::ErrorKind;
                    io_kind = Some(match error.kind() {
                        ErrorKind::NotFound => "not_found",
                        ErrorKind::PermissionDenied => "permission_denied",
                        ErrorKind::AlreadyExists => "already_exists",
                        ErrorKind::InvalidInput => "invalid_input",
                        ErrorKind::InvalidData => "invalid_data",
                        ErrorKind::TimedOut => "timed_out",
                        ErrorKind::WriteZero => "write_zero",
                        ErrorKind::UnexpectedEof => "unexpected_eof",
                        ErrorKind::StorageFull => "storage_full",
                        ErrorKind::ReadOnlyFilesystem => "read_only_filesystem",
                        ErrorKind::Interrupted => "interrupted",
                        ErrorKind::WouldBlock => "would_block",
                        _ => "other",
                    });
                    os_error_code = error.raw_os_error();
                }
            }
        }
        Self {
            stages,
            io_kind,
            os_error_code,
            wav_error_kind,
        }
    }

    /// Group by the most specific instrumented boundary, independent of the UI.
    pub(super) fn fingerprint(&self) -> String {
        match self.stages.last() {
            Some(frame) => format!(
                "desktop:finalization:{:?}:{}:{}",
                frame.stage,
                frame.file.as_deref().unwrap_or("external"),
                frame.line
            ),
            None => "desktop:finalization:unclassified".into(),
        }
    }
}
