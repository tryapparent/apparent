//! The capture shortcut. Press ⌥⇧S, briefly or held, and the display under the pointer starts
//! recording as the keys come up; the recording's capsule shows Area · Window · Screen · iPhone
//! as chips for a few seconds (`Reveal`), so the target can still change.

/// A press this soon after a recording starts is a double press, not "finish".
pub const DOUBLE_PRESS_MS: u64 = 400;

/// What Apparent is doing when the shortcut goes down.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Activity {
    /// Nothing recording (a finished capture's island may be showing).
    Free,
    /// The picker (the menu's Choose What to Record…) is open.
    Picker,
    Recording {
        elapsed_ms: u64,
    },
    Processing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    None,
    /// The keys came up: record the display under the pointer, auto-cropped.
    RecordScreen,
    /// Esc while the keys were still down: nothing happens.
    Cancel,
    /// The picker is open: record what it is on.
    RecordSelected,
    Finish,
}

/// Waits for the shortcut's keys to come up, however long they're held, before recording.
#[derive(Debug, Default)]
pub struct Shortcut {
    /// ⌥⇧S went down and its modifiers aren't all up yet.
    pending: bool,
    #[cfg(target_os = "linux")]
    pub(crate) hold: Option<Hold>,
}

impl Shortcut {
    /// Whether ⌥⇧S went down and the recording waits for its keys to come up.
    pub fn is_pending(&self) -> bool {
        self.pending || {
            #[cfg(target_os = "linux")]
            { self.hold.is_some() }
            #[cfg(not(target_os = "linux"))]
            { false }
        }
    }

    /// The shortcut went down.
    pub fn press(&mut self, activity: Activity) -> Action {
        if self.pending {
            return Action::None;
        }
        match activity {
            Activity::Recording { elapsed_ms } if elapsed_ms < DOUBLE_PRESS_MS => Action::None,
            Activity::Recording { .. } => Action::Finish,
            Activity::Processing => Action::None,
            Activity::Picker => Action::RecordSelected,
            Activity::Free => {
                self.pending = true;
                Action::None
            }
        }
    }

    /// Polled every few ms while pending, with whether the shortcut's modifiers are all still
    /// down.
    pub fn tick(&mut self, held: bool) -> Action {
        if self.pending && !held {
            self.pending = false;
            Action::RecordScreen
        } else {
            Action::None
        }
    }

    pub fn escape(&mut self) -> Action {
        if std::mem::take(&mut self.pending) {
            Action::Cancel
        } else {
            Action::None
        }
    }
}

pub(crate) fn key_code(key: &str) -> Option<u32> {
    #[cfg(target_os = "linux")]
    if ["fn", "wakeup", "xf86wakeup"].iter().any(|alias| key.eq_ignore_ascii_case(alias)) {
        return Some(95);
    }
    #[cfg(target_os = "linux")]
    if ["copilot", "f23", "XF86Assistant", "LaunchAssistant"]
        .iter().any(|alias| key.eq_ignore_ascii_case(alias)) {
        return Some(201);
    }
    #[cfg(not(target_os = "macos"))]
    let named: &[(&str, u32)] = &[
        ("space", 0x20),
        ("enter", 0x0D),
        ("tab", 0x09),
        ("backspace", 0x08),
        ("delete", 0x2E),
        ("left", 0x25),
        ("up", 0x26),
        ("right", 0x27),
        ("down", 0x28),
    ];
    #[cfg(target_os = "macos")]
    let named: &[(&str, u32)] = &[
        ("space", 49),
        ("enter", 36),
        ("tab", 48),
        ("backspace", 51),
        ("delete", 117),
        ("left", 123),
        ("right", 124),
        ("down", 125),
        ("up", 126),
    ];
    if let Some((_, code)) = named.iter().find(|(name, _)| *name == key) {
        return Some(*code);
    }
    if let Some(n) = key.strip_prefix('f').and_then(|n| n.parse::<u32>().ok())
        && (1..=16).contains(&n)
    {
        #[cfg(not(target_os = "macos"))]
        return Some(0x6F + n);
        #[cfg(target_os = "macos")]
        return Some([122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106][n as usize - 1]);
    }
    let mut chars = key.chars();
    let ch = chars.next()?;
    if chars.next().is_some() {
        return None;
    }
    crate::capture::engine::runtime::key_code_for_char(ch).map(u32::from)
}

