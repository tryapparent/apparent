//! Explicit user-directed paste mechanics; automatic completion policy lives in Record.
use super::hyprland::FocusedWindow;
use anyhow::{ensure, Context, Result};
use std::path::Path;
use std::time::Duration;

pub(crate) fn available() -> bool {
    super::super::wayland_session()
        && super::hyprland::running()
        && super::hyprland::targeted_paste_supported().is_ok()
}

/// Window identity is necessary, but not sufficient: this cannot check the editor.
pub fn window_matches(original: &FocusedWindow, current: &FocusedWindow) -> bool {
    original == current
}

/// This is a user-directed trial, not an editor or attachment observer. Keep the
/// completed paper visible: dispatching paste never proves that the app accepted it.
pub fn preflight(original: &FocusedWindow) -> Result<()> {
    super::hyprland::targeted_paste_supported()?;
    super::hyprland::check_window(original)?;
    ensure!(
        window_matches(original, &super::hyprland::focused_window()?)
            && original.pid != std::process::id(),
        "Choose a chat composer and keep it focused until paste finishes"
    );
    Ok(())
}

pub trait UserPasteOps {
    fn check_focus(&mut self) -> Result<()>;
    fn offer_image(&mut self) -> Result<()>;
    fn offer_text(&mut self) -> Result<()>;
    fn still_ours(&mut self, value: &'static str) -> Result<bool>;
    fn paste(&mut self) -> Result<()>;
    /// Leave the text handoff on the clipboard for an ordinary manual Ctrl+V.
    /// Never overwrite a selection the user changed during the attempt.
    fn fallback(&mut self, offered: &'static str) -> Result<()>;
}

fn paste_sequence(ops: &mut impl UserPasteOps, with_image: bool) -> Result<()> {
    let mut offered = "";
    let result = (|| {
        ops.check_focus()?;
        if with_image {
            ops.offer_image()?;
            offered = "image";
            ops.check_focus()?;
            ensure!(ops.still_ours(offered)?, "Clipboard changed before image paste");
            ops.paste()?;
            std::thread::sleep(Duration::from_millis(160));
            ops.check_focus()?;
            ensure!(ops.still_ours(offered)?, "Clipboard changed before text offer");
        }
        ops.offer_text()?;
        offered = "text";
        ops.check_focus()?;
        ensure!(
            ops.still_ours(offered)?,
            "Clipboard changed before text paste"
        );
        ops.paste()?;
        Ok(())
    })();
    let fallback = ops.fallback(offered);
    result.and(fallback)
}

pub fn paste_bundle(bundle_dir: &Path) -> Result<()> {
    paste_bundle_into(bundle_dir, &super::hyprland::focused_window()?)
}

/// Completion must use the window frozen at Finish, never discover a new target.
pub fn paste_bundle_into(bundle_dir: &Path, focused: &FocusedWindow) -> Result<()> {
    ensure!(!crate::capture::engine::runtime::is_frontmost_terminal(), "Choose a graphical composer for auto paste");
    crate::capture::engine::runtime::wait_for_modifiers_released(350);
    let (directory, bundle) = crate::shared::handoff::load_bundle(bundle_dir)?;
    let (summary, with_image) = crate::shared::handoff::clipboard_payload(&bundle, &directory);
    let image = with_image.then(|| std::fs::read(directory.join(&bundle.contact_sheet)))
        .transpose().context("Could not read contact sheet")?;
    preflight(focused)?;
    paste_sequence(&mut LivePaste {
        original: focused,
        image: image.as_deref(),
        summary: &summary,
    }, with_image)
}

struct LivePaste<'a> {
    original: &'a FocusedWindow,
    image: Option<&'a [u8]>,
    summary: &'a str,
}

impl UserPasteOps for LivePaste<'_> {
    fn check_focus(&mut self) -> Result<()> {
        ensure!(
            window_matches(self.original, &super::hyprland::focused_window()?),
            "Paste target lost focus"
        );
        Ok(())
    }
    fn offer_image(&mut self) -> Result<()> {
        super::clipboard::set_png(self.image.context("No image to paste")?)
    }
    fn offer_text(&mut self) -> Result<()> {
        super::clipboard::set_text(self.summary)
    }
    fn still_ours(&mut self, value: &'static str) -> Result<bool> {
        match value {
            "image" => super::clipboard::still_ours("image/png", self.image.context("No image was offered")?),
            "text" => super::clipboard::still_ours("text/plain;charset=utf-8", self.summary.as_bytes()),
            _ => Ok(false),
        }
    }
    fn paste(&mut self) -> Result<()> {
        if self.image.is_some() {
            std::thread::sleep(Duration::from_millis(20));
        }
        super::hyprland::paste_into_focused(self.original, false)
    }
    fn fallback(&mut self, offered: &'static str) -> Result<()> {
        if offered == "image" {
            ensure!(
                self.still_ours("image")?,
                "Clipboard changed; not replacing newer content"
            );
            super::clipboard::set_text(self.summary)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::{bail, Result};

    #[test]
    #[ignore = "real Hyprland adapter: isolated guest only"]
    fn auto_paste_native_receiver() {
        use std::io::{BufRead, Write};
        use std::process::{Command, Stdio};
        use x11rb::{connection::Connection, protocol::{Event, xproto::*}, wrapper::ConnectionExt as _};
        if std::env::var_os("APPARENT_PASTE_RECEIVER").is_some() {
            let (conn, screen) = x11rb::connect(None).unwrap();
            let root = &conn.setup().roots[screen];
            let window = conn.generate_id().unwrap();
            conn.create_window(0, window, root.root, 20, 20, 640, 400, 0, WindowClass::INPUT_OUTPUT, 0,
                &CreateWindowAux::new().background_pixel(root.white_pixel).event_mask(EventMask::KEY_PRESS)).unwrap();
            conn.change_property8(PropMode::REPLACE, window, AtomEnum::WM_NAME, AtomEnum::STRING, b"SYNTHETIC paste receiver").unwrap();
            conn.change_property8(PropMode::REPLACE, window, AtomEnum::WM_CLASS, AtomEnum::STRING, b"paste-fixture\0PasteFixture\0").unwrap();
            let pid = conn.intern_atom(false, b"_NET_WM_PID").unwrap().reply().unwrap().atom;
            conn.change_property32(PropMode::REPLACE, window, pid, AtomEnum::CARDINAL, &[std::process::id()]).unwrap();
            conn.map_window(window).unwrap(); conn.flush().unwrap();
            println!("ready"); std::io::stdout().flush().unwrap();
            let started = std::time::Instant::now(); let mut received = 0;
            while started.elapsed().as_secs() < 3 {
                if let Some(Event::KeyPress(event)) = conn.poll_for_event().unwrap() {
                    if received < 2 && event.state.contains(KeyButMask::CONTROL) {
                        let mime = if received == 0 { "image/png" } else { "text/plain;charset=utf-8" };
                        let content = Command::new("wl-paste").args(["--no-newline", "--type", mime]).output().unwrap();
                        assert!(content.status.success(), "selection conversion failed");
                        if received == 0 { assert!(content.stdout.starts_with(b"\x89PNG")); }
                        else { assert!(String::from_utf8(content.stdout).unwrap().contains("Synthetic auto paste")); }
                        received += 1;
                    } else {
                        let keys = conn.get_keyboard_mapping(event.detail, 1).unwrap().reply().unwrap();
                        assert!(!keys.keysyms.contains(&0xff0d), "Paste dispatched Enter");
                    }
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            assert_eq!(received, 2, "receiver must accept image and text");
            return;
        }
        assert!(super::super::hyprland::running(), "isolated Hyprland guest required");
        let mut child = Command::new(std::env::current_exe().unwrap()).args(["auto_paste_native_receiver", "--ignored", "--nocapture"])
            .env("APPARENT_PASTE_RECEIVER", "1").stdout(Stdio::piped()).spawn().unwrap();
        let mut lines = std::io::BufReader::new(child.stdout.take().unwrap()).lines();
        while lines.next().unwrap().unwrap() != "ready" {}
        std::thread::sleep(Duration::from_millis(500));
        assert!(Command::new("hyprctl").args(["eval", "hl.dispatch(hl.dsp.focus({ window = 'class:PasteFixture' }))"]).status().unwrap().success());
        std::thread::sleep(Duration::from_millis(100));
        let focused = super::super::hyprland::focused_window().unwrap();
        assert_eq!(focused.pid, child.id());
        let fixture = tempfile::Builder::new().suffix(".apparent").tempdir().unwrap();
        let bundle = serde_json::json!({"version":1,"id":"synthetic-auto-paste","createdAtMs":0,"durationMs":1000,
            "target":{"mode":"display","displayId":0,"frame":{"x":0.0,"y":0.0,"width":640.0,"height":400.0,"scale":1.0}},
            "transcript":{"source":"test","text":"Synthetic auto paste","segments":[]},
            "strokes":[],"marks":[],"events":[],"note":"Synthetic interaction context","keyframes":[],"contactSheet":"c.png"});
        std::fs::write(fixture.path().join("apparent.json"), serde_json::to_vec(&bundle).unwrap()).unwrap();
        let mut png = png::Encoder::new(std::fs::File::create(fixture.path().join("c.png")).unwrap(), 1, 1);
        png.set_color(png::ColorType::Rgb); png.set_depth(png::BitDepth::Eight);
        png.write_header().unwrap().write_image_data(&[100, 0, 200]).unwrap();
        let result = paste_bundle_into(fixture.path(), &focused);
        // Drain the child's test report so it cannot outlive the fixture.
        for line in lines { println!("{}", line.unwrap()); }
        let status = child.wait().unwrap();
        result.unwrap(); assert!(status.success());
    }

    #[test]
    fn user_directed_paste_leaves_manual_text_fallback_without_stealing_focus() {
        #[derive(Default)]
        struct Draft {
            calls: Vec<&'static str>,
            clipboard: &'static str,
            focused: bool,
            fail_second: bool,
            fail_text_offer: bool,
            lose_focus_after_image: bool,
            user_changes_clipboard: bool,
        }
        impl UserPasteOps for Draft {
            fn check_focus(&mut self) -> Result<()> {
                if !self.focused {
                    bail!("focus lost")
                }
                Ok(())
            }
            fn offer_image(&mut self) -> Result<()> {
                self.calls.push("image");
                self.clipboard = "image";
                Ok(())
            }
            fn offer_text(&mut self) -> Result<()> {
                if self.fail_text_offer {
                    bail!("text offer refused")
                }
                self.calls.push("text");
                self.clipboard = "text";
                Ok(())
            }
            fn still_ours(&mut self, value: &'static str) -> Result<bool> {
                Ok(self.clipboard == value)
            }
            fn paste(&mut self) -> Result<()> {
                self.calls.push("paste");
                if self.fail_second
                    && self.calls.iter().filter(|&&call| call == "paste").count() == 2
                {
                    bail!("second paste refused")
                }
                if self.calls.iter().filter(|&&call| call == "paste").count() == 1 {
                    if self.lose_focus_after_image {
                        self.focused = false;
                    }
                    if self.user_changes_clipboard {
                        self.clipboard = "user content";
                    }
                }
                Ok(())
            }
            fn fallback(&mut self, offered: &'static str) -> Result<()> {
                self.calls.push("fallback");
                if self.clipboard == offered && offered == "image" {
                    self.clipboard = "text";
                }
                Ok(())
            }

        }
        let mut draft = Draft {
            clipboard: "handoff",
            focused: true,
            ..Default::default()
        };
        paste_sequence(&mut draft, true).unwrap();
        assert_eq!(draft.calls, ["image", "paste", "text", "paste", "fallback"]);
        assert_eq!(
            draft.clipboard, "text",
            "manual Ctrl+V must still paste the handoff"
        );
        let mut speech = Draft { focused: true, ..Default::default() };
        paste_sequence(&mut speech, false).unwrap();
        assert_eq!(speech.calls, ["text", "paste", "fallback"]);
        let mut failed = Draft {
            clipboard: "handoff",
            focused: true,
            fail_second: true,
            ..Default::default()
        };
        assert!(paste_sequence(&mut failed, true).is_err());
        assert_eq!(
            failed.clipboard, "text",
            "failed automatic paste must leave a Ctrl+V fallback"
        );
        let mut refused = Draft {
            clipboard: "handoff",
            focused: true,
            fail_text_offer: true,
            ..Default::default()
        };
        assert!(paste_sequence(&mut refused, true).is_err());
        assert_eq!(
            refused.clipboard, "text",
            "a failed text offer must not leave the image on Ctrl+V"
        );
        let mut changed_focus = Draft {
            clipboard: "handoff",
            focused: true,
            lose_focus_after_image: true,
            ..Default::default()
        };
        assert!(paste_sequence(&mut changed_focus, true).is_err());
        assert_eq!(
            changed_focus
                .calls
                .iter()
                .filter(|&&call| call == "paste")
                .count(),
            1
        );
        assert_eq!(changed_focus.clipboard, "text");
        let mut changed_clipboard = Draft {
            clipboard: "handoff",
            focused: true,
            user_changes_clipboard: true,
            ..Default::default()
        };
        assert!(paste_sequence(&mut changed_clipboard, true).is_err());
        assert_eq!(
            changed_clipboard.clipboard, "user content",
            "do not overwrite a newer user copy"
        );
    }

    #[test]
    fn only_the_exact_current_window_can_receive_both_pastes() {
        let original = FocusedWindow {
            address: "0xabc".into(),
            pid: 42,
            class: "com.t3tools.T3Code".into(),
        };
        let mut other = original.clone();
        assert!(window_matches(&original, &original));
        other.address = "0xdef".into();
        assert!(!window_matches(&original, &other));
        other = original.clone();
        other.pid = 43;
        assert!(!window_matches(&original, &other));
    }

}
