//! First-run onboarding: a welcome, one screen on how Apparent works, one screen with every
//! permission it needs, and a first capture. The window is SwiftUI in `apparent-helper onboarding`;
//! this module decides what it shows (`Flow`) and remembers progress in
//! `~/.config/apparent/config.json` (`"onboarding"`, see `Progress`).
//!
//! Screen Recording, Microphone and Accessibility are required and asked for together on the
//! permissions screen, Screen Recording first. Camera (the cabled iPhone) is asked for the first
//! time it's used, in the same window with just that row (`Flow::fix`). On macOS 15, where
//! transcripts come from SFSpeechRecognizer, Speech Recognition is an optional fourth row, so
//! its prompt comes up here rather than after the first capture. Until the required ones
//! are on, ⌥⇧S starts nothing: it brings this window forward once the keys are up (`Gate`).
//!
//! A Screen Recording grant may only reach a running copy of Apparent after it relaunches, and
//! macOS offers "Quit & Reopen" the moment it's granted. Whatever the user picks there, nobody
//! reopens Apparent by hand: when a fresh helper says it's granted but this process still can't
//! capture, the window relaunches Apparent by itself (once, see `Progress::relaunched_at`) and the
//! tour comes back on the same screen. Input Monitoring is never asked for: clicks come from an
//! AppKit mouse monitor that needs no permission, keys from an Accessibility event tap.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

#[path = "onboarding/pipe.rs"]
mod pipe;

pub(crate) use crate::permission_facts::{Grants, Permission, Status};

impl Permission {
    /// What a capture needs, in the order the checklist shows them. Screen Recording comes first
    /// because it's the one that may relaunch Apparent. Accessibility drives the key event tap
    /// (⌘Z, Esc) and ⌥⇧V's paste. Camera is asked for when first used.
    pub const REQUIRED: [Permission; 3] = [
        Permission::ScreenRecording,
        Permission::Microphone,
        Permission::Accessibility,
    ];

    /// The tour's checklist: the required ones, then Speech Recognition where it's asked for.
    #[cfg(test)]
    pub const TOUR: [Permission; 4] = [
        Permission::ScreenRecording,
        Permission::Microphone,
        Permission::Accessibility,
        Permission::SpeechRecognition,
    ];

    pub fn required(self) -> bool {
        Self::REQUIRED.contains(&self) && (self != Self::Microphone || crate::capture::engine::runtime::audio::mic::enabled())
    }

    /// Privacy lists the app can be dragged into: Grant flies the drag panel to System
    /// Settings (`apparent-helper permission-panel`) instead of raising Apple's prompt.
    pub fn draggable(self) -> bool {
        matches!(
            self,
            Permission::ScreenRecording | Permission::Accessibility
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Step {
    Welcome,
    /// A short silent demo on a pretend app: tap ⌥⇧S, talk, hold ⇧ and move to mark, click,
    /// tap ⌥⇧S to finish, paste into the agent. It can be skipped, and a mark can be tried on
    /// it (drawn in the window only, nothing is recorded). See `Tutorial`.
    #[serde(alias = "record", alias = "draw", alias = "finish")]
    HowItWorks,
    /// Every permission on one screen.
    #[serde(
        alias = "screen-recording",
        alias = "microphone",
        alias = "input-monitoring",
        alias = "accessibility",
        alias = "camera"
    )]
    Permissions,
    /// An optional chance to change Record before the first capture.
    Shortcut,
    TryIt,
    /// After the first capture: it's on your clipboard.
    Done,
}

impl Step {
    const TOUR: [Step; 6] = [
        Step::Welcome,
        Step::HowItWorks,
        Step::Permissions,
        Step::Shortcut,
        Step::TryIt,
        Step::Done,
    ];

    fn position(self) -> usize {
        Self::TOUR.iter().position(|s| *s == self).unwrap_or(0)
    }
}

/// What happened with the demo on the how-it-works screen. Later variants win: a demo skipped
/// and then watched after Back is `Watched`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tutorial {
    /// Skip was pressed before the demo had played through.
    Skipped,
    /// The demo played through once: the button reads Continue.
    Watched,
    /// The user drew a mark of their own on the demo.
    Practiced,
}

/// Once everything a fix asks for is on, its window shows the checks this long, then closes.
pub const AUTO_ADVANCE_MS: u64 = 800;

/// Screen Recording's check shows this long before Apparent relaunches to use it.
pub const RELAUNCH_AFTER_MS: u64 = 1_000;

