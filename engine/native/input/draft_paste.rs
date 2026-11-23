use anyhow::{Context, Result, ensure};
use std::{fs, path::Path};

#[cfg(target_os = "macos")]
#[path = "draft_paste_macos.rs"]
mod macos;

#[derive(PartialEq, Eq)]
pub(crate) enum DraftTarget {
    #[cfg(target_os = "macos")]
    Mac(i32, usize, usize),
    #[cfg(target_os = "linux")]
    Hyprland(crate::capture::desktop::linux::hyprland::FocusedWindow, (String, String)),
    #[cfg(target_os = "linux")]
    Wayland(u32, (String, String), (String, String)),
    #[cfg(target_os = "linux")]
    X11(u32, isize, u32, (String, String)),
}

impl DraftTarget {
    pub(crate) fn focused() -> Option<Self> {
        if crate::capture::engine::runtime::is_frontmost_terminal() {
            return None;
        }
        #[cfg(target_os = "macos")]
        {
            let (pid, window, field) = macos::focused_editor()?;
            Some(Self::Mac(pid, window, field))
        }
        #[cfg(target_os = "linux")]
        {
            use crate::capture::desktop::linux;
            let wayland = linux::wayland_session();
            let hyprland = wayland && linux::auto_paste::available();
            if wayland && !hyprland && !linux::portal::draft_paste_supported() {
                return None;
            }
            let (pid, accessible_window, editor) = linux::atspi::paste_focus()?;
            if !crate::capture::ui_process::is_external_app(pid as i32) {
                return None;
            }
            if hyprland {
                let window = linux::hyprland::focused_window().ok()?;
                return (window.pid == pid).then_some(Self::Hyprland(window, editor));
            }
            if wayland {
                return Some(Self::Wayland(pid, accessible_window, editor));
            }
            use x11rb::protocol::xproto::ConnectionExt;
            let window = linux::foreground_window()?;
            let focus = linux::x11::x()?.conn.get_input_focus().ok()?.reply().ok()?.focus;
            (window.pid == pid).then_some(Self::X11(pid, window.hwnd, focus, editor))
        }
    }

    fn paste(&self, check: impl Fn() -> Result<()>) -> Result<()> {
        ensure!(crate::capture::engine::runtime::wait_for_modifiers_released(0), "Release the shortcut before pasting");
        check()?;
        #[cfg(target_os = "macos")]
        {
            let Self::Mac(pid, _, _) = self;
            macos::paste(*pid)
        }
        #[cfg(target_os = "linux")]
        {
            use crate::capture::desktop::linux;
            match self {
                Self::Hyprland(window, _) => linux::hyprland::paste_into_focused(window, false),
                Self::Wayland(..) => linux::portal::send_paste_checked(
                    false, true, check,
                ),
                Self::X11(..) => crate::capture::engine::runtime::try_post_synthetic_cmd_v(),
            }
        }
    }
}

#[derive(PartialEq, Eq)]
pub(crate) enum DraftClipboard {
    #[cfg(target_os = "macos")]
    Mac(isize),
    #[cfg(target_os = "linux")]
    X11(u32),
    #[cfg(target_os = "linux")]
    Wayland,
}

impl DraftClipboard {
    pub(crate) fn owner() -> Result<Self> {
        #[cfg(target_os = "macos")]
        { Ok(Self::Mac(objc2_app_kit::NSPasteboard::generalPasteboard().changeCount())) }
        #[cfg(target_os = "linux")]
        {
            Ok(linux_selection()?
                .map_or(Self::Wayland, Self::X11))
        }
    }

    fn check(&self, mime: &str, expected: &[u8]) -> Result<()> {
        #[cfg(target_os = "macos")]
        let _ = (mime, expected);
        ensure!(*self == Self::owner()?, "Clipboard changed during paste");
        #[cfg(target_os = "linux")]
        if *self == Self::Wayland {
            ensure!(crate::capture::desktop::linux::clipboard::still_ours(mime, expected)?,
                "Clipboard changed during paste");
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn linux_selection() -> Result<Option<u32>> {
    use crate::capture::desktop::linux::{clipboard, x11};
    use x11rb::protocol::xproto::ConnectionExt;
    if clipboard::native_wayland_clipboard() {
        return Ok(None);
    }
    let x = x11::x().context("No X11 clipboard connection")?;
    let owner = x.conn.get_selection_owner(x.atom("CLIPBOARD"))?.reply()?.owner;
    ensure!(owner != 0, "Clipboard has no owner");
    Ok(Some(owner))
}

pub(crate) fn paste(
    image: Option<&Path>,
    summary: &str,
    target: &DraftTarget,
    initial: &DraftClipboard,
    current: impl Fn() -> bool,
    copy_image: impl Fn(&[u8]) -> Result<()>,
    copy_text: impl Fn(&str) -> Result<()>,
) -> Result<()> {
    let image = image.map(fs::read).transpose().context("Could not read contact sheet")?;
    let check_focus = || -> Result<()> {
        ensure!(current(), "The recording was dismissed");
        ensure!(DraftTarget::focused().as_ref() == Some(target), "Paste target lost focus");
        ensure!(current(), "The recording was dismissed");
        Ok(())
    };
    let text_mime = "text/plain;charset=utf-8";
    ensure!(crate::capture::engine::runtime::wait_for_modifiers_released(350), "Release the shortcut before pasting");
    check_focus()?;
    initial.check(text_mime, summary.as_bytes())?;
    if let Some(image) = image {
        check_focus()?;
        copy_image(&image)?;
        let offered = DraftClipboard::owner()?;
        let first_paste = target.paste(|| {
            offered.check("image/png", &image)?;
            check_focus()
        });
        if first_paste.is_ok() {
            std::thread::sleep(std::time::Duration::from_millis(160));
        }
        offered.check("image/png", &image)?;
        ensure!(current(), "The recording was dismissed");
        copy_text(summary)?;
        first_paste?;
    } else {
        return target.paste(|| {
            initial.check(text_mime, summary.as_bytes())?;
            check_focus()
        });
    }
    let offered = DraftClipboard::owner()?;
    target.paste(|| {
        offered.check(text_mime, summary.as_bytes())?;
        check_focus()
    })
}
