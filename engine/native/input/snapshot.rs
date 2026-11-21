use super::{Held, Modifiers, ShortcutConfig, ShortcutKind, hotkey_combos, input, linux, vk_for_keysym, x11};

pub(super) fn held_from(devices: Option<input::Held>) -> Held {
    if linux::wayland_session()
        && let Some(devices) = devices
    {
        return Held {
            mods: Modifiers {
                super_key: devices.super_key(),
                ctrl: devices.ctrl(),
                alt: devices.alt(),
                shift: devices.shift(),
            },
            note_blocked: devices.keys.iter().any(|code| {
                !matches!(
                    *code,
                    input::code::KEY_LEFTSHIFT | input::code::KEY_RIGHTSHIFT | 0x140..=0x14f
                )
            }),
            left: devices.left(),
            right: devices.right(),
            keys: devices
                .keys
                .iter()
                .filter_map(|&code| input::vk_for_evdev_code(code))
                .collect(),
        };
    }
    let pointer = x11::pointer_state().unwrap_or_default();
    let mut note_blocked = false;
    let keys = x11::keys_down()
        .map(|bits| {
            (8..=255_u8)
                .filter(|&code| x11::key_is_down(&bits, code))
                .filter_map(|code| {
                    let keysym = x11::keysym_at(code);
                    note_blocked |= !matches!(keysym, Some(0xffe1 | 0xffe2));
                    keysym.and_then(vk_for_keysym)
                })
                .collect()
        })
        .unwrap_or_default();
    Held {
        mods: Modifiers {
            super_key: pointer.super_key,
            ctrl: pointer.ctrl,
            alt: pointer.alt,
            shift: pointer.shift,
        },
        left: pointer.left,
        right: pointer.right,
        keys,
        note_blocked,
    }
}

pub(super) fn held_now() -> Held {
    held_from(input::held())
}

pub(crate) fn can_observe_record_shortcut() -> bool {
    linux::wayland_session() && input::held_record_shortcut_state().is_some()
}

#[derive(Debug)]
pub(crate) struct HeldRecordShortcut {
    code: u16,
    modifiers: u32,
}

impl HeldRecordShortcut {
    pub(crate) fn held(&self) -> Option<bool> {
        input::held_record_shortcut_state().map(|state| self.matches(&state))
    }

    fn matches(&self, state: &input::Held) -> bool {
        state.keys.contains(&self.code) && record_hold_modifiers(state) & self.modifiers == self.modifiers
    }
}

pub(crate) fn held_record_shortcut(config: &ShortcutConfig) -> Option<HeldRecordShortcut> {
    detect_held_record_shortcut(config, &input::held_record_shortcut_state()?)
}

fn record_hold_modifiers(state: &input::Held) -> u32 {
    Modifiers {
        super_key: state.super_key(),
        ctrl: state.ctrl(),
        alt: state.alt(),
        shift: state.shift(),
    }.bits()
}

fn detect_held_record_shortcut(config: &ShortcutConfig, state: &input::Held) -> Option<HeldRecordShortcut> {
    let modifiers = record_hold_modifiers(state);
    let combos = hotkey_combos(ShortcutKind::Record, config);
    state.keys.iter().find_map(|&code| {
        let key = match code {
            193 => 201,
            183..=192 | 194 => 0x7C + code - 183,
            _ => input::vk_for_evdev_code(code)?,
        };
        combos.contains(&(u32::from(key), modifiers)).then_some(HeldRecordShortcut { code, modifiers })
    })
}

pub(super) fn held_polled() -> Held {
    held_from(input::take_held())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::shortcut_from_key_and_mods;

    #[test]
    fn held_record_shortcut_tracks_the_physical_key_and_required_modifiers() {
        let config = shortcut_from_key_and_mods("Copilot", true, false, false, true).unwrap();
        let mut state = input::Held::default();
        state.keys.extend([193, input::code::KEY_RIGHTMETA, input::code::KEY_LEFTSHIFT]);
        let hold = detect_held_record_shortcut(&config, &state).unwrap();
        assert!(hold.matches(&state));
        state.keys.remove(&193);
        assert!(!hold.matches(&state));
        assert!(detect_held_record_shortcut(&config, &state).is_none());
        state.keys.insert(193);
        state.keys.remove(&input::code::KEY_LEFTSHIFT);
        assert!(!hold.matches(&state));
        let bare = shortcut_from_key_and_mods("Copilot", false, false, false, false).unwrap();
        state.keys.remove(&input::code::KEY_RIGHTMETA);
        let hold = detect_held_record_shortcut(&bare, &state).unwrap();
        state.keys.insert(input::code::KEY_LEFTSHIFT);
        assert!(hold.matches(&state));
    }
}