/// After relaunching itself, Apparent doesn't do it again by itself for this long; the row offers
/// Reopen instead. Stops a loop if a fresh copy still can't capture.
pub const RELAUNCH_GUARD_MS: u64 = 120_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// The whole tour, first launch or "Welcome to Apparent…".
    Tour,
    /// Just the permissions screen, for permissions that are missing now: required ones that
    /// went away or that ⌥⇧S found off, or Accessibility or Camera on first use. Closes once
    /// they're on.
    Fix,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Input {
    /// The primary button.
    Continue,
    Back,
    /// "Set up later" / "Not now".
    Later,
    /// A permission row's button.
    Grant(Permission),
    ChangeShortcut,
    /// A shortcut was explicitly chosen and successfully saved, or accepted from the desktop.
    ShortcutChosen,
    /// A trial press began; confirmation waits for the normal key-release path.
    ShortcutTrialStarted,
    SkipShortcutTrial,
    /// The global shortcut requested a capture (not the menu or a timed CLI recording).
    ShortcutTriggered,
    /// The window was closed.
    Closed,
    /// "Open Settings" on the last screen.
    Settings,
    /// "Skip" under the demo, before it has played through: goes on like Continue.
    Skip,
    /// The demo played through once.
    Watched,
    /// The user drew a mark on the demo.
    Practiced,
    Grants {
        grants: Grants,
        now_ms: u64,
    },
    /// ⌥⇧S was pressed while a required permission is off.
    CaptureSelecting,
    CaptureStarted,
    CaptureEnded {
        completed: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Effect {
    None,
    /// Ask macOS (the system prompt), the first time a row's button is pressed.
    Request(Permission),
    /// Already asked or denied: open its System Settings pane.
    OpenSettings(Permission),
    /// Relaunch Apparent so Screen Recording works. The tour comes back at `resume`; a fix (no
    /// `resume`) opens again.
    Relaunch {
        resume: Option<Step>,
    },
    Hide,
    Show,
    Close,
    Defer,
    /// Close the tour and open the Settings window.
    Settings,
    /// Open the existing recorder without dismissing the tour.
    EditShortcut,
    /// Screen Recording works: list the screen's content once now, so macOS's "bypass the
    /// system private window picker" question comes up here, explained, rather than over the
    /// first recording.
    ConfirmScreen,
}

/// One row on the permissions screen.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub permission: Permission,
    pub status: Status,
    /// The button was pressed once already: it now opens System Settings.
    pub requested: bool,
    pub required: bool,
    /// Granted, and Apparent is about to relaunch by itself to use it.
    pub reopening: bool,
    /// Granted, but this copy can't use it and won't relaunch by itself again: the row's
    /// button reopens Apparent.
    pub relaunch: bool,
}

/// What the window shows, sent to the helper as JSON.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub step: Step,
    /// Position among the steps still to be shown, for the page dots.
    pub index: usize,
    pub count: usize,
    pub rows: Vec<Row>,
    /// Everything the permissions screen needs works: Continue is enabled.
    pub ready: bool,
    pub fix: bool,
    /// The demo's outcome so far; until it's `Watched` the button under it reads Skip.
    pub tutorial: Option<Tutorial>,
    /// macOS may be asking about its private window picker: say to choose Allow.
    pub picker_note: bool,
    /// Show the inline Record recorder, not a second Settings window.
    pub shortcut_editing: bool,
    pub first_capture_required: bool,
    pub shortcut_chosen: bool,
    pub shortcut_tested: bool,
}

#[derive(Clone, Debug)]
pub struct Flow {
    mode: Mode,
    step: Step,
    grants: Option<Grants>,
    /// The rows on the permissions screen.
    asks: Vec<Permission>,
    requested: BTreeSet<Permission>,
    ready_at: Option<u64>,
    hidden: bool,
    /// May relaunch by itself once Screen Recording is granted (off right after a relaunch).
    auto_relaunch: bool,
    /// When a Screen Recording grant this copy can't use was first seen.
    stale_since: Option<u64>,
    /// A relaunch was asked for; never twice from one window.
    relaunching: bool,
    tutorial: Option<Tutorial>,
    /// The step `Effect::ConfirmScreen` was given on (once per window).
    screen_confirmed: Option<Step>,
    shortcut_editing: bool,
    first_capture_required: bool,
    shortcut_chosen: bool,
    shortcut_tested: bool,
    first_capture_completed: bool,
    shortcut_pending: bool,
    practice_recording: bool,
}

/// The recording shortcut stays in setup until the user reaches guided practice.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShortcutPolicy { Record, Block, Trial }

impl Flow {
    pub(crate) fn shortcut_policy(&self) -> ShortcutPolicy {
        if self.mode != Mode::Tour || !self.first_capture_required || self.step.position() >= Step::TryIt.position() {
            ShortcutPolicy::Record
        } else if self.step == Step::Shortcut && self.shortcut_chosen && !self.shortcut_editing {
            ShortcutPolicy::Trial
        } else if self.shortcut_editing {
            ShortcutPolicy::Block
        } else {
            ShortcutPolicy::Record
        }
    }
    /// Opt into the first-capture onboarding experiment, restoring durable milestones.
    pub fn with_first_capture(mut self, required: bool, chosen: bool, tested: bool, completed: bool) -> Self {
        self.first_capture_required = required && self.mode == Mode::Tour;
        self.shortcut_chosen = chosen;
        self.shortcut_tested = chosen && (tested || completed);
        self.first_capture_completed = completed;
        self.step = traversal::resume_capture(self.step, self.first_capture_required, completed);
        self
    }
    /// The tour from `start`. Walking forward passes the permissions screen when everything on
    /// it works, and a later step never shows before it's done. A tour resumed on the
    /// permissions screen (after a relaunch) stays there, so the window comes back where it was.
    #[cfg(test)]
    pub fn tour(start: Step, grants: Option<Grants>) -> Self {
        let mut flow = Self::new(Mode::Tour, start, Permission::TOUR.to_vec(), grants);
        flow.step = if start.position() > Step::Permissions.position()
            && flow.grants.is_some()
            && !flow.done()
        {
            Step::Permissions
        } else if start == Step::Permissions {
            start
        } else {
            traversal::enter(start, flow.done())
        };
        flow
    }

    pub fn coaching(start: Step, grants: Option<Grants>) -> Self {
        let mut flow = Self::new(Mode::Tour, start, Vec::new(), grants);
        flow.step = traversal::enter(start, flow.done());
        flow
    }

