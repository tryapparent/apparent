//! The recording capsule's two brand surfaces. Other app windows keep their own look.
use gpui::Window;
#[cfg(not(target_os = "linux"))]
use gpui::WindowAppearance;

pub const PAPER: u32 = 0xf5f0e8;
pub const CARBON: u32 = 0x020102;
pub const SIGNAL: u32 = 0x7a58c7;
pub const SIGNAL_HOVER: u32 = 0x8969d3;
pub const WARNING: u32 = 0xffbe2e;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PillTheme {
    pub dark: bool,
}

impl PillTheme {
    pub fn for_window(window: &Window) -> Self {
        #[cfg(target_os = "linux")]
        {
            let _ = window;
            Self { dark: linux_dark() }
        }
        #[cfg(not(target_os = "linux"))]
        {
            Self {
                dark: matches!(
                    window.appearance(),
                    WindowAppearance::Dark | WindowAppearance::VibrantDark
                ),
            }
        }
    }

    pub const fn surface(self) -> u32 {
        if self.dark {
            CARBON
        } else {
            PAPER
        }
    }
    pub const fn text(self) -> u32 {
        if self.dark {
            PAPER
        } else {
            CARBON
        }
    }
    pub const fn soft(self) -> u32 {
        if self.dark {
            0xd6cfd8
        } else {
            0x39313b
        }
    }
    pub const fn muted(self) -> u32 {
        if self.dark {
            0xaaa0ad
        } else {
            0x645a69
        }
    }
    pub const fn active_text(self) -> u32 {
        PAPER
    }
    pub const fn neutral(self) -> u32 {
        if self.dark {
            0x302a36
        } else {
            0xe7e0ee
        }
    }
    pub const fn hover(self) -> u32 {
        if self.dark {
            0x40384a
        } else {
            0xdcd3e5
        }
    }
    pub const fn line(self) -> u32 {
        if self.dark {
            0xb7a5d8
        } else {
            CARBON
        }
    }
    pub const fn warning_text(self) -> u32 {
        if self.dark {
            WARNING
        } else {
            0x744900
        }
    }
}

// GPUI's X11 appearance is always Light, even in a dark Wayland session. Read the
// desktop's color-scheme portal off the render thread and refresh while the app runs.
#[cfg(target_os = "linux")]
fn linux_dark() -> bool {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Once,
    };
    static START: Once = Once::new();
    static DARK: AtomicBool = AtomicBool::new(true);
    START.call_once(|| {
        std::thread::spawn(|| loop {
            if let Some(dark) = portal_dark() {
                DARK.store(dark, Ordering::Relaxed);
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        });
    });
    DARK.load(Ordering::Relaxed)
}

#[cfg(target_os = "linux")]
fn portal_dark() -> Option<bool> {
    let bus = zbus::blocking::Connection::session().ok()?;
    let proxy = zbus::blocking::Proxy::new(
        &bus,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Settings",
    )
    .ok()?;
    let value: zbus::zvariant::OwnedValue = proxy
        .call("Read", &("org.freedesktop.appearance", "color-scheme"))
        .ok()?;
    portal_scheme_dark(value)
}

#[cfg(target_os = "linux")]
fn portal_scheme_dark(value: zbus::zvariant::OwnedValue) -> Option<bool> {
    // The portal's Read reply is a D-Bus variant, not a bare integer.
    let scheme: u32 = zbus::zvariant::Value::from(value).downcast().ok()?;
    match scheme {
        1 => Some(true),
        2 => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inverse_brand_surfaces_keep_one_signal() {
        let dark = PillTheme { dark: true };
        let light = PillTheme { dark: false };
        assert_eq!((dark.surface(), dark.text()), (CARBON, PAPER));
        assert_eq!((light.surface(), light.text()), (PAPER, CARBON));
        assert_eq!(dark.active_text(), light.active_text());
        assert_ne!(SIGNAL, WARNING);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn portal_color_scheme_variant_follows_both_appearances() {
        use zbus::zvariant::{OwnedValue, Value};
        for (scheme, expected) in [(1, Some(true)), (2, Some(false)), (0, None)] {
            let reply = OwnedValue::try_from(Value::new(Value::U32(scheme))).unwrap();
            assert_eq!(portal_scheme_dark(reply), expected);
        }
    }
}
