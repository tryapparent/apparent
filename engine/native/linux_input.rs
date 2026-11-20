use super::{Held, Modifiers, input, linux, vk_for_keysym, x11};

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