    /// The permissions screen with just `asks`.
    pub fn fix(asks: Vec<Permission>, grants: Option<Grants>) -> Self {
        Self::new(Mode::Fix, Step::Permissions, asks, grants)
    }

    fn new(mode: Mode, step: Step, asks: Vec<Permission>, grants: Option<Grants>) -> Self {
        Self {
            mode,
            step,
            grants,
            asks,
            requested: BTreeSet::new(),
            ready_at: None,
            hidden: false,
            auto_relaunch: true,
            stale_since: None,
            relaunching: false,
            tutorial: None,
            screen_confirmed: None,
            shortcut_editing: false,
            first_capture_required: false,
            shortcut_chosen: false,
            shortcut_tested: false,
            first_capture_completed: false,
            shortcut_pending: false,
            practice_recording: false,
        }
    }

    /// Whether this window may relaunch Apparent by itself (`relaunch_allowed`).
    pub fn with_auto_relaunch(mut self, allowed: bool) -> Self {
        self.auto_relaunch = allowed;
        self
    }

    /// The demo's outcome from an earlier launch (`Progress::tutorial`).
    pub fn with_tutorial(mut self, tutorial: Option<Tutorial>) -> Self {
        self.tutorial = tutorial;
        self
    }

    pub(crate) fn local_practice(&self) -> bool {
        self.practice_recording || self.shortcut_pending
    }

    pub fn tutorial(&self) -> Option<Tutorial> {
        self.tutorial
    }

    /// Records `outcome` unless something later already happened.
    fn note_tutorial(&mut self, outcome: Tutorial) {
        self.tutorial = self.tutorial.max(Some(outcome));
    }

    pub fn step(&self) -> Step {
        self.step
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// Where a tour picks up if Apparent quits now (macOS's own "Quit & Reopen" included).
    pub fn resume_point(&self) -> Option<Step> {
        (self.mode == Mode::Tour && self.step != Step::Done).then_some(self.step)
    }

    pub fn on(&mut self, input: Input) -> Effect {
        match input {
            Input::ShortcutChosen => {
                if self.mode == Mode::Tour && self.step == Step::Shortcut {
                    self.shortcut_chosen = true;
                    self.shortcut_tested = false;
                    self.shortcut_editing = false;
                }
                Effect::None
            }
            Input::ShortcutTrialStarted => {
                if self.shortcut_policy() == ShortcutPolicy::Trial {
                    self.shortcut_tested = false;
                }
                Effect::None
            }
            Input::SkipShortcutTrial if self.mode == Mode::Tour && self.step == Step::Shortcut
                && !self.shortcut_editing => self.advance(),
            Input::SkipShortcutTrial => Effect::None,
            Input::ShortcutTriggered => {
                if self.shortcut_policy() == ShortcutPolicy::Trial {
                    self.shortcut_tested = true;
                }
                self.shortcut_pending = self.step == Step::TryIt;
                Effect::None
            }
            Input::Continue => self.primary(),
            Input::Back => {
                self.step = traversal::back(self.step, self.mode == Mode::Fix, self.done());
                self.shortcut_editing = false;
                Effect::None
            }
            Input::Later | Input::Closed if self.mode == Mode::Tour => Effect::Defer,
            Input::Later | Input::Closed => Effect::Close,
            Input::Settings if self.step == Step::Done => Effect::Settings,
            Input::Settings => Effect::None,
            Input::ChangeShortcut if self.mode == Mode::Tour && self.step == Step::Shortcut => {
                self.shortcut_editing = true;
                Effect::EditShortcut
            }
            Input::ChangeShortcut => Effect::None,
            Input::Skip | Input::Watched | Input::Practiced
                if self.step != Step::HowItWorks || self.mode == Mode::Fix =>
            {
                Effect::None
            }
            Input::Skip => {
                self.note_tutorial(Tutorial::Skipped);
                self.advance()
            }
            Input::Watched => {
                self.note_tutorial(Tutorial::Watched);
                Effect::None
            }
            Input::Practiced => {
                self.note_tutorial(Tutorial::Practiced);
                Effect::None
            }
            Input::Grant(permission) => self.grant(permission),
            Input::Grants { grants, now_ms } => {
                self.grants = Some(grants);
                self.tick(now_ms)
            }
            Input::CaptureSelecting => Effect::None,
            Input::CaptureStarted if !self.hidden => {
                self.practice_recording = std::mem::take(&mut self.shortcut_pending);
                self.hidden = true;
                Effect::Hide
            }
            Input::CaptureStarted => Effect::None,
            Input::CaptureEnded { completed } => {
                if completed && self.step == Step::TryIt
                    && (!self.first_capture_required || self.practice_recording)
                {
                    self.first_capture_completed = true;
                    self.step = Step::Done;
                }
                self.shortcut_pending = false;
                self.practice_recording = false;
                if std::mem::take(&mut self.hidden) {
                    Effect::Show
                } else {
                    Effect::None
                }
            }
        }
    }

    pub fn view(&self) -> View {
        let ready = self.done();
        let shown: Vec<Step> = Step::TOUR
            .into_iter()
            .filter(|s| *s != Step::Done)
            .filter(|s| *s == self.step || traversal::visible(*s, ready))
            .collect();
        View {
            step: self.step,
            index: shown.iter().position(|s| *s == self.step).unwrap_or(0),
            count: shown.len(),
            rows: self
                .shown()
                .map(|permission| {
                    let stale = permission == Permission::ScreenRecording && self.screen_relaunch();
                    Row {
                        permission,
                        status: self.status(permission),
                        requested: self.requested.contains(&permission),
                        required: permission.required(),
                        reopening: stale && self.auto_relaunch,
                        relaunch: stale && !self.auto_relaunch,
                    }
                })
                .collect(),
            ready,
            fix: self.mode == Mode::Fix,
            tutorial: self.tutorial,
            picker_note: self.screen_confirmed == Some(self.step),
            shortcut_editing: self.step == Step::Shortcut && self.shortcut_editing,
            first_capture_required: self.first_capture_required,
            shortcut_chosen: self.shortcut_chosen,
            shortcut_tested: self.shortcut_tested,
        }
    }

    fn status(&self, permission: Permission) -> Status {
        self.grants
            .as_ref()
            .map_or(Status::NotDetermined, |g| g.status(permission))
    }

    fn granted(&self, permission: Permission) -> bool {
        self.status(permission) == Status::Granted
    }

    fn usable(&self, permission: Permission) -> bool {
        self.grants.as_ref().is_some_and(|g| g.usable(permission))
    }

    /// The rows this Mac asks for.
    fn shown(&self) -> impl Iterator<Item = Permission> + '_ {
        self.asks
            .iter()
            .copied()
            .filter(|p| p.asked(self.grants.as_ref()))
    }

