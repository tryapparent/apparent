use super::connect::sync_native;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
pub(super) use super::Transport;
use super::{UpdateCheck, UpdateResult};
#[cfg(target_os = "linux")]
use super::{UpdateFailure, update_failure};

use crate::capture::engine::runtime::{
    CARBON_CMD_KEY, CARBON_CONTROL_KEY, CARBON_OPTION_KEY, CARBON_SHIFT_KEY, MACOS_FN_KEY_CODE, ShortcutConfig,
    ShortcutKind, modifier_symbols,
};
use crate::permission_facts::{Grants, Permission, Status};
use crate::composition::settings_permissions::{self, PermissionIntent, Outcome, PermissionsPresenter};
use crate::permission_admission::Repair;

// MARK: Shortcuts in the config

/// Apparent's two shortcuts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shortcuts {
    pub record: ShortcutConfig,
    pub paste: ShortcutConfig,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            record: ShortcutConfig::default_record(),
            paste: ShortcutConfig::default_paste(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    key_code: u32,
    modifiers: u32,
    label: String,
}

impl Shortcuts {
    pub fn get(&self, kind: ShortcutKind) -> &ShortcutConfig {
        match kind {
            ShortcutKind::Record => &self.record,
            ShortcutKind::Paste => &self.paste,
        }
    }

    fn set(&mut self, kind: ShortcutKind, cfg: ShortcutConfig) {
        match kind {
            ShortcutKind::Record => self.record = cfg,
            ShortcutKind::Paste => self.paste = cfg,
        }
    }

    /// From `~/.config/apparent/config.json`, moving a shortcut saved by 0.3.x (its own file
    /// under Application Support) across the first time.
    pub fn load() -> Self {
        let path = crate::shared::handoff::default_config_path();
        let legacy = legacy_path();
        let (shortcuts, migrated) = Self::load_from(&path, &legacy);
        if migrated && save_shortcut_in(&path, ShortcutKind::Record, &shortcuts.record).is_ok() {
            let _ = std::fs::remove_file(&legacy);
        }
        if let Some(record) = desktop_record(&path) {
            return Self {
                record,
                ..shortcuts
            };
        }
        shortcuts
    }

    /// The shortcuts in `path`, else a custom record shortcut from the old file at `legacy`
    /// (returning `true` when that one should be moved across).
    pub fn load_from(path: &Path, legacy: &Path) -> (Self, bool) {
        let config = read_json(path);
        let mut shortcuts = Self::default();
        if crate::shared::handoff::is_nightly() {
            shortcuts.record = ShortcutConfig::unset();
        }
        let stored = config.get("shortcuts");
        for kind in ShortcutKind::ALL {
            let value = stored.and_then(|s| s.get(kind_key(kind)));
            if kind.can_unset() && value.is_some_and(serde_json::Value::is_null) {
                shortcuts.set(kind, ShortcutConfig::unset());
            } else if let Some(cfg) = value
                .and_then(|v| serde_json::from_value::<Stored>(v.clone()).ok())
                .and_then(|s| from_stored(kind, s))
            {
                shortcuts.set(kind, cfg);
            }
        }
        if stored.is_some() {
            return (shortcuts, false);
        }
        let old = read_json(legacy);
        let old = (
            old.get("key_code").and_then(serde_json::Value::as_u64),
            old.get("carbon_modifiers")
                .and_then(serde_json::Value::as_u64),
            old.get("label").and_then(serde_json::Value::as_str),
        );
        if let (Some(key_code), Some(modifiers), Some(label)) = old
            && let Some(cfg) = from_stored(
                ShortcutKind::Record,
                Stored {
                    key_code: key_code as u32,
                    modifiers: modifiers as u32,
                    label: label.to_owned(),
                },
            )
            // 0.3.x saved its default too, and ⌃⌥⇧S was an older default.
            && !cfg.is_default_for(ShortcutKind::Record)
            && cfg.label != "⌃⌥⇧S"
        {
            shortcuts.record = cfg;
            return (shortcuts, true);
        }
        (shortcuts, false)
    }
}

fn legacy_path() -> PathBuf {
    crate::shared::handoff::builtin_captures_dir()
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
        .join("config.json")
}

include!("shortcut/config.rs");

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn open_startup_settings_for_quit() {
    open_login_items_settings();
}



#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Pane {
    General,
    Recording,
    Storage,
    Permissions,
    Agents,
    Labs,
    About,
}

/// The capture-reading skill source is `capture/agent/skills/apparent/SKILL.md`.
pub const SKILL_COMMAND: &str = "bunx skills add https://github.com/tryapparent/apparent/tree/main/capture/agent/skills/apparent";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub version: String,
    pub connect: Option<super::connect::View>,
    pub hosted: Option<crate::connect::hosted::AccountView>,
    pub login: LoginView,
    pub error_reporting: bool,
    pub agent_demo_video: bool,
    pub shortcuts: Vec<ShortcutView>,
    pub microphone: MicrophoneView,
    pub transcriber: TranscriberView,
    pub lower_playback: bool,
    pub playback_level: u8,
    pub video_export: bool,
    pub retention: RetentionView,
    /// How much the captures folder takes, once measured.
    pub captures_size: Option<String>,
    pub captures_dir: CapturesDirView,
    #[cfg(target_os = "linux")]
    pub storage: super::storage::View,
    pub permissions: Vec<crate::permission_admission::Row>,
    pub updates: bool,
    pub update_check: UpdateCheck,
    pub update_channel: &'static str,
    pub main_updates: bool,
    pub command_line: CommandLineView,
    pub skill_command: &'static str,
}

/// The "Command-line tool" row.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandLineView {
    /// Where `apparent` is linked, once it is.
    pub path: Option<String>,
    /// "install", "uninstall", or none.
    pub button: Option<&'static str>,
    pub enabled: bool,
    pub caption: String,
    pub error: bool,
}

