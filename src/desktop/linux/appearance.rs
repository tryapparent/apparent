//! Linux desktop appearance from the XDG Settings portal.
//!
//! GPUI's XWayland surface does not reliably report the desktop's effective theme, so use the
//! portal's `org.freedesktop.appearance/color-scheme` setting instead.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

use zbus::zvariant::{OwnedValue, Value};

// If the portal is unavailable at startup, a dark fallback avoids a bright provisional frame.
static DARK: AtomicBool = AtomicBool::new(true);
static REVISION: AtomicU64 = AtomicU64::new(0);
static WATCHER: OnceLock<()> = OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Scheme {
    NoPreference,
    Dark,
    Light,
}

impl Scheme {
    pub fn is_dark(self) -> bool {
        matches!(self, Self::Dark)
    }
}

fn decode_scheme(value: OwnedValue) -> Option<Scheme> {
    let value = Value::from(value).downcast::<u32>().ok()?;
    match value {
        0 => Some(Scheme::NoPreference),
        1 => Some(Scheme::Dark),
        2 => Some(Scheme::Light),
        _ => None,
    }
}

fn read_scheme() -> Option<Scheme> {
    let bus = zbus::blocking::Connection::session().ok()?;
    let proxy = zbus::blocking::Proxy::new(
        &bus,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Settings",
    )
    .ok()?;
    let value: OwnedValue = proxy
        .call("Read", &("org.freedesktop.appearance", "color-scheme"))
        .ok()?;
    decode_scheme(value)
}

/// Set the initial palette before the onboarding window is first rendered.
pub fn initialize() {
    if let Some(scheme) = read_scheme() {
        set_dark(scheme.is_dark());
    }
}

fn set_dark(dark: bool) {
    if DARK.swap(dark, Ordering::AcqRel) != dark {
        REVISION.fetch_add(1, Ordering::Release);
    }
}

pub fn revision() -> u64 {
    REVISION.load(Ordering::Acquire)
}

pub fn is_dark() -> bool {
    DARK.load(Ordering::Acquire)
}

/// Refresh the portal value away from the UI thread. The GPUI loop polls the atomic for changes.
pub fn watch() {
    WATCHER.get_or_init(|| {
        let _ = thread::Builder::new()
            .name("appearance-portal-watch".into())
            .spawn(|| loop {
                thread::sleep(Duration::from_millis(500));
                if let Some(scheme) = read_scheme() {
                    set_dark(scheme.is_dark());
                }
            });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_variant_wrapped_portal_color_scheme() {
        for (raw, expected) in [
            (0, Scheme::NoPreference),
            (1, Scheme::Dark),
            (2, Scheme::Light),
        ] {
            let variant = OwnedValue::try_from(Value::U32(raw)).unwrap();
            assert_eq!(decode_scheme(variant), Some(expected));
        }
        let other = OwnedValue::try_from(Value::U32(3)).unwrap();
        assert_eq!(decode_scheme(other), None);
    }
}