    /// What must be granted before Continue: a tour's required rows, every row of a fix.
    fn needed(&self) -> impl Iterator<Item = Permission> + '_ {
        self.shown()
            .filter(|p| self.mode == Mode::Fix || p.required())
    }

    /// Screen Recording is on the screen and granted, but this copy of Apparent can't capture yet.
    fn screen_relaunch(&self) -> bool {
        self.asks.contains(&Permission::ScreenRecording)
            && self.granted(Permission::ScreenRecording)
            && self
                .grants
                .as_ref()
                .is_some_and(|g| g.screen_needs_relaunch)
    }

    /// Everything needed is granted and usable in this process.
    fn done(&self) -> bool {
        self.needed().all(|p| self.usable(p))
    }

    fn advance(&mut self) -> Effect {
        self.ready_at = None;
        self.shortcut_editing = false;
        match traversal::advance(self.step, self.mode == Mode::Fix, self.done()) {
            Some(step) => {
                self.step = step;
                Effect::None
            }
            None => Effect::Close,
        }
    }

    fn primary(&mut self) -> Effect {
        match traversal::primary(
            self.step,
            self.done(),
            self.first_capture_required,
            self.shortcut_chosen,
            self.shortcut_tested,
            self.shortcut_editing,
        ) {
            traversal::Primary::Stay => Effect::None,
            traversal::Primary::Close => Effect::Close,
            traversal::Primary::Advance => self.advance(),
        }
    }

    fn grant(&mut self, permission: Permission) -> Effect {
        if self.step != Step::Permissions || !self.asks.contains(&permission)
            || self.status(permission) == Status::Unavailable
        {
            return Effect::None;
        }
        // The fallback after a relaunch that didn't take: the row's button is Reopen.
        if permission == Permission::ScreenRecording && self.screen_relaunch() {
            return if self.auto_relaunch {
                Effect::None
            } else {
                self.relaunch()
            };
        }
        if self.granted(permission) {
            return Effect::None;
        }
        if self.requested.insert(permission)
            && self.status(permission) != Status::Denied
            && !permission.draggable()
        {
            Effect::Request(permission)
        } else {
            Effect::OpenSettings(permission)
        }
    }

    /// Relaunch so Screen Recording works, coming back to this same screen. Once per window.
    fn relaunch(&mut self) -> Effect {
        if self.relaunching || self.step != Step::Permissions || !self.screen_relaunch() {
            return Effect::None;
        }
        self.relaunching = true;
        let resume = match self.mode {
            Mode::Tour => Some(Step::Permissions),
            Mode::Fix => None,
        };
        Effect::Relaunch { resume }
    }

    /// A Screen Recording grant this copy can't use relaunches Apparent a moment after its check
    /// shows, whatever was picked in macOS's "Quit & Reopen" sheet. Otherwise a fix closes by
    /// itself once everything it asked for works; the tour waits for Continue.
    fn tick(&mut self, now_ms: u64) -> Effect {
        if self.step == Step::Permissions && self.screen_relaunch() {
            self.ready_at = None;
            if !self.auto_relaunch {
                return Effect::None;
            }
            let since = *self.stale_since.get_or_insert(now_ms);
            return if now_ms.saturating_sub(since) >= RELAUNCH_AFTER_MS {
                self.relaunch()
            } else {
                Effect::None
            };
        }
        self.stale_since = None;
        if matches!(self.step, Step::Permissions | Step::TryIt)
            && self.screen_confirmed.is_none()
            && self.asks.contains(&Permission::ScreenRecording)
            && self.usable(Permission::ScreenRecording)
        {
            self.screen_confirmed = Some(self.step);
            return Effect::ConfirmScreen;
        }
        if self.mode != Mode::Fix || !self.done() {
            self.ready_at = None;
            return Effect::None;
        }
        let since = *self.ready_at.get_or_insert(now_ms);
        if now_ms.saturating_sub(since) >= AUTO_ADVANCE_MS {
            self.advance()
        } else {
            Effect::None
        }
    }
}

