//! Compatibility facade for Desktop handoff and shared config transactions.
//!
//! `config_store` contains only path/read/locked publication mechanics. Desktop
//! preference validation and timing live in `preferences`; clipboard/paste and
//! legacy session integration have separate owners. Existing callers keep their
//! `handoff::` APIs until they explicitly migrate.

mod bundles;
mod clipboard;
pub(crate) mod config_store;
mod opencode;
mod preferences;

pub use bundles::*;
pub use clipboard::*;
#[cfg(test)]
pub(crate) use config_store::set_config_write_hook;
pub(crate) use config_store::update_config_in;
pub use config_store::{default_config_path, set_config_value_in};
#[cfg(test)]
pub(crate) use opencode::fake_api;
pub use opencode::*;
pub use preferences::*;

use preferences::lenient_experiments;
const AGENT_DEMO_VIDEO: &str = "agentDemoVideo";
use serde::Deserialize;

// Retain the schema here for the source-based feature-map audit, which locates
// handoff::Config in this file. It is Desktop policy, not a storage dependency.
#[derive(Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Hosted sync preference; credentials are separate private artifacts, not settings.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[serde(default)]
    pub cloud: Option<crate::hosted::CloudConfig>,
    /// Desired OS login registration. Missing leaves the OS's existing choice alone.
    #[serde(default)]
    pub launch_at_login: Option<bool>,
    #[serde(default)]
    pub agent_host: Option<String>,
    #[serde(default)]
    pub agent_opencode: Option<String>,
    #[serde(default)]
    pub update_channel: Option<String>,
    /// `false` turns Screen-capture auto-crop off; an object overrides its settings.
    #[serde(default)]
    pub autocrop: Option<serde_json::Value>,
    /// `false` keeps Mac captures of a dev site on the clipboard instead of sending them to the
    /// site's OpenCode session (`routing`).
    #[serde(default)]
    pub auto_send: Option<bool>,
    /// Feature flag: shows **Export Last Capture as Video…** in the menu (default off).
    #[serde(default)]
    pub video_export: Option<bool>,
    /// `"apple"` (default), `"hex"` or `"command"`: which engine transcribes recordings
    /// (`transcribe`). The command's own keys are read by `transcribe_command`, not here, so a
    /// malformed one can't reset this struct.
    #[serde(default)]
    pub transcriber: Option<String>,
    /// Reuse Linux Parakeet across captures for 30 idle minutes (default true).
    #[serde(default)]
    pub warm_recognizer: Option<bool>,
    /// Lower the output volume while recording (`playback`) to `playbackLevel` percent of it.
    #[serde(default)]
    pub lower_playback: Option<bool>,
    #[serde(default)]
    pub playback_level: Option<u8>,
    /// The Hex model to use when `transcriber` is `"hex"` (default: the first ready one of
    /// `hex::PREFERRED_MODELS`).
    #[serde(default)]
    pub hex_model: Option<String>,
    /// Hex language code (`"en"` by default, `"auto"` for model language detection).
    #[serde(default)]
    pub hex_language: Option<String>,
    /// Apple Speech locale (BCP-47, e.g. "zh-TW"); missing means the Mac's own language.
    #[serde(default)]
    pub apple_locale: Option<String>,
    /// Whether to use the native Metal recording pill instead of GPUI's `HudPillWindow` (default `true`).
    #[serde(default)]
    pub native_pill: Option<bool>,
    /// Visual style of the native recording pill: `"black"` (default) or `"glass"` (`NSGlassEffectView`).
    #[serde(default)]
    pub pill_style: Option<String>,
    /// Behaviour Kit tries locally before it ships (`{"agentContext": true}`); see `experiment`.
    /// Read leniently (`lenient_experiments`), so a stray value never fails the file.
    #[serde(default, deserialize_with = "lenient_experiments")]
    pub experiments: std::collections::BTreeMap<String, bool>,
    /// The microphone Mac captures record from (`mic`); absent follows the macOS default.
    #[serde(default)]
    pub microphone: Option<crate::mic::Choice>,
    /// Smart routing's settings (`routing::look`).
    #[serde(default)]
    pub routing: Option<RoutingConfig>,
    /// Where new captures go (`default_captures_dir`); absent keeps the built-in folder.
    #[serde(default)]
    pub captures_dir: Option<String>,
}

#[cfg(test)]
mod test_support;