impl CommandLineView {
    fn new(state: &crate::composition::command_line::State, error: Option<&str>) -> Self {
        use crate::composition::command_line::{State, tilde, usually_on_path};
        let folder = |link: &std::path::Path| link.parent().map_or_else(String::new, tilde);
        let mut view = Self {
            path: None,
            button: Some("install"),
            enabled: true,
            caption: String::new(),
            error: false,
        };
        match state {
            State::Installed { link, homebrew } => {
                view.path = Some(tilde(link));
                view.caption = "Agents and your terminal can run apparent to read captures, zoom \
                                into a moment and export video."
                    .to_owned();
                if *homebrew {
                    view.button = None;
                    view.caption = "Installed with Homebrew. Agents and your terminal can run \
                                    apparent to read captures, zoom into a moment and export video."
                        .to_owned();
                } else {
                    view.button = Some("uninstall");
                    if !usually_on_path(link) {
                        view.caption = format!(
                            "If your shell can't find apparent, add {} to your PATH.",
                            folder(link)
                        );
                    }
                }
            }
            State::Missing { link } => {
                view.caption = format!(
                    "Links apparent into {}, so agents and your terminal can run it.",
                    folder(link)
                );
            }
            State::Stale { link } => {
                view.caption = format!(
                    "{} points to another copy of Apparent. Install links it to this one.",
                    tilde(link)
                );
            }
            State::Taken { link } => {
                view.button = None;
                view.error = true;
                view.caption = format!(
                    "{} is another program, so Apparent leaves it alone.",
                    tilde(link)
                );
            }
            State::Nowhere => {
                view.enabled = false;
                view.error = true;
                view.caption =
                    "There's no folder on your PATH that Apparent can write to.".to_owned();
            }
            State::Unavailable => {
                view.enabled = false;
                view.caption = if cfg!(target_os = "linux") {
                    "The command-line tool links to Apparent's AppImage; run Apparent from one."
                } else {
                    "The command-line tool works in the installed app."
                }
                .to_owned();
            }
        }
        if let Some(error) = error {
            view.error = true;
            view.caption = error.to_owned();
        }
        view
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginView {
    pub on: bool,
    pub available: bool,
    pub needs_approval: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutView {
    pub kind: ShortcutKind,
    pub title: &'static str,
    pub label: String,
    pub key: String,
    pub shift: bool,
    pub control: bool,
    pub option: bool,
    pub command: bool,
    pub is_default: bool,
    pub suggested_fn: Option<serde_json::Value>,
    /// A live system binding owns this chord; change it in the compositor instead.
    pub externally_managed: bool,
    /// It can be turned off (paste); `label` is empty while it is.
    pub clearable: bool,
    /// The recorder is waiting for a new combination.
    pub recording: bool,
    /// Why the last combination was turned down.
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MicrophoneView {
    /// `"default"` or the chosen device's id.
    pub selected: String,
    /// What the popup says.
    pub value: String,
    /// "System default (…)", a separator (`id` "-"), then each input; a chosen device that
    /// isn't connected comes last, disabled.
    pub options: Vec<MenuOptionView>,
    /// Why another device is recording.
    pub note: Option<String>,
    /// The device whose level the window shows, only once Microphone is allowed.
    pub meter: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MenuOptionView {
    pub id: String,
    pub title: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriberView {
    /// What recordings use now: "apple", "hex" or "command".
    pub engine: &'static str,
    pub hex_title: &'static str,
    pub hex_enabled: bool,
    pub language: String,
    pub apple_locale: String,
    pub models: Vec<ModelView>,
    /// The program's file name while `transcribeCommand` is usable (read, never run); Command
    /// is offered only then.
    pub command: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ModelView {
    pub id: String,
    pub title: String,
    pub chosen: bool,
}

/// Settings › Storage › Location: where new captures go (`"capturesDir"`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturesDirView {
    /// The folder, with the home folder as `~`.
    pub path: String,
    /// Chosen in Settings rather than the built-in folder, so Reset shows.
    pub custom: bool,
}

impl CapturesDirView {
    fn new(config: &crate::shared::handoff::Config) -> Self {
        let chosen = config
            .captures_dir
            .as_deref()
            .and_then(crate::shared::handoff::configured_captures_dir);
        Self {
            custom: chosen.is_some(),
            path: crate::composition::command_line::tilde(
                &chosen.unwrap_or_else(crate::shared::handoff::builtin_captures_dir),
            ),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RetentionView {
    /// The chosen preset, or `None` for a policy written by hand.
    pub preset: Option<&'static str>,
    pub options: Vec<OptionView>,
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct OptionView {
    pub id: &'static str,
    pub label: &'static str,
}

pub(crate) fn preset_id(preset: crate::capture::engine::bundle::retention::Preset) -> &'static str {
    match preset {
        crate::capture::engine::bundle::retention::Preset::Week => "week",
        crate::capture::engine::bundle::retention::Preset::Month => "month",
        crate::capture::engine::bundle::retention::Preset::Forever => "forever",
    }
}

pub(crate) fn retention_view(policy: &crate::capture::engine::bundle::retention::Policy) -> RetentionView {
    RetentionView {
        preset: policy.preset().map(preset_id),
        options: crate::capture::engine::bundle::retention::Preset::ALL.into_iter()
            .map(|p| OptionView { id: preset_id(p), label: p.label() }).collect(),
        note: retention_note(policy),
    }
}

fn retention_note(policy: &crate::capture::engine::bundle::retention::Policy) -> String {
    let days = |n: u32| {
        if n == 1 {
            "1 day".to_owned()
        } else {
            format!("{n} days")
        }
    };
    let bin = if cfg!(target_os = "windows") {
        "Recycle Bin"
    } else {
        "Trash"
    };
    match (policy.media_days, policy.bundle_days) {
        (None, None) => String::new(),
        (Some(media), Some(bundle)) => format!(
            "Video and audio go to the {bin} after {}, the rest of each capture after {}.",
            days(media),
            days(bundle)
        ),
        (Some(media), None) => format!("Video and audio go to the {bin} after {}.", days(media)),
        (None, Some(bundle)) => format!("Captures go to the {bin} after {}.", days(bundle)),
    }
}

fn shortcut_view(
    kind: ShortcutKind,
    cfg: &ShortcutConfig,
    recording: bool,
    error: Option<&String>,
) -> ShortcutView {
    let mods = cfg.carbon_modifiers;
    ShortcutView {
        kind,
        title: kind.name(),
        label: cfg.label.clone(),
        key: cfg.key_label().to_owned(),
        shift: mods & CARBON_SHIFT_KEY != 0,
        control: mods & CARBON_CONTROL_KEY != 0,
        option: mods & CARBON_OPTION_KEY != 0,
        command: mods & CARBON_CMD_KEY != 0,
        is_default: cfg.is_default_for(kind),
        suggested_fn: cfg!(target_os = "macos").then(|| {
            let default = ShortcutConfig::default_record();
            serde_json::json!({"keyCode":default.key_code,"modifiers":default.carbon_modifiers,"key":default.label})
        }),
        externally_managed: external_record_owned(kind),
        clearable: kind.can_unset(),
        recording,
        error: error.cloned(),
    }
}

fn desktop_record(path: &Path) -> Option<ShortcutConfig> {
    #[cfg(target_os = "linux")]
    {
        let app_preferred = prefers_app_shortcut(&read_json(path));
        crate::capture::engine::runtime::uses_desktop_record(app_preferred, true)
            .then(crate::capture::desktop::linux::hyprland::external_record)
            .flatten()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        None
    }
}

pub(crate) fn external_record_owned(kind: ShortcutKind) -> bool {
    kind == ShortcutKind::Record && desktop_record(&crate::shared::handoff::default_config_path()).is_some()
}

// MARK: The window's logic

/// What the window can ask for.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
pub enum Action {
    Navigate { pane: Pane },
    AgentsPreference { request: u32, enabled: Option<bool>, #[serde(default)] setting: Option<String> },
    AgentsConnection { request: u32, connection: Option<super::agents::Connection>, #[serde(default)] disconnect: Option<String> },
    LabsPreference { request: u32, enabled: Option<bool>, #[serde(default)] setting: Option<String> },
    #[cfg(target_os = "linux")]
    Storage { command: super::storage::Command },
    Connect { command: super::connect::Command },
    RecordingPreference { request: u32, key: String, value: serde_json::Value },
    RecordingMeter { visible: bool },
    PermissionAction { request: u32, intent: PermissionIntent },
    /// A settings control: `launchAtLogin`, `errorReporting`, `videoExport`, `lowerPlayback` (bool),
    /// `playbackLevel` (u8), `microphone` ("default" or a device id), `transcriber`
    /// ("apple"/"hex"/"command"), `hexModel` (an id), `hexLanguage` (a code), `appleLocale`
    /// (a locale id or "auto"), `retention` (a preset id).
    Set {
        key: String,
        value: serde_json::Value,
    },
    /// The recorder for `kind` was clicked.
    RecordShortcut {
        kind: ShortcutKind,
    },
    /// A combination was pressed while recording.
    Shortcut {
        kind: ShortcutKind,
        #[serde(flatten)]
        pressed: Pressed,
    },
    /// Esc, a click elsewhere, or the window losing focus.
    CancelShortcut,
    ResetShortcut {
        kind: ShortcutKind,
    },
    /// The × beside the paste shortcut, or Delete while it records: no shortcut at all.
    ClearShortcut {
        kind: ShortcutKind,
    },
    /// A permission row's button.
    Grant {
        permission: Permission,
    },
    /// Reopen Apparent so a Screen Recording grant takes.
    Reopen,
    ShowCaptures,
    CheckForUpdates,
    DismissUpdateCheck,
    UpdateNow,
    UpdateLater,
    /// "Show Welcome Tour" on About.
    Tour,
    /// Link `apparent` into a folder on PATH, or remove that link.
    InstallCli,
    UninstallCli,
    ConnectHosted,
    ManageSharedLinks,
    Close,
}

/// What the app does with an action.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Effect {
    None,
    ConnectHosted,
    ManageSharedLinks,
    /// Ask macOS (the system prompt): the first press on a row that was never asked.
    Request(Permission),
    /// Already asked or denied: its System Settings pane.
    OpenSettings(Permission),
    OpenLoginItems,
    ShowCaptures,
    CheckForUpdates,
    RelaunchUpdate,
    QuitForUpdate,
    /// The captures folder may have changed size.
    Measure,
    #[cfg(target_os = "linux")]
    MeasureStorage,
    /// The Apple Speech language changed.
    SpeechModel,
    Relaunch,
    Tour,
    Close,
}

/// The outside world the window changes: Apparent's hotkeys and the config file.
pub trait Host {
    fn shortcuts(&self) -> Shortcuts;
    /// Registers both, keeping the old ones if macOS refuses one.
    fn set_shortcuts(&mut self, shortcuts: &Shortcuts) -> Result<(), ShortcutKind>;
    fn pause_shortcuts(&mut self, paused: bool);
    fn config_path(&self) -> PathBuf;
    fn set_login_item(&mut self, on: bool) -> anyhow::Result<()>;
    /// Apparent's binary and the folders `apparent` may be linked into.
    fn command_line(&self) -> crate::composition::command_line::Places;
}

/// The window's own state: what it's recording, what failed, what was asked for.
#[derive(Debug, Default)]
pub struct Panel {
    connect: Option<super::connect::View>,
    recording: Option<ShortcutKind>,
    error: Option<(ShortcutKind, String)>,
    /// Why the last Install or Uninstall failed.
    cli_error: Option<String>,
    requested: BTreeSet<Permission>,
    grants: Option<Grants>,
    captures_size: Option<u64>,
    #[cfg(target_os = "linux")]
    storage: super::storage::State,
    /// The connected microphones, once listed (`mic::Watch` keeps them fresh).
    inputs: Option<crate::capture::engine::runtime::audio::mic::Inputs>,
    update_check: UpdateCheck,
}

impl Panel {
    // About is also the app-launch surface. Keep native login/shortcut/device
    // discovery and unrelated pane state out of its GUI-thread projection.
    fn about_state(&self, config_path: &Path) -> serde_json::Value {
        super::about_state(config_path, &self.update_check)
    }

    /// The same Record recorder state for Settings and the onboarding shortcut page.
    pub fn record_shortcut(&self, host: &dyn Host) -> ShortcutView {
        let kind = ShortcutKind::Record;
        let error = self
            .error
            .as_ref()
            .filter(|(k, _)| *k == kind)
            .map(|(_, e)| e);
        shortcut_view(
            kind,
            host.shortcuts().get(kind),
            self.recording == Some(kind),
            error,
        )
    }

    #[cfg(test)]
    pub fn recording(&self) -> Option<ShortcutKind> {
        self.recording
    }

    pub fn set_grants(&mut self, grants: Grants) {
        self.grants = Some(grants);
    }

    pub fn set_captures_size(&mut self, bytes: u64) {
        self.captures_size = Some(bytes);
    }

    pub fn set_inputs(&mut self, inputs: crate::capture::engine::runtime::audio::mic::Inputs) {
        self.inputs = Some(inputs);
    }

    #[cfg(target_os = "linux")]
    fn finish_update_check(&mut self, result: Result<&'static str, (String, Option<UpdateFailure>)>) {
        self.update_check.finish(result);
    }

    pub fn on(&mut self, action: Action, host: &mut dyn Host) -> Effect {
        match action {
            // Session owns the asynchronous controller; forged actions cannot bypass it.
            Action::Connect { .. } | Action::RecordingPreference { .. } | Action::RecordingMeter { .. } | Action::PermissionAction { .. } => Effect::None,
            Action::ConnectHosted => Effect::ConnectHosted,
            Action::ManageSharedLinks => Effect::ManageSharedLinks,
            Action::Set { key, value } => self.set(&key, &value, host),
            #[cfg(target_os = "linux")]
            Action::Storage { command } => {
                let refresh = matches!(command, super::storage::Command::Refresh);
                if !self.storage.command(&host.config_path(), command) { Effect::None }
                else if refresh { Effect::MeasureStorage }
                else { Effect::Measure }
            }
            Action::RecordShortcut { kind } => {
                self.error = None;
                if self.recording.replace(kind).is_none() {
                    host.pause_shortcuts(true);
                }
                Effect::None
            }
            Action::CancelShortcut => {
                self.stop_recording(host);
                Effect::None
            }
            Action::Shortcut { kind, pressed } => {
                if self.recording != Some(kind) {
                    return Effect::None;
                }
                self.stop_recording(host);
                let mut shortcuts = host.shortcuts();
                if kind.can_unset() && pressed.is_delete() {
                    self.apply(kind, ShortcutConfig::unset(), &mut shortcuts, host);
                    return Effect::None;
                }
                if pressed.is_delete() {
                    self.error = Some((kind, Rejection::NoModifier.message()));
                    return Effect::None;
                }
                let other = match kind {
                    ShortcutKind::Record => &shortcuts.paste,
                    ShortcutKind::Paste => &shortcuts.record,
                };
                match validate(kind, &pressed, other) {
                    Ok(cfg) => self.apply(kind, cfg, &mut shortcuts, host),
                    Err(rejection) => self.error = Some((kind, rejection.message())),
                }
                Effect::None
            }
            Action::ResetShortcut { kind } => {
                if external_record_owned(kind) {
                    return Effect::None;
                }
                self.stop_recording(host);
                let mut shortcuts = host.shortcuts();
                self.apply(kind, kind.default_config(), &mut shortcuts, host);
                Effect::None
            }
            Action::ClearShortcut { kind } => {
                if external_record_owned(kind) {
                    return Effect::None;
                }
                self.stop_recording(host);
                if kind.can_unset() {
                    let mut shortcuts = host.shortcuts();
                    self.apply(kind, ShortcutConfig::unset(), &mut shortcuts, host);
                }
                Effect::None
            }
            Action::Grant { permission } => self.grant(permission),
            Action::Reopen => {
                if self.screen_relaunch() {
                    Effect::Relaunch
                } else {
                    Effect::None
                }
            }
            Action::Navigate { .. } | Action::AgentsPreference { .. } | Action::LabsPreference { .. } | Action::AgentsConnection { .. } => Effect::None, // Session owns presentation routing.
            Action::ShowCaptures => Effect::ShowCaptures,
            Action::CheckForUpdates => {
                if cfg!(target_os = "linux") && self.update_check.checking {
                    return Effect::None;
                }
                if cfg!(target_os = "linux") {
                    self.update_check = UpdateCheck { checking: true, ..Default::default() };
                }
                Effect::CheckForUpdates
            }
            Action::DismissUpdateCheck => {
                self.update_check.result = None;
                #[cfg(target_os = "linux")]
                { self.update_check.failure = None; }
                Effect::None
            }
            Action::UpdateLater => {
                self.update_check.result = None;
                Effect::None
            }
            Action::UpdateNow => {
                #[cfg(target_os = "linux")]
                {
                    use crate::capture::desktop::linux::update::{restart_pending, status_at};
                    if !self.update_check.checking
                        && status_at(&host.config_path()).as_ref().is_ok_and(restart_pending)
                    {
                        return Effect::RelaunchUpdate;
                    }
                }
                Effect::None
            }
            Action::Tour => Effect::Tour,
            Action::InstallCli => {
                let result = crate::composition::command_line::install(&host.command_line());
                self.note_cli("install", result.map(drop));
                Effect::None
            }
            Action::UninstallCli => {
                let result = crate::composition::command_line::uninstall(&host.command_line());
                self.note_cli("uninstall", result);
                Effect::None
            }
            Action::Close => {
                self.stop_recording(host);
                Effect::Close
            }
        }
    }

    fn note_cli(&mut self, verb: &str, result: anyhow::Result<()>) {
        self.cli_error = result.err().map(|error| {
            crate::capture::engine::runtime::apparent_log(format!("Command-line tool: {verb}: {error:#}"));
            format!("Couldn't {verb} it: {error}.")
        });
    }

    fn stop_recording(&mut self, host: &mut dyn Host) {
        if self.recording.take().is_some() {
            host.pause_shortcuts(false);
        }
    }

    fn apply(
        &mut self,
        kind: ShortcutKind,
        cfg: ShortcutConfig,
        shortcuts: &mut Shortcuts,
        host: &mut dyn Host,
    ) {
        if shortcuts.get(kind) == &cfg {
            self.error = None;
            return;
        }
        shortcuts.set(kind, cfg.clone());
        match host.set_shortcuts(shortcuts) {
            Ok(()) => {
                self.error = None;
                if let Err(error) = save_shortcut_in(&host.config_path(), kind, &cfg) {
                    crate::capture::engine::runtime::apparent_log(format!("Saving the shortcut failed: {error:#}"));
                }
            }
            Err(refused) => self.error = Some((refused, Rejection::Refused.message())),
        }
    }

    fn set(&mut self, key: &str, value: &serde_json::Value, host: &mut dyn Host) -> Effect {
        let path = host.config_path();
        let write = |key: &str, value: serde_json::Value| {
            if let Err(error) = crate::shared::handoff::set_config_value_in(&path, key, value) {
                crate::capture::engine::runtime::apparent_log(format!("Saving {key} failed: {error:#}"));
            }
        };
        match (key, value) {
            ("errorReporting", serde_json::Value::Bool(on)) => {
                if let Err(error) = crate::capture::desktop::workflow::error_reporting::set_enabled_in(&path, *on) {
                    crate::capture::engine::runtime::apparent_log(format!("Saving {key} failed: {error:#}"));
                }
            }
            ("agentDemoVideo", serde_json::Value::Bool(on)) => {
                if let Err(error) = crate::shared::handoff::set_experiment_in(&path, "agentDemoVideo", *on) {
                    crate::capture::engine::runtime::apparent_log(format!("Saving {key} failed: {error:#}"));
                }
            }
            ("launchAtLogin", serde_json::Value::Bool(on)) => {
                if let Err(error) = super::save_launch_at_login(&path, *on, |wanted| host.set_login_item(wanted)) {
                    crate::capture::engine::runtime::apparent_log(format!("Launch at login: {error:#}"));
                    return Effect::None;
                }
                if *on && login_item() == LoginItem::NeedsApproval {
                    return Effect::OpenLoginItems;
                }
            }

            ("updateChannel", serde_json::Value::String(channel))
                if !self.update_check.checking && matches!(channel.as_str(), "stable" | "main") =>
            {
                match crate::shared::handoff::set_config_value_in(&path, key, value.clone()) {
                    Ok(()) => self.update_check = UpdateCheck::default(),
                    Err(error) => crate::capture::engine::runtime::apparent_log(format!("Saving {key} failed: {error:#}")),
                }
            }
            _ if super::recording_key(key, value) => {
                match super::save_recording(&path, key, value, self.inputs.as_ref()) {
                    Ok(effect) => return effect,
                    Err(error) => crate::capture::engine::runtime::apparent_log(format!("Saving {key} failed: {error:#}")),
                }
            }
            // An absolute folder from the helper's open panel; "" or null is the built-in one.
            // Captures already made stay where they are.
            ("capturesDir", serde_json::Value::Null | serde_json::Value::String(_)) => {
                match crate::shared::handoff::capture_location::set_in(&path, value.as_str(), None, || true) {
                    Ok(()) => return Effect::Measure,
                    Err(code) => crate::capture::engine::runtime::apparent_log(format!("Saving capturesDir failed: {code}")),
                }
            }
            ("retention", serde_json::Value::String(id)) => {
                if crate::capture::engine::bundle::retention::Preset::ALL
                    .into_iter()
                    .any(|p| preset_id(p) == id)
                {
                    // The fallback menu uses the same leaf-preserving executor as
                    // Electron/Linux, not a whole-object Engine config write.
                    use crate::capture::desktop::workflow::storage_preferences;
                    let result = storage_preferences::read(&path).and_then(|facts| {
                        let revision = facts["revision"].as_str().ok_or("config_read_failed")?;
                        storage_preferences::save(&path, Some(id), revision, || true)
                    });
                    if let Err(code) = result {
                        crate::capture::engine::runtime::apparent_log(format!("Saving retention failed: {code}"));
                    }
                    return Effect::Measure;
                }
            }
            _ => crate::capture::engine::runtime::apparent_log(format!("Settings: ignoring {key}={value}")),
        }
        Effect::None
    }

    fn status(&self, permission: Permission) -> Status {
        self.grants
            .as_ref()
            .map_or(Status::NotDetermined, |g| g.status(permission))
    }

    fn screen_relaunch(&self) -> bool {
        crate::permission_admission::screen_relaunch(self.grants.as_ref())
    }

    /// Like onboarding: the first press asks macOS, later ones (or a denied one) open the
    /// System Settings pane.
    fn grant(&mut self, permission: Permission) -> Effect {
        let repair = crate::permission_admission::repair(
            self.status(permission), self.requested.contains(&permission), false, false,
        );
        match repair {
            Repair::Request | Repair::OpenSettings => {
                self.requested.insert(permission);
                if repair == Repair::Request { Effect::Request(permission) }
                else { Effect::OpenSettings(permission) }
            }
            Repair::None | Repair::CopyInput => Effect::None,
        }
    }

    pub fn view(&self, host: &dyn Host) -> View {
        let config = crate::shared::handoff::load_config_from(&host.config_path());
        let shortcuts = host.shortcuts();
        let hex = crate::shared::hex::cached_status();
        let engine = config
            .transcriber
            .as_deref()
            .and_then(crate::capture::engine::runtime::audio::transcription::transcribe::Engine::parse)
            .unwrap_or_default();
        let menu = crate::capture::engine::runtime::audio::transcription::transcribe::menu_state(engine, hex.as_ref(), config.hex_model.as_deref());
        let command = crate::capture::engine::runtime::audio::transcription::command_transcriber::Program::load_from(&host.config_path())
            .ok()
            .map(|program| program.name());
        let policy = crate::capture::engine::bundle::retention::Policy::load_from(&host.config_path());
        let login = login_item();
        let microphone = config.microphone_enabled.unwrap_or(true);
        View {
            version: env!("APPARENT_VERSION_LABEL").to_owned(),
            connect: self.connect.clone(),
            hosted: crate::shared::handoff::experiment_enabled_in(&config, crate::connect::hosted::HOSTED_SHARING)
                .then(|| crate::connect::hosted::account_view_in(&host.config_path())),
            login: LoginView {
                on: matches!(login, LoginItem::On | LoginItem::NeedsApproval),
                available: login != LoginItem::Unavailable,
                needs_approval: login == LoginItem::NeedsApproval,
            },
            error_reporting: crate::capture::desktop::workflow::error_reporting::enabled_in(&host.config_path()),
            agent_demo_video: crate::shared::handoff::experiment_enabled_in(&config, "agentDemoVideo"),
            shortcuts: ShortcutKind::ALL
                .into_iter()
                .map(|kind| {
                    let error = self
                        .error
                        .as_ref()
                        .filter(|(k, _)| *k == kind)
                        .map(|(_, e)| e);
                    shortcut_view(
                        kind,
                        shortcuts.get(kind),
                        self.recording == Some(kind),
                        error,
                    )
                })
                .collect(),
            microphone: super::microphone_view(
                crate::capture::engine::runtime::audio::mic::choice_in(&host.config_path()).as_ref(),
                self.inputs.as_ref(),
                self.status(Permission::Microphone) == Status::Granted,
            ),
            lower_playback: config.lower_playback.unwrap_or(false),
            playback_level: config.recording_volume(),
            transcriber: TranscriberView {
                engine: match engine {
                    crate::capture::engine::runtime::audio::transcription::transcribe::Engine::Command if command.is_some() => "command",
                    _ if menu.hex_checked => "hex",
                    _ => "apple",
                },
                hex_title: menu.hex_title,
                hex_enabled: menu.hex_enabled,
                language: crate::shared::handoff::hex_language_from(&config),
                apple_locale: crate::shared::handoff::apple_locale_from(&config)
                    .unwrap_or_else(|| "auto".into()),
                models: menu
                    .models
                    .into_iter()
                    .map(|(id, title, chosen)| ModelView { id, title, chosen })
                    .collect(),
                command,
            },
            video_export: config.video_export_enabled(),
            retention: retention_view(&policy),
            captures_size: self.captures_size.map(crate::capture::engine::bundle::retention::format_bytes),
            captures_dir: CapturesDirView::new(&config),
            #[cfg(target_os = "linux")]
            storage: self.storage.view(&host.config_path()),
            permissions: crate::permission_admission::project_rows(
                settings_permissions::platform(), self.grants.as_ref(), &self.requested, microphone, &config, true,
            ).collect(),
            updates: updates_available(),
            update_check: self.update_check.clone(),
            update_channel: if config.update_channel.as_deref() == Some("main") {
                "main"
            } else {
                "stable"
            },
            main_updates: cfg!(target_os = "linux"),
            command_line: CommandLineView::new(
                &crate::composition::command_line::state(&host.command_line()),
                self.cli_error.as_deref(),
            ),
            skill_command: SKILL_COMMAND,
        }
    }
}

/// Whether this copy can check for updates: Sparkle in Apparent.app; on Windows the releases
/// page always opens.
pub(super) fn updates_available() -> bool {
    #[cfg(target_os = "macos")]
    return crate::capture::desktop::sparkle::available();
    #[cfg(target_os = "linux")]
    return std::env::var_os("APPIMAGE").is_some();
    #[cfg(target_os = "windows")]
    true
}

#[cfg(not(target_os = "linux"))]
fn check_for_updates() {
    #[cfg(target_os = "macos")]
    crate::capture::desktop::sparkle::check_for_updates();
    #[cfg(target_os = "windows")]
    let _ = crate::shared::handoff::open_path(Path::new(RELEASES_URL));
}

#[cfg(target_os = "windows")]
const RELEASES_URL: &str = "https://github.com/tryapparent/apparent/releases/latest";

// MARK: The live window

/// The real hotkeys and config file.
pub struct AppHost<'a> {
    pub telemetry: &'a crate::capture::engine::runtime::SharedCaptureTelemetry,
}

impl Host for AppHost<'_> {
    fn shortcuts(&self) -> Shortcuts {
        let (record, paste) = self.telemetry.shortcuts();
        Shortcuts { record, paste }
    }

    fn set_shortcuts(&mut self, shortcuts: &Shortcuts) -> Result<(), ShortcutKind> {
        crate::capture::engine::runtime::set_shortcuts(
            self.telemetry,
            shortcuts.record.clone(),
            shortcuts.paste.clone(),
        )?;
        note_paste_label(&shortcuts.paste.label);
        Ok(())
    }

    fn pause_shortcuts(&mut self, paused: bool) {
        crate::capture::engine::runtime::pause_shortcuts(self.telemetry, paused);
    }

    fn config_path(&self) -> PathBuf {
        crate::shared::handoff::default_config_path()
    }

    fn set_login_item(&mut self, on: bool) -> anyhow::Result<()> {
        set_login_item(on)
    }

    fn command_line(&self) -> crate::composition::command_line::Places {
        crate::composition::command_line::Places::system()
    }
}

/// From the window's helper process and its pollers.
#[derive(Clone, Debug)]
pub enum Event {
    #[cfg(target_os = "linux")]
    StorageUsage { version: u64, result: Result<serde_json::Value, &'static str> },
    Presentation { generation: u64, event: Box<Event> },
    Connect(super::connect::Event),
    Action(Action),
    Grants(Grants),
    CapturesSize(u64),
    Microphones(crate::capture::engine::runtime::audio::mic::Inputs),
    #[cfg(target_os = "linux")]
    UpdateProgress(crate::capture::desktop::linux::update::UpdateProgress),
    #[cfg(target_os = "linux")]
    UpdateChecked(Result<&'static str, (String, Option<UpdateFailure>)>),
    /// Something outside the window may have changed (Hex, the login item): redraw.
    Tick,
    RecordingLevel { meter: u64, level: f32 },
    Exited,
}

impl Event {
    pub(super) fn for_presentation(self, current: u64) -> Option<Self> {
        match self {
            Self::Presentation { generation, event } if generation == current => Some(*event),
            Self::Presentation { .. } => None,
            event => Some(event),
        }
    }
}

/// The open Settings window.
pub struct Session {
    generation: u64,
    electron: bool,
    pane: Option<Pane>,
    panel: Panel,
    connect: Option<super::connect::Controller>,
    transport: Transport,
    polling: std::sync::Arc<std::sync::atomic::AtomicBool>,
    #[cfg(target_os = "linux")]
    storage_scan: std::sync::Arc<std::sync::atomic::AtomicU64>,
    events: std::sync::Arc<dyn Fn(Event) + Send + Sync>,
    last_view: String,
    permissions: PermissionsPresenter,
    meter_visible: bool,
    meter_serial: u64,
    meter: Option<(String, super::RecordingMeter)>,
    _microphones: crate::capture::engine::runtime::audio::mic::Watch,
}

// Presentation is independent of Connect visibility and never grants consent.
pub(super) fn electron_general(pane: Option<Pane>) -> bool {
    pane == Some(Pane::General)
}

fn initial_settings_pane(pane: Option<Pane>) -> Option<Pane> {
    Some(pane.unwrap_or(Pane::General))
}

pub(super) fn electron_storage(pane: Option<Pane>, enabled: bool) -> bool {
    enabled && pane == Some(Pane::Storage)
}

impl Session {
    pub fn open(
        pane: Option<Pane>,
        grants: Option<Grants>,
        events: impl Fn(Event) + Send + Sync + 'static,
    ) -> anyhow::Result<Self> {
        use std::sync::atomic::{AtomicBool, Ordering};

        let events: std::sync::Arc<dyn Fn(Event) + Send + Sync> = std::sync::Arc::new(events);
        let pane = initial_settings_pane(pane);
        let generation = super::presentation::generation();
        let (transport, electron) = Self::open_presentation(pane, generation, &events, true)?;

        let polling = std::sync::Arc::new(AtomicBool::new(true));
        let alive = std::sync::Arc::clone(&polling);
        let poll = std::sync::Arc::clone(&events);
        #[cfg(target_os = "linux")]
        let storage_scan = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        #[cfg(target_os = "linux")]
        let scan = storage_scan.clone();
        std::thread::spawn(move || {
            let mut n = 0_u32;
            while alive.load(Ordering::Acquire) {
                // Hex every 30 s; native Linux usage on open/on demand. Keep
                // other platforms' size polling and the one-second grant refresh.
                if n % 30 == 0 {
                    crate::shared::hex::refresh_in_background();
                    #[cfg(not(target_os = "linux"))]
                    {
                        let size =
                            crate::capture::engine::bundle::retention::captures_size(&crate::shared::handoff::default_captures_dir());
                        poll(Event::CapturesSize(size));
                    }
                }
                #[cfg(target_os = "linux")]
                if n == 0 {
                    let result = crate::capture::desktop::workflow::storage_preferences::usage(
                        &crate::shared::handoff::default_config_path(),
                        || alive.load(Ordering::Acquire) && scan.load(Ordering::Acquire) == 0);
                    poll(Event::Presentation { generation, event: Box::new(Event::StorageUsage { version: 0, result }) });
                }
                poll(Event::Tick);
                n += 1;
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        });

        let list = std::sync::Arc::clone(&events);
        let microphones =
            crate::capture::engine::runtime::audio::mic::Watch::start(move || list(Event::Microphones(crate::capture::engine::runtime::audio::mic::inputs())));

        let mut panel = Panel::default();
        if let Some(grants) = grants {
            panel.set_grants(grants);
        }
        Ok(Self {
            generation,
            electron,
            pane,
            panel,
            connect: None,
            transport,
            polling,
            #[cfg(target_os = "linux")]
            storage_scan,
            events,
            last_view: String::new(),
            permissions: Default::default(),
            meter_visible: false,
            meter_serial: 0,
            meter: None,
            _microphones: microphones,
        })
    }

    fn open_presentation(
        pane: Option<Pane>, generation: u64,
        events: &std::sync::Arc<dyn Fn(Event) + Send + Sync>,
        allow_electron: bool,
    ) -> anyhow::Result<(Transport, bool)> {
        let target = events.clone();
        let events: std::sync::Arc<dyn Fn(Event) + Send + Sync> = std::sync::Arc::new(move |event| {
            target(Event::Presentation { generation, event: Box::new(event) });
        });
        if allow_electron && super::electron_pane(pane) {
            match super::presentation::open(pane.unwrap_or(Pane::Storage), events.clone()) {
                Ok(transport) => return Ok((transport, true)),
                Err(error) => crate::capture::engine::runtime::apparent_log(format!("Settings fallback: {error:#}")),
            }
        }
        let transport = if cfg!(not(target_os = "macos")) {
            let (sender, receiver) = flume::unbounded();
            crate::capture::desktop::settings::settings_window::request_open(receiver, pane, events);
            Transport::InProcess(Some(sender))
        } else {
            Self::spawn_helper(pane, events)?
        };
        Ok((transport, false))
    }

    /// `apparent-helper settings`, reading its actions off stdout.
    fn spawn_helper(
        pane: Option<Pane>,
        events: std::sync::Arc<dyn Fn(Event) + Send + Sync>,
    ) -> anyhow::Result<Transport> {
        use std::io::BufRead;
        use std::process::{Command, Stdio};

        let mut command = Command::new(crate::capture::desktop::helper::path()?);
        command.arg("settings");
        if let Some(serde_json::Value::String(pane)) = pane.map(serde_json::to_value).transpose()? {
            command.args(["--pane", &pane]);
        }
        let dev_icon = concat!(env!("CARGO_MANIFEST_DIR"), "/shared/assets/brand/apparent-a.png");
        if Path::new(dev_icon).is_file() {
            command.args(["--icon", dev_icon]);
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();

        std::thread::spawn(move || {
            if let Some(stdout) = stdout {
                for line in std::io::BufReader::new(stdout)
                    .lines()
                    .map_while(Result::ok)
                {
                    match serde_json::from_str::<Action>(&line) {
                        Ok(action) => events(Event::Action(action)),
                        Err(error) => {
                            crate::capture::engine::runtime::apparent_log(format!("settings: {error}: {line}"))
                        }
                    }
                }
            }
            events(Event::Exited);
        });
        Ok(Transport::Helper { child: crate::capture::ui_process::UiChild::new(child), stdin })
    }

    /// Feeds an event in, redraws, and returns what the app must do (`Relaunch`, `Tour`,
    /// `Close`); the rest is done here.
    /// Filter retired windows before coordinator safety/permission checks too.
    pub fn current_event(&self, event: Event) -> Option<Event> {
        let presentation = matches!(&event, Event::Presentation { .. });
        let event = event.for_presentation(self.generation)?;
        if presentation && self.electron
            && let Event::Action(action) = &event
            && !self.pane.is_some_and(|pane| super::presentation::admits(pane, action))
        { return None; }
        Some(event)
    }

    pub fn event(&mut self, event: Event, host: &mut dyn Host) -> Effect {
        let Some(event) = self.current_event(event) else { return Effect::None; };
        let effect = match event {
            Event::Presentation { .. } => return Effect::None,
            #[cfg(target_os = "linux")]
            Event::StorageUsage { version, result } => {
                self.panel.storage.measured(version, result);
                Effect::None
            }
            Event::Action(Action::Navigate { pane }) => {
                self.panel.on(Action::CancelShortcut, host);
                self.show(Some(pane));
                Effect::None
            }
            Event::Action(Action::RecordingPreference { request, key, value }) => {
                if self.electron && self.pane == Some(Pane::Recording) {
                    let result = if super::recording_key(&key, &value)
                        && (cfg!(target_os = "macos") || !matches!(key.as_str(), "appleLocale" | "hexLanguage"))
                    {
                        super::save_recording(&host.config_path(), &key, &value, self.panel.inputs.as_ref())
                    } else {
                        Err(anyhow::anyhow!("Unsupported Recording preference"))
                    };
                    match &result {
                        Ok(Effect::SpeechModel) => crate::capture::engine::runtime::audio::transcription::speech_model::restart(),
                        Err(error) => crate::capture::engine::runtime::apparent_log(format!("Saving {key} failed: {error:#}")),
                        _ => {}
                    }
                    self.sync(host);
                    self.send(&serde_json::json!({"type":"recording-result","request":request,"ok":result.is_ok()}));
                }
                return Effect::None;
            }
            Event::Action(Action::RecordingMeter { visible }) => {
                if self.electron && self.pane == Some(Pane::Recording) {
                    self.meter_visible = visible;
                }
                Effect::None
            }
            Event::RecordingLevel { meter, level } => {
                if self.electron && self.pane == Some(Pane::Recording) && self.meter.is_some() && meter == self.meter_serial {
                    self.send(&serde_json::json!({"type":"recording-level","level":level}));
                }
                return Effect::None;
            }
            Event::Action(Action::AgentsPreference { request, enabled, setting }) => {
                if self.electron && self.pane == Some(Pane::Agents) {
                    self.send(&super::agents::request_for(&host.config_path(), request, enabled, setting.as_deref()));
                }
                Effect::None
            }
            Event::Action(Action::AgentsConnection { request, connection, disconnect }) => {
                if self.electron && self.pane == Some(Pane::Agents) {
                    self.send(&super::agents::connection_request(&host.config_path(), request, connection, disconnect));
                }
                Effect::None
            }
            Event::Action(Action::LabsPreference { request, enabled, setting }) => {
                if self.electron && self.pane == Some(Pane::Labs) {
                    let reply = super::labs::request(&host.config_path(), request, enabled, setting.as_deref());
                    #[cfg(any(target_os = "linux", target_os = "macos"))]
                    if setting.as_deref().is_none_or(|name| name == "streaming")
                        && let Some(on) = enabled && reply["facts"]["saved"].as_bool() == Some(on) {
                        if on { crate::capture::engine::runtime::audio::transcription::speech_preview::prepare(); }
                        else { crate::capture::engine::runtime::audio::transcription::speech_preview::release_cache(); }
                    }
                    self.send(&reply);
                }
                Effect::None
            }
            Event::Connect(event) => {
                if self.connect.as_mut().is_some_and(|controller| controller.receive(event)) {
                    crate::connect::hosted::start_worker();
                }
                Effect::None
            }
            Event::Action(Action::Connect { command }) => {
                if let Some(controller) = &mut self.connect {
                    if let Some(uri) = controller.command(command) {
                        let _ = crate::shared::handoff::open_path(Path::new(&uri));
                    }
                }
                Effect::None
            }
            Event::Action(Action::PermissionAction { request, intent }) => {
                if self.presents_permissions() && let Err(error) = self.permissions.begin(request, intent) {
                    self.permission_result(request, Some(error));
                }
                return Effect::None;
            }
            Event::Action(action) => {
                crate::capture::engine::runtime::apparent_log(format!("settings: {action:?}"));
                self.panel.on(action, host)
            }
            Event::Grants(grants) => {
                let outcome = self.permissions.observe(&grants, &mut self.panel.requested, &host.config_path());
                self.panel.set_grants(grants);
                match outcome {
                    Some(Outcome::Reply(request, error)) => {
                        self.sync_permissions(host);
                        self.permission_result(request, error);
                        return Effect::None;
                    }
                    Some(Outcome::Reopen) => Effect::Relaunch,
                    None => Effect::None,
                }
            }
            Event::CapturesSize(bytes) => {
                self.panel.set_captures_size(bytes);
                Effect::None
            }
            Event::Microphones(inputs) => {
                self.panel.set_inputs(inputs);
                Effect::None
            }
            #[cfg(target_os = "linux")]
            Event::UpdateProgress(progress) => {
                self.panel.update_check.progress = Some(progress);
                Effect::None
            }
            #[cfg(target_os = "linux")]
            Event::UpdateChecked(result) => {
                self.panel.finish_update_check(result);
                Effect::None
            }
            Event::Tick => {
                if let Some(request) = self.permissions.expire() {
                    self.permission_result(request, Some("unavailable"));
                }
                Effect::None
            }
            Event::Exited if self.electron => {
                self.permissions = Default::default();
                self.meter_visible = false;
                self.meter = None;
                // EOF without a normal Close means Electron crashed or failed to
                // launch. Keep Settings usable without touching saved policy.
                let generation = super::presentation::generation();
                if let Ok((transport, electron)) = Self::open_presentation(self.pane, generation, &self.events, false) {
                    self.generation = generation;
                    self.electron = electron;
                    self.last_view.clear();
                    super::presentation::retire(std::mem::replace(&mut self.transport, transport));
                    self.sync(host);
                    return Effect::None;
                }
                return Effect::Close;
            }
            Event::Exited => {
                if let Some(controller) = &mut self.connect { controller.close(); }
                self.panel.on(Action::Close, host);
                return Effect::Close;
            }
        };
        self.sync_connect(effect != Effect::Close);
        if let Some(controller) = &mut self.connect {
            controller.refresh();
            if let Some(view) = controller.native_view() {
                self.panel.connect = view;
            }
        }
        let result = match effect {
            // Attributed to whichever process asks, so Apparent itself asks.
            Effect::Request(Permission::ScreenRecording) => {
                crate::capture::engine::runtime::request_screen_capture();
                Effect::None
            }
            Effect::Request(permission) => {
                self.send(&serde_json::json!({"type": "request", "permission": permission}));
                Effect::None
            }
            Effect::OpenSettings(permission) => {
                self.send(&serde_json::json!({"type": "open-settings", "permission": permission}));
                Effect::None
            }
            Effect::OpenLoginItems => {
                open_login_items_settings();
                Effect::None
            }
            Effect::ShowCaptures => {
                let dir = crate::shared::handoff::default_captures_dir();
                let _ = std::fs::create_dir_all(&dir);
                let _ = crate::shared::handoff::open_path(&dir);
                Effect::None
            }
            Effect::CheckForUpdates => {
                #[cfg(target_os = "linux")]
                {
                    let events = std::sync::Arc::clone(&self.events);
                    std::thread::spawn(move || {
                        let result = crate::capture::desktop::linux::update::check_with_progress(
                            &|progress| events(Event::UpdateProgress(progress)),
                        ).map_err(|error| (format!("{error:#}"), update_failure(&error)));
                        events(Event::UpdateChecked(result));
                    });
                }
                #[cfg(not(target_os = "linux"))]
                check_for_updates();
                Effect::None
            }
            Effect::RelaunchUpdate => {
                #[cfg(target_os = "linux")]
                {
                    match crate::capture::desktop::linux::update::relaunch_staged() {
                        Ok(()) => return Effect::QuitForUpdate,
                        Err(error) => {
                            crate::capture::engine::runtime::apparent_log(format!("Could not relaunch updated AppImage: {error:#}"));
                            use crate::capture::desktop::workflow::error_reporting::{self, updates::{Stage, Trigger}};
                            error_reporting::report_update(&error_reporting::updates::failure(Stage::Restart, error), Trigger::User);
                            self.panel.update_check.result = Some(UpdateResult::Failed);
                            self.panel.update_check.failure = Some(UpdateFailure::Restart);
                        }
                    }
                }
                Effect::None
            }
            #[cfg(target_os = "linux")]
            Effect::MeasureStorage => {
                self.measure_storage(host);
                Effect::None
            }
            Effect::Measure => {
                crate::capture::engine::bundle::retention::nudge();
                let events = std::sync::Arc::clone(&self.events);
                #[cfg(target_os = "linux")]
                self.measure_storage(host);
                #[cfg(not(target_os = "linux"))]
                std::thread::spawn(move || {
                    let size =
                        crate::capture::engine::bundle::retention::captures_size(&crate::shared::handoff::default_captures_dir());
                    events(Event::CapturesSize(size));
                });
                Effect::None
            }
            Effect::SpeechModel => {
                crate::capture::engine::runtime::audio::transcription::speech_model::restart();
                Effect::None
            }
            other => other,
        };
        self.sync(host);
        result
    }

    fn sync_connect(&mut self, active: bool) {
        sync_native(&mut self.connect, active && !self.electron && self.pane == Some(Pane::General), &self.events);
        if self.connect.is_none() { self.panel.connect = None; }
    }

    pub fn show(&mut self, pane: Option<Pane>) {
        if let Some(pane) = pane {
            if self.pane != Some(pane) {
                self.permissions = Default::default();
            }
            let electron = super::electron_pane(Some(pane));
            // Every adopted pane uses settings.html and the same restricted bridge.
            // Native-only destinations still replace the presentation.
            if electron != self.electron && !(matches!(pane, Pane::Recording | Pane::Permissions) && self.pane == Some(pane)) {
                let generation = super::presentation::generation();
                match Self::open_presentation(Some(pane), generation, &self.events, true) {
                    Ok((transport, electron)) => {
                        self.send(&serde_json::json!({"type": "close"}));
                        self.generation = generation;
                        self.electron = electron;
                        self.pane = Some(pane);
                        self.last_view.clear();
                        super::presentation::retire(std::mem::replace(&mut self.transport, transport));
                    }
                    Err(error) => {
                        crate::capture::engine::runtime::apparent_log(format!("Settings navigation failed: {error:#}"));
                        return;
                    }
                }
            }
        }
        if pane.is_some() {
            if self.pane != pane {
                self.last_view.clear();
                self.meter_visible = false;
                self.meter = None;
            }
            self.pane = pane;
        }
        self.sync_connect(true);
        self.send(&serde_json::json!({"type": "show", "pane": pane}));
    }

    #[cfg(target_os = "linux")]
    fn measure_storage(&self, host: &dyn Host) {
        use std::sync::atomic::Ordering;
        let generation = self.generation;
        let version = self.panel.storage.usage_version;
        self.storage_scan.store(version, Ordering::Release);
        let scan = self.storage_scan.clone();
        let alive = self.polling.clone();
        let events = self.events.clone();
        let config = host.config_path();
        std::thread::spawn(move || {
            let result = crate::capture::desktop::workflow::storage_preferences::usage(
                &config, || alive.load(Ordering::Acquire) && scan.load(Ordering::Acquire) == version);
            events(Event::Presentation { generation, event: Box::new(Event::StorageUsage { version, result }) });
        });
    }

    pub fn sync(&mut self, host: &dyn Host) {
        // Storage reads its narrow projected socket contract. Do not forward the
        // other pages' state to a renderer which does not present those pages.
        if self.electron {
            if self.pane == Some(Pane::Recording) {
                self.sync_recording(host);
            }
            if self.pane == Some(Pane::Permissions) {
                self.sync_permissions(host);
            }
            if self.pane == Some(Pane::General) {
                let view = self.panel.view(host);
                self.send_state(serde_json::json!({"type":"general-state",
                    "platform": if cfg!(target_os="macos") {"macos"} else {"linux"},
                    "login":view.login,"shortcuts":view.shortcuts,"errorReporting":view.error_reporting}));
            }
            if self.pane == Some(Pane::Labs) {
                let message = serde_json::json!({"type":"labs-state","facts":super::labs::facts(&host.config_path())});
                self.send_state(message);
            }
            if self.pane == Some(Pane::About) {
                self.send_state(self.panel.about_state(&host.config_path()));
            }
            if self.pane == Some(Pane::Agents) {
                let facts = super::agents::facts(&host.config_path());
                self.send_state(serde_json::json!({"type": "agents-state", "facts": facts}));
            }
            return;
        }
        let mut view = serde_json::to_value(self.panel.view(host)).unwrap_or_default();
        view["type"] = "state".into();
        // Switched from Hex to Apple Speech: get its model now, not at the first capture.
        let speech = crate::capture::engine::runtime::audio::transcription::speech_model::current();
        if view["transcriber"]["engine"] == "apple"
            && speech.state == crate::capture::engine::runtime::audio::transcription::speech_model::State::Unknown
        {
            crate::capture::engine::runtime::audio::transcription::speech_model::ensure();
        }
        view["transcriber"]["speech"] = serde_json::to_value(speech).unwrap_or_default();
        self.send_state(view);
    }

    fn presents_permissions(&self) -> bool {
        self.electron && self.pane == Some(Pane::Permissions)
    }

    pub(crate) fn note_grants(&mut self, grants: Grants, changed: bool) -> Option<Event> {
        if changed || self.permissions.waiting() {
            Some(Event::Grants(grants))
        } else {
            self.panel.set_grants(grants);
            None
        }
    }

    pub(crate) fn restart(&mut self, busy: bool) -> bool {
        let error = settings_permissions::restart(busy);
        if let Some(request) = self.permissions.take_reopen_request() {
            self.permission_result(request, error);
        }
        error.is_none()
    }

    fn permission_result(&mut self, request: u32, error: Option<&str>) {
        self.send(&serde_json::json!({"type":"permission-result", "request":request, "error":error}));
    }

    fn sync_permissions(&mut self, host: &dyn Host) {
        self.send_state(settings_permissions::state(self.panel.grants.as_ref(), &self.panel.requested, &host.config_path()));
    }

    fn sync_recording(&mut self, host: &dyn Host) {
        let view = self.panel.view(host);
        let wanted = view.microphone.meter.as_deref().filter(|_| self.meter_visible);
        if self.meter.as_ref().map(|(id, _)| id.as_str()) != wanted {
            self.meter.take();
            self.meter_serial += 1;
            let serial = self.meter_serial;
            let events = self.events.clone();
            let generation = self.generation;
            self.meter = wanted.and_then(|id| {
                let meter = super::RecordingMeter::start(id.to_owned(), move |level|
                    events(Event::Presentation {
                        generation,
                        event: Box::new(Event::RecordingLevel { meter: serial, level }),
                    }))?;
                Some((id.to_owned(), meter))
            });
        }
        self.send_state(super::recording_state(view));
    }

    fn send_state(&mut self, message: serde_json::Value) {
        let text = message.to_string();
        if text != self.last_view {
            self.send(&message);
            self.last_view = text;
        }
    }

    fn send(&mut self, message: &serde_json::Value) {
        self.transport.send(message);
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.polling
            .store(false, std::sync::atomic::Ordering::Release);
        self.send(&serde_json::json!({"type": "close"}));
        let transport = std::mem::replace(&mut self.transport, Transport::InProcess(None));
        super::presentation::retire(transport);
    }
}

include!("shortcut/settings_tests.rs");
