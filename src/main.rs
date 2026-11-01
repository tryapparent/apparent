mod agent_context;
#[cfg(test)]
#[path = "../build_version.rs"]
mod build_version;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod agent_capture;
mod audio;
mod autocrop;
// Windows looks elements up through UI Automation (`win/uia.rs`); other systems have no lookup.
#[cfg_attr(
    not(any(target_os = "macos", target_os = "windows")),
    path = "ax_other.rs"
)]
mod ax;
mod autocrop_lab;
mod bundle_processing;
mod composition;
mod capture;
#[cfg_attr(target_os = "windows", path = "win/command_line.rs")]
mod command_line;
mod command_transcriber;
mod export;
#[cfg(test)]
mod feature_map;
mod handoff;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod hosted;
#[cfg_attr(target_os = "windows", path = "win/helper.rs")]
#[cfg_attr(target_os = "linux", path = "linux/helper.rs")]
mod helper;
mod hex;
mod icons;
mod inbox;
#[cfg(not(target_os = "macos"))]
mod ink_view;
mod ingest_http;
mod keyframes;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod launch_instance;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod launch_url;
#[cfg(target_os = "macos")]
mod laser_overlay;
mod live_transcribe;
mod live_word_probe;
mod live_word_warning;
#[cfg(target_os = "linux")]
mod pause_transcribe;
#[cfg(target_os = "linux")]
mod warm_recognizer;
mod mic;
mod model;
mod native;
mod onboarding;
mod onboarding_window;
mod page;
mod phone;
// Shared capture guard; each OS supplies only its audio mechanics.
#[cfg_attr(target_os = "linux", path = "linux/playback.rs")]
#[cfg_attr(target_os = "windows", path = "win/playback.rs")]
mod playback;
mod recover;
mod render;
mod retention;
mod routing;
mod screens;
mod settings;
mod settings_window;
mod shortcut;
mod sketch;
#[cfg(target_os = "macos")]
mod sparkle;
#[cfg(not(target_os = "macos"))]
mod speech;
mod speech_model;
mod transcribe;
mod ui;
mod web;
#[cfg(target_os = "windows")]
mod win;
#[cfg(target_os = "linux")]
mod linux;
mod windows;
mod zoom;

mod shared;

fn main() -> anyhow::Result<()> {
    composition::cli::run()
}