pub(crate) type Reveal = crate::capture::desktop::ui::electron_pill::Adapter;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "linux")]
    fn settings_recorder_recognizes_copilot_xkb_key_name() {
        assert_eq!(key_code("Copilot"), Some(201));
        assert_eq!(key_code("F23"), Some(201));
        assert_eq!(key_code("XF86Assistant"), Some(201));
        assert_eq!(key_code("LaunchAssistant"), Some(201));
        assert_eq!(key_code("XF86TouchpadOff"), None);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn settings_shortcut_translation_uses_macos_virtual_key_codes() {
        assert_eq!(key_code("enter"), Some(36));
        assert_eq!(key_code("delete"), Some(117));
        assert_eq!(key_code("f5"), Some(96));
        assert_eq!(key_code("f17"), None);
    }

    const FREE: Activity = Activity::Free;

    #[test]
    fn a_tap_records_the_screen_when_the_keys_come_up() {
        let mut s = Shortcut::default();
        assert_eq!(s.press(FREE), Action::None);
        assert_eq!(s.tick(true), Action::None);
        assert_eq!(s.tick(false), Action::RecordScreen);
        assert!(!s.is_pending());
        assert_eq!(s.tick(false), Action::None);
    }

    #[test]
    fn holding_records_the_screen_too_once_let_go() {
        let mut s = Shortcut::default();
        s.press(FREE);
        for _ in 0..500 {
            assert_eq!(s.tick(true), Action::None);
        }
        // S pressed again while ⌥⇧ is still down changes nothing.
        assert_eq!(s.press(FREE), Action::None);
        assert_eq!(s.tick(false), Action::RecordScreen);
    }

    #[test]
    fn esc_before_the_keys_come_up_cancels_it() {
        let mut s = Shortcut::default();
        s.press(FREE);
        assert_eq!(s.escape(), Action::Cancel);
        assert_eq!(s.tick(false), Action::None);
        assert_eq!(s.escape(), Action::None);
    }

    #[test]
    fn a_tap_while_recording_finishes_but_not_a_double_press() {
        let mut s = Shortcut::default();
        let at = |elapsed_ms| Activity::Recording { elapsed_ms };
        assert_eq!(s.press(at(0)), Action::None);
        assert_eq!(s.press(at(399)), Action::None);
        assert_eq!(s.press(at(400)), Action::Finish);
        assert_eq!(s.press(at(60_000)), Action::Finish);
        // Releasing ⌥⇧ after finishing doesn't start anything.
        assert!(!s.is_pending());
        assert_eq!(s.tick(false), Action::None);
        assert_eq!(s.press(Activity::Processing), Action::None);
        assert!(!s.is_pending());
    }

    #[test]
    fn in_the_picker_the_shortcut_records_its_selection() {
        let mut s = Shortcut::default();
        assert_eq!(s.press(Activity::Picker), Action::RecordSelected);
        assert!(!s.is_pending());
    }
}

#[cfg(target_os = "linux")]
pub(crate) use push_to_talk::{EXPERIMENT as PUSH_TO_TALK, Hold, HoldAction, supported as push_to_talk_supported};

#[cfg(target_os = "linux")]
mod push_to_talk {
    use std::time::Instant;

    use crate::capture::desktop::linux::{auto_paste, hyprland::FocusedWindow};
    use crate::capture::engine::runtime::{self, SharedCaptureTelemetry};

    pub(crate) const EXPERIMENT: &str = "pushToTalk";

    pub(crate) fn supported() -> bool {
        auto_paste::available() && runtime::can_observe_record_shortcut()
    }

    #[derive(Debug)]
    pub(crate) struct Hold {
        pub(crate) key: runtime::HeldRecordShortcut,
        pub(crate) pressed: Instant,
        pub(crate) generation: Option<u64>,
        pub(crate) target: Option<FocusedWindow>,
    }

    #[derive(Clone, Copy)]
    pub(crate) enum HoldAction {
        Wait,
        Tap,
        Start,
        Finish,
        Cancel,
    }

    include!(concat!(env!("OUT_DIR"), "/push-to-talk.rs"));

    impl Hold {
        pub(crate) fn begin(telemetry: &SharedCaptureTelemetry) -> Option<Self> {
            Some(Self {
                key: runtime::held_record_shortcut(&telemetry.shortcuts().0)?,
                pressed: Instant::now(),
                generation: None,
                target: None,
            })
        }

        pub(crate) fn action(&self, held: bool, cancelled: bool) -> HoldAction {
            let index = usize::from(self.generation.is_some())
                | (usize::from(held) << 1)
                | (usize::from(self.pressed.elapsed().as_millis() >= PUSH_TO_TALK_MS) << 2)
                | (usize::from(cancelled) << 3);
            PUSH_TO_TALK_ACTIONS[index]
        }
    }
}
