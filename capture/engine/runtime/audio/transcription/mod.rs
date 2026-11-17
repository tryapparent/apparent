pub(crate) mod command_transcriber;
pub(crate) mod live_transcribe;
pub(crate) mod live_word_probe;
pub(crate) mod live_word_warning;
#[cfg(target_os = "linux")]
pub(crate) mod pause_transcribe;
pub(crate) mod speech;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) mod parakeet_stream;
pub(crate) mod speech_model;
pub(crate) mod transcribe;
#[cfg(target_os = "linux")]
pub(crate) mod warm_recognizer;