/// Holds a request to show the permissions window until the shortcut's modifiers are up, so
/// nothing appears while ⌥⇧ is still down and every button is clickable when it does.
#[derive(Debug, Default)]
pub struct Gate {
    pending: Option<Vec<Permission>>,
}

impl Gate {
    /// ⌥⇧S went down with nothing recording. Returns whether it may go on; with `missing`
    /// permissions it starts nothing and the window waits for the keys to come up.
    pub fn press(&mut self, missing: Vec<Permission>) -> bool {
        if self.pending.is_some() {
            return false;
        }
        if missing.is_empty() {
            return true;
        }
        self.pending = Some(missing);
        false
    }

    /// Show the window for `asks` once the modifiers are up.
    pub fn defer(&mut self, asks: Vec<Permission>) {
        self.pending = Some(asks);
    }

    pub fn is_pending(&self) -> bool {
        self.pending.is_some()
    }

    /// Polled while pending: the permissions to show, once no modifier is held.
    pub fn tick(&mut self, modifiers_down: bool) -> Option<Vec<Permission>> {
        if modifiers_down {
            None
        } else {
            self.pending.take()
        }
    }
}

/// Onboarding progress, under `"onboarding"` in `~/.config/apparent/config.json`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// Version of the setup journey whose resume point this belongs to.
    #[serde(default)]
    pub tour_revision: u32,
    /// The tour finished (or was dismissed in the legacy flow); it won't open by itself again.
    #[serde(default)]
    pub seen: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deferred: bool,
    /// Where the tour picks up at the next launch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume: Option<Step>,
    /// Every permission seen granted, so a later loss reopens the permissions screen.
    #[serde(default)]
    pub granted: BTreeSet<Permission>,
    /// When Apparent last relaunched itself for Screen Recording (Unix ms), so it never does it
    /// twice in a row (`relaunch_allowed`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relaunched_at: Option<u64>,
    /// A permissions fix was open when Apparent relaunched itself; it opens again at launch.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reopen_fix: bool,
    /// The how-it-works demo was skipped, watched or drawn on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tutorial: Option<Tutorial>,
    /// Explicitly saved Record shortcut (or accepted desktop-owned shortcut) in the tour.
    #[serde(default)]
    pub shortcut_chosen: bool,
    /// Effective Record combination whose real press-and-release passed the trial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut_tested_for: Option<String>,
    /// A shortcut-started practice recording produced a completed local capture.
    #[serde(default)]
    pub first_capture_completed: bool,
}

impl Progress {
    fn tested_shortcut(&self, label: &str) -> bool {
        self.shortcut_chosen && self.shortcut_tested_for.as_deref() == Some(label)
    }
    /// Old unfinished tours restart once at Welcome. Permission relaunches within
    /// this revision continue where they left off; completed users are not re-enrolled.
    pub fn prepare_current_tour(&mut self) -> bool {
        const CURRENT_TOUR: u32 = 1;
        // Earlier previews tied setup completion to every guided-capture lesson.
        // A saved successful shortcut trial already completed setup; do not
        // re-enrol that user merely because they closed the optional coaching.
        if self.tour_revision <= CURRENT_TOUR && !self.seen && !self.deferred
            && matches!(self.resume, Some(Step::Shortcut | Step::TryIt))
            && self.shortcut_chosen && self.shortcut_tested_for.is_some()
        {
            self.seen = true;
            self.resume = None;
            self.tour_revision = CURRENT_TOUR;
            return true;
        }
        if self.tour_revision >= CURRENT_TOUR { return false; }
        self.tour_revision = CURRENT_TOUR;
        if !self.seen && !self.deferred {
            self.resume = Some(Step::Welcome);
            self.tutorial = None;
            self.shortcut_chosen = false;
            self.shortcut_tested_for = None;
            self.first_capture_completed = false;
        }
        true
    }

    /// Start the Settings replay from the beginning while retaining permission history,
    /// relaunch throttling and the user's actual shortcut/pen/configuration choices.
    pub fn reset_for_replay(&mut self) {
        self.deferred = true;
        self.resume = Some(Step::Welcome);
        self.tutorial = None;
        self.shortcut_chosen = false;
        self.shortcut_tested_for = None;
        self.first_capture_completed = false;
    }

    /// Shortcut setup and the guided capture lesson have separate completion.
    pub fn leave(&mut self, flow: &Flow) {
        if flow.mode == Mode::Fix {
            return;
        }
        if flow.step == Step::Done {
            self.seen = true;
            self.resume = None;
        } else {
            self.resume = flow.resume_point();
        }
    }

    pub fn dismiss(&mut self, flow: &Flow) {
        self.leave(flow);
        self.deferred = true;
    }

    pub(crate) fn recording_started() {
        let mut progress = Self::load();
        if !progress.seen {
            progress.seen = true;
            progress.save();
        }
    }
    pub fn load() -> Self {
        Self::load_from(&crate::shared::handoff::default_config_path())
    }

