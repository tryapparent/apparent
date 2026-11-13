//! Content-free observations of the existing native pipe and child lifetime.
use std::{
    io::{BufRead, Read},
    process::ExitStatus,
    time::Instant,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReaderStop {
    Eof,
    ReadError,
    Oversized,
    Unterminated,
    InvalidJson,
    InvalidFrame,
    InvalidWindowId,
    PinPreparation,
    InvalidCommand,
    ActionQueueFull,
    ActionQueueClosed,
}

impl ReaderStop {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::Eof => "stdout-eof",
            Self::ReadError => "stdout-read-error",
            Self::Oversized => "stdout-frame-oversized",
            Self::Unterminated => "stdout-frame-unterminated",
            Self::InvalidJson => "stdout-invalid-json",
            Self::InvalidFrame => "stdout-invalid-geometry",
            Self::InvalidWindowId => "stdout-invalid-window-id",
            Self::PinPreparation => "native-pin-preparation-failed",
            Self::InvalidCommand => "stdout-invalid-command",
            Self::ActionQueueFull => "action-queue-full",
            Self::ActionQueueClosed => "action-queue-closed",
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum WriterStop {
    OwnerClosed,
    FrameWrite,
    NewlineWrite,
    Flush,
}

impl WriterStop {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::OwnerClosed => "owner-closed",
            Self::FrameWrite => "serialize-or-write-frame",
            Self::NewlineWrite => "write-frame-newline",
            Self::Flush => "flush-frame",
        }
    }
}

pub(super) fn read_frame(reader: &mut impl BufRead) -> Result<Vec<u8>, ReaderStop> {
    let mut line = Vec::new();
    // Preserve the original bound before allocation and require a complete frame.
    let count = reader
        .by_ref()
        .take(1025)
        .read_until(b'\n', &mut line)
        .map_err(|_| ReaderStop::ReadError)?;
    if count == 0 {
        return Err(ReaderStop::Eof);
    }
    if count > 1024 {
        return Err(ReaderStop::Oversized);
    }
    if !line.ends_with(b"\n") {
        return Err(ReaderStop::Unterminated);
    }
    Ok(line)
}

#[derive(Default)]
pub(super) struct Observation {
    pub(super) reader_stop: Option<ReaderStop>,
    pub(super) writer_stop: Option<WriterStop>,
    last_state: Option<(&'static str, u64, Instant)>,
}

impl Observation {
    pub(super) fn wrote_state(&mut self, phase: &str, revision: u64) {
        self.last_state = Some((known_phase(phase), revision, Instant::now()));
    }

    pub(super) fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({
            "reader_stop": self.reader_stop.map(ReaderStop::code),
            "writer_stop": self.writer_stop.map(WriterStop::code),
            "last_flushed_state": self.last_state.map(|(phase, revision, at)| serde_json::json!({
                "phase": phase, "revision": revision, "age_ms": at.elapsed().as_millis(),
            })),
        })
    }
}

pub(super) fn known_phase(phase: &str) -> &'static str {
    match phase {
        "hidden" => "hidden",
        "selecting" => "selecting",
        "recording" => "recording",
        "processing" => "processing",
        "completed" => "completed",
        _ => "unknown",
    }
}

pub(super) fn child_status(status: std::io::Result<Option<ExitStatus>>) -> serde_json::Value {
    use std::os::unix::process::ExitStatusExt;
    match status {
        Ok(None) => serde_json::json!({"state":"running"}),
        Ok(Some(status)) => serde_json::json!({
            "state":"exited", "code":status.code(), "signal":status.signal(),
        }),
        Err(error) => serde_json::json!({
            "state":"wait-error", "io_kind":format!("{:?}", error.kind()),
            "os_error":error.raw_os_error(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn framing_observation_preserves_the_bound_and_distinguishes_eof() {
        let mut large = Cursor::new(vec![b'x'; 4096]);
        assert_eq!(read_frame(&mut large), Err(ReaderStop::Oversized));
        assert_eq!(large.position(), 1025);
        assert_eq!(
            read_frame(&mut Cursor::new(b"private-token")),
            Err(ReaderStop::Unterminated)
        );
        assert_eq!(read_frame(&mut Cursor::new(b"")), Err(ReaderStop::Eof));
        assert_eq!(
            read_frame(&mut Cursor::new(b"{}\nnext")),
            Ok(b"{}\n".to_vec())
        );
    }

    #[test]
    fn observation_retains_only_structural_state_and_fixed_failure_codes() {
        let mut observation = Observation::default();
        observation.wrote_state("recording", 12);
        observation.reader_stop = Some(ReaderStop::InvalidCommand);
        observation.writer_stop = Some(WriterStop::FrameWrite);
        let snapshot = observation.snapshot();
        assert_eq!(snapshot["last_flushed_state"]["phase"], "recording");
        assert_eq!(snapshot["last_flushed_state"]["revision"], 12);
        assert_eq!(snapshot["reader_stop"], "stdout-invalid-command");
        assert_eq!(snapshot["writer_stop"], "serialize-or-write-frame");
        observation.wrote_state("/private/capture?credential=secret", 13);
        let encoded = observation.snapshot().to_string();
        assert!(encoded.contains("unknown"));
        assert!(!encoded.contains("credential"));
        assert!(!encoded.contains("/private"));
        assert!(encoded.len() < 1024);
    }

    #[test]
    fn child_observation_distinguishes_running_exit_and_io_failure_without_error_text() {
        assert_eq!(child_status(Ok(None))["state"], "running");
        let status = std::process::Command::new("/bin/sh")
            .args(["-c", "exit 23"])
            .status()
            .unwrap();
        let stopped = child_status(Ok(Some(status)));
        assert_eq!(stopped["state"], "exited");
        assert_eq!(stopped["code"], 23);
        assert!(stopped["signal"].is_null());
        let failure =
            child_status(Err(std::io::Error::other("/private/capture bearer=secret"))).to_string();
        assert!(failure.contains("wait-error"));
        assert!(!failure.contains("private"));
        assert!(!failure.contains("bearer"));
    }
}
