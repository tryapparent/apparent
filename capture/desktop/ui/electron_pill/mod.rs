use serde::{Deserialize, Serialize};
mod coordinator;
mod session;
#[cfg(target_os = "linux")]
mod pin;
use crate::capture::desktop::{
    SelectionMode,
    native::pill::PillAction,
};
use anyhow::{Context as _, Result};
use crate::embedded_policy::EmbeddedPolicy;

const SOURCE: &str = include_str!(concat!(env!("OUT_DIR"), "/record-pill.mjs"));

#[derive(Debug, Serialize)]
#[serde(tag = "$")]
pub(crate) enum Event {
    PickerOpened { mode: Mode },
    ModeSelected { mode: Mode },
    CaptureStarted,
    CaptureSealed,
    CaptureSaved { recovery: bool, text: Option<String>, frame_count: usize, duration_ms: u64 },
    CaptureFailed,
    Dismiss,
    SurfaceHidden,
    Hide,
    RevealOpened { activity: u32 },
    RevealClosed,
    PointerChanged { inside: bool },
    ActivityObserved { activity: u32 },
    ShareStarted,
    ShareEnded { renew: bool },
    ConsentChanged { open: bool },
    CompletionText { copy: CompletionCopy, text: Option<String> },
    OnlineObserved,
    Deadline,
}