    pub fn load_from(path: &Path) -> Self {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|config| config.get("onboarding").cloned())
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) {
        let _ = self.save_to(&crate::shared::handoff::default_config_path());
    }

    /// Replace only this schema's leaves through the shared durable writer.
    /// Future onboarding fields and unrelated config retain their exact values.
    pub fn save_to(&self, path: &Path) -> anyhow::Result<()> {
        const KEYS: [&str; 11] = ["tourRevision", "seen", "deferred", "resume", "granted", "relaunchedAt",
            "reopenFix", "tutorial", "shortcutChosen", "shortcutTestedFor", "firstCaptureCompleted"];
        let value = serde_json::to_value(self)?;
        crate::shared::handoff::update_config_in(path, |config| {
            let root = config.as_object_mut().ok_or_else(|| anyhow::anyhow!("Invalid config"))?;
            let progress = root.entry("onboarding").or_insert_with(|| serde_json::json!({}));
            let target = progress.as_object_mut().ok_or_else(|| anyhow::anyhow!("Invalid onboarding progress"))?;
            for key in KEYS {
                match value.get(key) {
                    Some(value) => { target.insert(key.into(), value.clone()); }
                    None => { target.remove(key); }
                }
            }
            Ok(())
        })
    }

    /// Remembers what's granted now; returns whether anything new was.
    pub fn note(&mut self, grants: &Grants) -> bool {
        let before = self.granted.len();
        self.granted.extend(
            grants
                .statuses
                .iter()
                .filter(|(_, status)| **status == Status::Granted)
                .map(|(permission, _)| *permission),
        );
        self.granted.len() != before
    }

    /// Notes a relaunch Apparent is about to do by itself, so the next launch comes back to the
    /// same window: the tour at `resume`, or the fix.
    pub fn relaunching(&mut self, resume: Option<Step>, now_ms: u64) {
        self.relaunched_at = Some(now_ms);
        match resume {
            Some(step) => {
                self.resume = Some(step);
            }
            None => self.reopen_fix = true,
        }
    }
}

/// Whether Apparent may relaunch itself now: not within `RELAUNCH_GUARD_MS` of the last time.
pub fn relaunch_allowed(progress: &Progress, now_ms: u64) -> bool {
    progress
        .relaunched_at
        .is_none_or(|at| now_ms.saturating_sub(at) >= RELAUNCH_GUARD_MS)
}

pub fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn note_grants(grants: &Grants) {
    let mut progress = Progress::load();
    if progress.note(grants) {
        progress.save();
    }
}

pub(crate) fn prepare_launch(grants: &Grants, missing: &[Permission]) -> Option<Flow> {
    let mut progress = Progress::load();
    let changed = progress.note(grants) | progress.prepare_current_tour();
    let plan = launch_plan(&progress, grants, crate::shared::handoff::experiment("onboardingFirstCapture"), missing);
    if std::mem::take(&mut progress.reopen_fix) || changed {
        progress.save();
    }
    plan
}

enum Launch { Quiet, Tour, Repair }

include!(concat!(env!("OUT_DIR"), "/onboarding_entry_policy.rs"));

pub fn launch_plan(progress: &Progress, grants: &Grants, offer_tour: bool, missing: &[Permission]) -> Option<Flow> {
    match launch_intent(progress.seen, progress.deferred, progress.reopen_fix, offer_tour) {
        Launch::Quiet => None,
        Launch::Tour => Some(Flow::coaching(progress.resume.unwrap_or(Step::Welcome), Some(grants.clone()))),
        Launch::Repair => {
            let mut asks = missing.to_vec();
            if !asks.contains(&Permission::ScreenRecording) {
                asks.insert(0, Permission::ScreenRecording);
            }
            Some(Flow::fix(asks, Some(grants.clone())))
        }
    }
}

#[derive(Clone, Debug)]
pub enum Event {
    Board(serde_json::Value),
    Practice(serde_json::Value),
    /// Grants read at launch, to decide whether onboarding opens (`launch_plan`).
    Launch(Grants),
    Grants(Grants),
    /// A button: `continue`, `back`, `later`, `close`, `settings` or `grant:<permission>`.
    Action(String),
    /// The inline recorder uses the same actions and validation as Settings.
    Shortcut(crate::capture::desktop::settings::Action),
    Exited,
    /// Reader callbacks belong to the session that created their transport.
    Session { source: u64, event: Box<Event> },
    /// A fallback replaces a transport inside the same Session.
    Transport { generation: u64, event: Box<Event> },
}

impl Event {
    pub fn for_current_transport(self, active: Option<u64>) -> Option<Self> {
        match self {
            Self::Transport { generation, event } if Some(generation) == active => match *event {
                Self::Transport { .. } | Self::Session { .. } => None,
                event => Some(event),
            },
            Self::Transport { .. } => None,
            event => Some(event),
        }
    }
    pub fn for_current_session(self, active: Option<u64>) -> Option<Self> {
        match self {
            Self::Session { source, event } if Some(source) == active => match *event {
                Self::Session { .. } => None,
                event => Some(event),
            },
            Self::Session { .. } => None,
            event => Some(event), // App-wide launch and OS grant notifications.
        }
    }
}

fn next_session_source() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// What draws the welcome window: the SwiftUI `apparent-helper onboarding` process on macOS, an
/// in-process GPUI window (`crate::onboarding_window`) on Windows. Both take the same JSON
/// messages and report the same button actions.
enum Transport {
    Renderer {
        child: crate::capture::ui_process::UiChild,
        input: pipe::Input,
    },
    Helper {
        child: crate::capture::ui_process::UiChild,
        stdin: Option<std::process::ChildStdin>,
    },
    InProcess(Option<flume::Sender<serde_json::Value>>),
}

pub struct Session {
    source: u64,
    transport_generation: u64,
    flow: Flow,
    fallback: Option<Box<dyn Fn(u64) -> anyhow::Result<Transport>>>,
    fallback_pending: bool,
    transport: Transport,
    permission_adapter: Option<Transport>,
    polling: std::sync::Arc<std::sync::atomic::AtomicBool>,
    last_view: String,
    shortcut_label: String,
    shortcut_state: Option<serde_json::Value>,
    shortcut_choice_down: bool,
    saved_resume: Option<Step>,
    saved_tutorial: Option<Tutorial>,
    saved_shortcut_chosen: bool,
    saved_shortcut_tested_for: Option<String>,
    saved_first_capture_completed: bool,
    clock: std::time::Instant,
    practice: Option<super::practice::Practice>,
    anchor: Option<[f32;4]>,
    practice_board: Option<[f32;4]>,
    board_view: Option<serde_json::Value>,
    practice_completed: bool,
    practice_bundle: Option<std::path::PathBuf>,
    practice_receipt: Option<(u64, String, Option<String>)>,
    editor: Option<crate::capture::desktop::settings::ShortcutView>,
    pen_picker: bool,
    pen_selected: bool,
    pen_error: bool,
    pen_save_id: Option<String>,
}

include!("onboarding/session.rs");

#[cfg(any(target_os = "macos", test))]
fn permission_guide_messages(view: &View) -> Vec<serde_json::Value> {
    if view.step != Step::Permissions {
        return vec![serde_json::json!({"type":"cancel-guides"})];
    }
    view.rows.iter().filter(|row|row.status==Status::Granted)
        .map(|row|serde_json::json!({"type":"close-guide","permission":row.permission})).collect()
}

#[cfg(target_os="linux")]
fn native_shortcut_press() -> Option<crate::capture::desktop::settings::Pressed> {
    use crate::capture::desktop::linux::x11;
    use crate::capture::engine::runtime::{CARBON_CMD_KEY, CARBON_SHIFT_KEY, CARBON_CONTROL_KEY, CARBON_OPTION_KEY};
    let keys = x11::keys_down()?;
    let copilot=x11::key_is_down(&keys,201)&&matches!(x11::keysym_at(201),Some(0xffd4|0x10081247));
    let wakeup=x11::keycodes_for(0x1008ff2b).into_iter().any(|code|x11::key_is_down(&keys,code));
    if copilot==wakeup { return None; } // Neither, or ambiguous simultaneous keys.
    let m = x11::pointer_state()?;
    let modifiers = [(m.super_key, CARBON_CMD_KEY), (m.shift, CARBON_SHIFT_KEY),
        (m.ctrl, CARBON_CONTROL_KEY), (m.alt, CARBON_OPTION_KEY)]
        .into_iter().filter(|(held, _)| *held).fold(0, |bits, (_, bit)| bits | bit);
    Some(crate::capture::desktop::settings::Pressed {
        key_code:if copilot {201}else{95}, modifiers,
        key:if copilot {"Copilot"}else{"Fn"}.into(), reserved:false,
    })
}

fn read_protocol_line(reader: &mut impl std::io::BufRead, line: &mut Vec<u8>) -> std::io::Result<usize> {
    use std::io::BufRead;
    std::io::Read::take(reader, 65_537).read_until(b'\n', line)
}

fn retire_transport(transport: Transport) {
    let child = match transport {
        Transport::Helper { child, stdin } => { drop(stdin); Some(child) }
        Transport::Renderer { child, input } => { drop(input); Some(child) }
        Transport::InProcess(_) => None,
    };
    if let Some(mut child) = child {
        std::thread::spawn(move || {
            for _ in 0..20 {
                if !matches!(child.try_wait(), Ok(None)) { return; }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        });
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.polling
            .store(false, std::sync::atomic::Ordering::Release);
        if let Some(adapter) = self.permission_adapter.take() { retire_transport(adapter); }
        self.send(&serde_json::json!({"type": "close"}));
        let transport = std::mem::replace(&mut self.transport, Transport::InProcess(None));
        retire_transport(transport);
    }
}

/// Starts Apparent again once this copy has quit: the new copy waits for this one
/// (`win::shell::wait_for_relauncher`) before it starts the app.
#[cfg(windows)]
pub fn relaunch() {
    use std::os::windows::process::CommandExt;
    /// No console window flashes up for the new copy (`apparent.exe` is a console program).
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let _ = std::process::Command::new(exe)
        .args(std::env::args_os().skip(1))
        .env(crate::capture::engine::runtime::platform::legacy_windows::platform::shell::RELAUNCHED_BY, std::process::id().to_string())
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

#[cfg(not(windows))]
/// Waits (at most 10 s) for process `$1` to exit, then runs the rest.
const AFTER_EXIT: &str = "pid=$1; shift; i=0; \
    while kill -0 \"$pid\" 2>/dev/null && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done; ";

/// Starts Apparent again once this copy has quit (after a Screen Recording grant). The app is
/// opened without `-n`: if macOS's own "Quit & Reopen" already started a new copy, `open` only
/// brings that one forward, so there are never two.
#[cfg(not(windows))]
pub fn relaunch() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let bundle = exe
        .ancestors()
        .find(|p| p.extension().is_some_and(|ext| ext == "app"));
    let pid = std::process::id().to_string();
    let mut command = std::process::Command::new("/bin/sh");
    match bundle {
        Some(app) => command
            .arg("-c")
            .arg(format!("{AFTER_EXIT}exec /usr/bin/open \"$1\""))
            .args(["apparent-relaunch", &pid])
            .arg(app),
        None => command
            .arg("-c")
            .arg(format!("{AFTER_EXIT}exec \"$@\""))
            .args(["apparent-relaunch", &pid])
            .arg(&exe)
            .args(std::env::args_os().skip(1)),
    };
    let _ = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

include!("onboarding/tests.rs");

/// Runs on the transport reader, never on the GUI thread. Missing native evidence rejects.
#[cfg(target_os = "macos")]
fn native_shortcut_reserved(key: u32, modifiers: u32) -> bool {
    use std::{process::Command, time::Duration};
    // Fn is observed without suppressing it; any macOS Fn/Globe action remains active too.
    if matches!(key, crate::capture::engine::runtime::MACOS_FN_KEY_CODE | 58 | 61) && modifiers == 0 { return false; }
    if key > 127 || modifiers & !0x1b00 != 0 { return true; }
    let Ok(path) = crate::capture::desktop::helper::path() else { return true; };
    let mut command = Command::new(path);
    command.args(["onboarding", "--validate-shortcut", &key.to_string(), &modifiers.to_string()]);
    query_shortcut_reservation(&mut command, Duration::from_secs(2))
}

#[cfg(any(target_os = "macos", test))]
fn query_shortcut_reservation(command: &mut std::process::Command, timeout: std::time::Duration) -> bool {
    use std::{io::Read, process::Stdio, time::{Duration, Instant}};
    let Ok(mut child) = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else { return true; };
    let stdout = child.stdout.take();
    let mut child = crate::capture::ui_process::UiChild::new(child);
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => { let _ = child.kill(); let _ = child.wait(); return true; }
        }
    }
    let mut bytes = Vec::new();
    let Some(stdout) = stdout else { return true; };
    if stdout.take(33).read_to_end(&mut bytes).is_err() { return true; }
    shortcut_reservation_projection(&bytes)
}