#[derive(Debug, Serialize)]
pub(crate) enum CompletionCopy {
    Ordinary,
    Offline,
    Uploading,
    UploadStopped,
    ShareReceipt,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub(crate) enum Mode {
    Area,
    Screen,
    Iphone,
    Window,
}

impl From<Mode> for SelectionMode {
    fn from(mode: Mode) -> Self {
        match mode {
            Mode::Area => Self::Area,
            Mode::Screen => Self::Screen,
            Mode::Iphone => Self::Iphone,
            Mode::Window => Self::Window,
        }
    }
}

impl From<SelectionMode> for Mode {
    fn from(mode: SelectionMode) -> Self {
        match mode {
            SelectionMode::Area => Self::Area,
            SelectionMode::Screen => Self::Screen,
            SelectionMode::Iphone => Self::Iphone,
            SelectionMode::Window => Self::Window,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
pub(crate) enum Phase {
    #[default]
    Hidden,
    Selecting,
    Recording,
    Processing,
    Completed,
    Dismissing,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub(crate) phase: Phase,
    pub(crate) mode: Option<Mode>,
    pub(crate) reveal: bool,
    pub(crate) wake_in_ms: Option<u64>,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Facts {
    pub(crate) phone: bool,
    pub(crate) no_words: bool,
    pub(crate) note_count: usize,
    pub(crate) movable: bool,
    pub(crate) paste: bool,
    pub(crate) inspect: bool,
    pub(crate) sharing_enabled: bool,
    pub(crate) sharing_online: bool,
    pub(crate) mic_warning: Option<&'static str>,
    pub(crate) audio_issue: Option<&'static str>,
    pub(crate) microphone_problem: bool,
    pub(crate) audio_problem: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ShareIndicator {
    #[default]
    None,
    Uploading,
    Retry,
    Receipt,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Control {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) enabled: bool,
    pub(crate) selected: bool,
    pub(crate) primary: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Presentation {
    pub(crate) phase: String,
    pub(crate) label: String,
    pub(crate) warning: Option<String>,
    pub(crate) actions: Vec<Control>,
    pub(crate) note_count: usize,
    pub(crate) no_words: bool,
    pub(crate) completed_warning: bool,
    pub(crate) draggable: bool,
    pub(crate) share_indicator: ShareIndicator,
}

impl Default for Presentation {
    fn default() -> Self {
        Self {
            phase: "hidden".into(),
            label: String::new(),
            warning: None,
            actions: Vec::new(),
            note_count: 0,
            no_words: false,
            completed_warning: false,
            draggable: false,
            share_indicator: ShareIndicator::None,
        }
    }
}

pub(crate) struct Adapter {
    pub(crate) policy: Option<PolicySession>,
    pub(crate) epoch: std::time::Instant,
    pub(crate) wake: Option<std::time::Instant>,
    pub(crate) motion_wake: Option<f64>,
    pub(crate) chips: bool,
    pub(crate) pointer_inside: bool,
    pub(crate) activity_count: usize,
    pub(crate) consent_open: bool,
    pub(crate) facts: Option<Facts>,
    pub(crate) presentation: Presentation,
    pub(crate) completed_presentation: Presentation,
    pub(crate) observed_upload_progress: Option<u64>,
}

impl Default for Adapter {
    fn default() -> Self {
        Self {
            policy: None,
            epoch: std::time::Instant::now(),
            wake: None,
            motion_wake: None,
            chips: false,
            pointer_inside: false,
            activity_count: 0,
            consent_open: false,
            facts: None,
            presentation: Presentation::default(),
            completed_presentation: Presentation::default(),
            observed_upload_progress: None,
        }
    }
}

pub(crate) struct PolicySession(EmbeddedPolicy);

impl PolicySession {
    pub(crate) fn open() -> Result<Self> {
        EmbeddedPolicy::open("record-pill", SOURCE, &["dispatchNative", "presentNative"]).map(Self)
    }

    pub(crate) fn dispatch(&self, event: Event, now: u64, animation_now: u64) -> Result<Snapshot> {
        let event = serde_json::to_string(&event)?;
        let output = self.0.call("dispatchNative", (event, now, animation_now))?;
        serde_json::from_str(&output).context("Decode Record pill snapshot")
    }

    pub(crate) fn present(&self, facts: &Facts) -> Result<Presentation> {
        let input = serde_json::to_string(facts)?;
        let output = self.0.call("presentNative", (input,))?;
        serde_json::from_str(&output).context("Decode Record pill presentation")
    }
}

pub use session::Session;

/// Restore an externally hosted control's native window ID after capture reset,
/// or before its first visible frame when the child becomes ready later.
pub(crate) fn restore_capture_exclusion(ids: &mut Vec<u32>, window: Option<u32>, exclude: bool) {
    if exclude && let Some(id) = window.filter(|id| *id > 0) && !ids.contains(&id) {
        ids.push(id);
    }
}

#[cfg(any(test, target_os = "macos"))]
pub(crate) fn capture_exclusion_ready(window: Option<u32>, applied: &[u32], screen_capture: bool) -> bool {
    !screen_capture || window.is_some_and(|id| id > 0 && applied.contains(&id))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct View {
    pub transcript: Option<crate::capture::engine::runtime::audio::transcription::parakeet_stream::Preview>,
    pub revision: u64,
    #[serde(flatten)]
    pub presentation: Presentation,
    pub clock: String,
    pub notice: Option<String>,
    pub reduced_motion: bool,
    pub input_waveform: Option<[f32; 24]>,
}

impl std::ops::Deref for View {
    type Target = Presentation;

    fn deref(&self) -> &Self::Target {
        &self.presentation
    }
}

impl View {
    fn admits_sharing_confirmation(&self, revision: Option<u64>) -> bool {
        self.phase == "completed" && revision == Some(self.revision)
            && self.share_indicator != ShareIndicator::Uploading
            && self.actions.iter().any(|action| action.id == "copy-link" && action.enabled)
    }

    /// Known rejection advances the matching revision so the renderer can recover.
    /// A stale command never consumes a newer capture's revision.
    pub fn consume(&mut self, command: Command, timely: bool) -> Option<PillAction> {
        if command.revision != self.revision {
            return None;
        }
        let action = timely.then(|| self.admit(command)).flatten();
        self.revision += 1;
        self.notice = action
            .is_none()
            .then(|| "Control request expired or changed. Try again.".into());
        action
    }

    /// Admission is checked again against current coordinator state before dispatch.
    #[cfg(target_os = "linux")]
    pub fn drag_point(&self, command: &Command, timely: bool) -> Option<[f32; 2]> {
        if !timely || command.action != "drag" || command.revision != self.revision
            || self.phase != "recording" || !self.draggable { return None; }
        command.target.filter(|point| point.iter().all(|v| v.is_finite()))
    }

    /// Admission is checked again against current coordinator state before dispatch.
    pub fn admit(&self, mut command: Command) -> Option<PillAction> {
        let public = command.action == "copy-public-link";
        if public {
            if self.share_indicator == ShareIndicator::Uploading { return None; }
            command.action = "copy-link".into();
        }
        if command.revision == self.revision && command.action == "settings-labs" && command.target.is_none()
            && matches!(self.phase.as_str(), "processing" | "completed") {
            return Some(PillAction::SettingsAgents);
        }
        if command.revision != self.revision
            || !self
                .actions
                .iter()
                .any(|a| a.id == command.action && a.enabled)
        {
            return None;
        }
        if command.target.is_some() && command.action != "paste" {
            return None;
        }
        if command
            .target
            .is_some_and(|point| !point.iter().all(|v| v.is_finite()))
        {
            return None;
        }
        Some(match command.action.as_str() {
            "record" => PillAction::RecordSelected,
            "cancel" => PillAction::Cancel,
            "finish" => PillAction::Finish,
            "whiteboard" => PillAction::Whiteboard,
            "notes" => PillAction::Notes,
            "paste" => PillAction::Paste(command.target),
            "copy-link" => if public { PillAction::CopyPublicLink } else { PillAction::CopyLink },
            "inspect" => PillAction::Inspect,
            "dismiss" => PillAction::DismissCompleted,
            action if action.starts_with("select-") => {
                PillAction::SelectMode(SelectionMode::from_key(&action[7..])?)
            }
            action if action.starts_with("switch-") => {
                PillAction::SwitchRecording(SelectionMode::from_key(&action[7..])?)
            }
            _ => return None,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub revision: u64,
    pub action: String,
    #[serde(default)]
    pub target: Option<[f32; 2]>,
}

#[cfg(test)]
mod tests;