#[cfg(any(target_os = "macos", test))]
fn shortcut_reservation_projection(bytes: &[u8]) -> bool {
    if bytes.len() > 32 { return true; }
    serde_json::from_slice::<bool>(bytes).unwrap_or(true)
}

#[test]
fn shortcut_native_projection_fails_closed() {
    assert!(!shortcut_reservation_projection(b"false\n"));
    for bytes in [b"true".as_slice(), b"", b"null", b"{}", b"false true", b"{\"reserved\":false}"] {
        assert!(shortcut_reservation_projection(bytes));
    }
}

#[test]
fn shortcut_selection_waits_for_release_with_either_platforms_modifier_bits() {
    // Carbon (Linux) and CGEventFlags (macOS), including every individual modifier.
    for flags in [0x100, 0x200, 0x800, 0x1000, 1 << 17, 1 << 18, 1 << 19, 1 << 20] {
        let mut session = Session::for_test(
            Flow::tour(Step::Shortcut, None).with_first_capture(true, false, false, false),
        );
        session.input(Input::ShortcutChosen);
        session.observe_shortcut_modifiers(flags);
        assert_eq!(session.shortcut_policy(), ShortcutPolicy::Block,
            "held modifier {flags:#x} must not admit the trial");
        session.observe_shortcut_modifiers(0);
        assert_eq!(session.shortcut_policy(), ShortcutPolicy::Trial);
        session.input(Input::ShortcutTrialStarted);
        assert!(!session.flow.view().shortcut_tested);
        session.input(Input::ShortcutTriggered);
        assert!(session.flow.view().shortcut_tested);
    }
}

#[cfg(all(test, unix))]
#[test]
fn shortcut_native_process_failures_reject_without_accepting_renderer_claims() {
    use std::{process::Command, time::Duration};
    let query = |script: &str| {
        let mut command = Command::new("sh");
        command.args(["-c", script]);
        query_shortcut_reservation(&mut command, Duration::from_millis(100))
    };
    assert!(!query("printf false"));
    assert!(query("printf true"));
    assert!(query("printf false; exit 1"));
    assert!(query("printf invalid"));
    assert!(query("exec sleep 2"));
    assert!(query_shortcut_reservation(&mut Command::new("/nonexistent/apparent-test-helper"), Duration::from_millis(100)));
}

#[test]
fn electron_choice_receipt_is_bound_to_the_released_native_selection() {
    let mut session=Session::for_test(Flow::tour(Step::Shortcut,None).with_first_capture(true,true,false,false));
    session.shortcut_label="Fn".into();
    session.practice=Some(super::practice::Practice::default());
    let (sender,_receiver)=flume::unbounded();
    session.fallback=Some(Box::new(move |_|Ok(Transport::InProcess(Some(sender.clone())))));
    session.shortcut_choice_down=true;
    session.action("accept-shortcut-choice:Fn");
    assert!(!session.flow.shortcut_tested,"a held choice cannot admit capture");
    session.shortcut_selection_released(true);
    session.action("accept-shortcut-choice:Copilot");
    assert!(!session.flow.shortcut_tested,"stale shortcut receipt is rejected");
    session.action("accept-shortcut-choice:Fn");
    assert!(session.flow.shortcut_tested);
    assert_eq!(session.flow.step(),Step::Shortcut,"receipt never starts capture");
    session.action("continue");
    assert_eq!(session.flow.step(),Step::TryIt);
    assert_eq!(session.shortcut_policy(),ShortcutPolicy::Record,"next press records without another trial");
    session.flow.step=Step::Shortcut;session.flow.shortcut_tested=false;
    session.fallback=None;
    session.action("accept-shortcut-choice:Fn");
    assert!(!session.flow.shortcut_tested,"retired Electron cannot change fallback progression");
}
