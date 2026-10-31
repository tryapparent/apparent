//! Desktop clipboard offers and guarded, unsent draft paste.
use super::{AGENT_DEMO_VIDEO, experiment, load_bundle};
use crate::model::ApparentBundle;
use anyhow::{Context, Result, bail, ensure};
use std::fs;
use std::path::Path;

#[cfg(target_os = "macos")]
pub fn copy_string_to_clipboard(content: &str) -> Result<()> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::{NSArray, NSString};

    let text = NSString::from_str(content);
    let pasteboard = NSPasteboard::generalPasteboard();
    unsafe {
        let types = NSArray::from_slice(&[NSPasteboardTypeString]);
        pasteboard.clearContents();
        pasteboard.declareTypes_owner(&types, None);
        ensure!(
            pasteboard.setString_forType(&text, NSPasteboardTypeString),
            "Could not copy text to clipboard"
        );
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn copy_png_to_clipboard(png_bytes: &[u8]) -> Result<()> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG};
    use objc2_foundation::{NSArray, NSData};

    let data = NSData::with_bytes(png_bytes);
    let pasteboard = NSPasteboard::generalPasteboard();
    unsafe {
        let types = NSArray::from_slice(&[NSPasteboardTypePNG]);
        pasteboard.clearContents();
        pasteboard.declareTypes_owner(&types, None);
        ensure!(
            pasteboard.setData_forType(Some(&data), NSPasteboardTypePNG),
            "Could not copy PNG image to clipboard"
        );
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn copy_png_and_text_to_clipboard(png_bytes: &[u8], text: &str) -> Result<bool> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeString};
    use objc2_foundation::{NSArray, NSData, NSString};

    let pasteboard = NSPasteboard::generalPasteboard();
    let image = NSData::with_bytes(png_bytes);
    let text = NSString::from_str(text);
    unsafe {
        let types = NSArray::from_slice(&[NSPasteboardTypePNG, NSPasteboardTypeString]);
        pasteboard.clearContents();
        pasteboard.declareTypes_owner(&types, None);
        ensure!(
            pasteboard.setData_forType(Some(&image), NSPasteboardTypePNG)
                && pasteboard.setString_forType(&text, NSPasteboardTypeString),
            "Could not copy image and text to clipboard"
        );
    }
    Ok(true)
}

#[cfg(target_os = "windows")]
fn copy_png_and_text_to_clipboard(png_bytes: &[u8], text: &str) -> Result<bool> {
    crate::win::clipboard::set_png_and_text(png_bytes, Some(text))?;
    Ok(true)
}

#[cfg(target_os = "linux")]
fn copy_png_and_text_to_clipboard(png_bytes: &[u8], text: &str) -> Result<bool> {
    if !crate::linux::clipboard::combined_offer_supported() {
        return Ok(false);
    }
    crate::linux::clipboard::set_png_and_text(png_bytes, text)?;
    Ok(true)
}

#[cfg(target_os = "windows")]
pub fn copy_string_to_clipboard(content: &str) -> Result<()> {
    crate::win::clipboard::set_text(content)
}

#[cfg(target_os = "windows")]
pub fn copy_png_to_clipboard(png_bytes: &[u8]) -> Result<()> {
    crate::win::clipboard::set_png(png_bytes)
}

#[cfg(target_os = "linux")]
pub fn copy_string_to_clipboard(content: &str) -> Result<()> {
    crate::linux::clipboard::set_text(content)
}

#[cfg(target_os = "linux")]
pub fn copy_png_to_clipboard(png_bytes: &[u8]) -> Result<()> {
    crate::linux::clipboard::set_png(png_bytes)
}

pub fn copy_bundle_to_clipboard(bundle_dir: &Path) -> Result<()> {
    let (directory, bundle) = load_bundle(bundle_dir)?;
    let summary = clipboard_summary(&bundle, &directory);
    offer_image_handoff(
        experiment("clipboardImage"),
        || fs::read(directory.join(&bundle.contact_sheet)).map_err(Into::into),
        &summary,
        copy_png_and_text_to_clipboard,
        copy_string_to_clipboard,
    )
}

#[cfg(target_os = "linux")]
pub fn copy_bundle_text_to_clipboard(bundle_dir: &Path) -> Result<()> {
    let (directory, bundle) = load_bundle(bundle_dir)?;
    copy_string_to_clipboard(&clipboard_summary(&bundle, &directory))
}

// Only fall back if no image was offered. An error after publication may mean another
// app took the selection; replacing it with our summary would steal the user's copy.
fn offer_image_handoff(
    enabled: bool,
    image: impl FnOnce() -> Result<Vec<u8>>,
    summary: &str,
    offer_both: impl FnOnce(&[u8], &str) -> Result<bool>,
    offer_text: impl FnOnce(&str) -> Result<()>,
) -> Result<()> {
    if enabled && let Ok(image) = image() {
        if offer_both(&image, summary)? {
            return Ok(());
        }
    }
    offer_text(summary)
}

const DEMO_VIDEO_REQUEST: &str = "Use make-it-apparent for complex visible changes. Share verified video proof or explain why you can't.";

/// The request belongs to copy/paste, not the archived summary or automatic session message.
/// Read config on each handoff so file edits take effect without a restart.
pub(crate) fn clipboard_summary(bundle: &ApparentBundle, directory: &Path) -> String {
    let mut summary =
        clipboard_summary_with_demo_video(bundle, directory, experiment(AGENT_DEMO_VIDEO));
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if let Some(pointer) = crate::hosted::handoff_pointer(directory) {
        summary.push_str(&pointer);
    }
    summary
}

fn clipboard_summary_with_demo_video(
    bundle: &ApparentBundle,
    directory: &Path,
    request_video: bool,
) -> String {
    with_demo_video_request(
        crate::sketch::summary_markdown(bundle, directory),
        request_video,
    )
}

fn with_demo_video_request(mut summary: String, request_video: bool) -> String {
    if request_video {
        summary.push('\n');
        summary.push_str(DEMO_VIDEO_REQUEST);
        summary.push('\n');
    }
    summary
}

/// Pastes both the contact-sheet image and the transcript/keyframe text into the active app
/// as a two-step sequence (`⌘V` image, then `⌘V` text; Ctrl+V on Windows and Linux, Ctrl+Shift+V
/// in a Linux terminal). If `click_target` is
/// provided (from dragging the Paste chip onto a window/input), clicks at that screen coordinate
/// first to focus it.
pub fn paste_bundle_at_target(bundle_dir: &Path, click_target: Option<[f32; 2]>) -> Result<()> {
    if let Some([x, y]) = click_target {
        crate::capture::post_synthetic_click(f64::from(x), f64::from(y));
        std::thread::sleep(std::time::Duration::from_millis(65));
    } else {
        crate::capture::ensure_external_app_active();
    }
    paste_bundle_image_and_text(bundle_dir)
}

pub fn paste_bundle_image_and_text(bundle_dir: &Path) -> Result<()> {
    let (directory, bundle) = load_bundle(bundle_dir)?;
    let sheet_path = directory.join(&bundle.contact_sheet);
    let image = fs::read(&sheet_path).context("Could not read contact sheet")?;
    let summary = clipboard_summary(&bundle, &directory);

    crate::capture::wait_for_modifiers_released(350);

    #[cfg(target_os = "linux")]
    if crate::linux::hyprland::running() && crate::linux::wayland_session() {
        if !crate::capture::is_frontmost_terminal() {
            // On Hyprland the targeted shortcut works without the RemoteDesktop portal.
            // Use it for any focused GUI composer, not only one named application.
            return crate::linux::auto_paste::paste_bundle(bundle_dir);
        }
    }

    #[cfg(target_os = "linux")]
    if experiment("draftHandoff")
        && crate::linux::hyprland::running()
        && crate::linux::wayland_session()
    {
        return run_draft_handoff(
            &image,
            &summary,
            &sheet_path,
            crate::capture::is_frontmost_terminal(),
            &mut LinuxDraftHandoff,
        );
    }

    if crate::capture::is_frontmost_terminal() {
        // In terminals (Ghostty / OpenCode TUI / Claude Code), pasting the image path first
        // resolves and attaches `[Image 1]`, and the second paste inserts the text summary.
        copy_string_to_clipboard(&sheet_path.display().to_string())?;
    } else {
        // In GUI apps (OpenCode Desktop, Slack, Linear, browsers), PNG-only attaches the image.
        copy_png_to_clipboard(&image)?;
    }
    std::thread::sleep(std::time::Duration::from_millis(20));
    paste_synthetic_checked()?;

    std::thread::sleep(std::time::Duration::from_millis(160));
    copy_string_to_clipboard(&summary)?;
    std::thread::sleep(std::time::Duration::from_millis(20));
    paste_synthetic_checked()?;
    Ok(())
}

/// Automatic delivery never activates another app, clicks a target, or submits the draft.
#[cfg(target_os = "linux")]
pub(crate) fn paste_bundle_into_original_draft(
    bundle_dir: &Path,
    original: &crate::linux::hyprland::FocusedWindow,
) -> Result<()> {
    ensure!(
        crate::linux::hyprland::running() && crate::linux::wayland_session(),
        "Automatic draft paste requires Hyprland Wayland"
    );
    let current = crate::linux::hyprland::focused_window()?;
    ensure!(
        crate::linux::auto_paste::window_matches(original, &current),
        "Original chat window is no longer focused; manual paste remains available"
    );
    let (directory, bundle) = load_bundle(bundle_dir)?;
    let sheet_path = directory.join(&bundle.contact_sheet);
    let image = fs::read(&sheet_path).context("Could not read contact sheet")?;
    let summary = clipboard_summary(&bundle, &directory);
    run_draft_handoff_at(
        &image,
        &summary,
        &sheet_path,
        false,
        original,
        &mut LinuxDraftHandoff,
    )
}

#[cfg(target_os = "linux")]
pub(crate) fn draft_receiver_preflight(
    original: &crate::linux::hyprland::FocusedWindow,
) -> Result<()> {
    LinuxDraftHandoff
        .supported(original)
        .context("Use the normal Copy and routing path for this composer")
}

fn paste_synthetic_checked() -> Result<()> {
    #[cfg(target_os = "linux")]
    return crate::capture::try_post_synthetic_cmd_v();
    #[cfg(not(target_os = "linux"))]
    {
        crate::capture::post_synthetic_cmd_v();
        Ok(())
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn run_draft_handoff(
    image: &[u8],
    summary: &str,
    sheet_path: &Path,
    terminal: bool,
    ops: &mut impl DraftHandoffOps,
) -> Result<()> {
    let target = ops.target()?;
    run_draft_handoff_at(image, summary, sheet_path, terminal, &target, ops)
}

#[cfg(target_os = "linux")]
fn run_draft_handoff_at<O: DraftHandoffOps>(
    image: &[u8],
    summary: &str,
    sheet_path: &Path,
    terminal: bool,
    target: &O::Target,
    ops: &mut O,
) -> Result<()> {
    ops.supported(target)
        .context("Use manual image upload and text paste for this composer")?;
    // The user may select the composer after the recording finishes. Wait without
    // changing focus or clipboard; never turn an unfocused Ctrl+V into a silent loss.
    let mut editable = false;
    for _ in 0..30 {
        ops.check_target(target)?;
        if ops.editor_ready(target)? {
            editable = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    ensure!(
        editable,
        "No writable field selected; use manual image upload and text paste"
    );
    let snapshot = ops.snapshot()?;
    let path_text = sheet_path.display().to_string();
    let mut offered: Option<(&str, &[u8])> = None;
    let result = (|| {
        ops.check_target(&target)?;
        if terminal {
            offered = Some(("text/plain;charset=utf-8", path_text.as_bytes()));
            ops.text(&path_text)?;
        } else {
            offered = Some(("image/png", image));
            ops.image(image)?;
        }
        ops.check_target(&target)?;
        ensure!(
            ops.editor_ready(target)?,
            "Writable field lost before image paste"
        );
        ops.paste()?;
        let Some((mime, bytes)) = offered else {
            bail!("No image was offered");
        };
        let mut attached = false;
        for _ in 0..20 {
            ops.check_target(&target)?;
            if ops.attachment_visible(&target, image)? {
                attached = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        ensure!(
            attached,
            "Image attachment was not confirmed; use manual upload and paste"
        );
        ops.check_target(&target)?;
        ensure!(
            ops.still_ours(mime, bytes)?,
            "Clipboard changed; text was not pasted"
        );
        offered = Some(("text/plain;charset=utf-8", summary.as_bytes()));
        ops.text(summary)?;
        ops.check_target(&target)?;
        ensure!(
            ops.editor_ready(target)?,
            "Writable field lost before text paste"
        );
        ensure!(
            ops.still_ours("text/plain;charset=utf-8", summary.as_bytes())?,
            "Clipboard changed; text was not pasted"
        );
        ops.paste()
    })();
    let result = result.and_then(|()| {
        ops.check_target(&target)?;
        ensure!(
            ops.text_visible(&target, summary)?,
            "Transcript was not confirmed in the draft"
        );
        Ok(())
    });
    let restored = ops.restore(snapshot, offered);
    match (result, restored) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) => Err(error.context("Could not restore clipboard")),
        (Err(error), Err(restore)) => {
            Err(error.context(format!("Clipboard restore also failed: {restore:#}")))
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) trait DraftHandoffOps {
    type Snapshot;
    /// Include the focused editor identity, not only its containing window.
    type Target: Clone + Eq;
    fn target(&mut self) -> Result<Self::Target>;
    fn supported(&mut self, target: &Self::Target) -> Result<()>;
    /// Confirm that the exact target is an active, writable editor, not merely a window.
    fn editor_ready(&mut self, target: &Self::Target) -> Result<bool>;
    fn check_target(&mut self, target: &Self::Target) -> Result<()> {
        ensure!(
            self.target()? == *target,
            "Focus moved; refusing to paste into another window"
        );
        Ok(())
    }
    /// Do not treat matching bytes alone as proof of clipboard ownership.
    fn still_ours(&mut self, mime: &str, bytes: &[u8]) -> Result<bool>;
    fn attachment_visible(&mut self, target: &Self::Target, image: &[u8]) -> Result<bool>;
    fn text_visible(&mut self, target: &Self::Target, text: &str) -> Result<bool>;
    fn snapshot(&mut self) -> Result<Self::Snapshot>;
    /// Restore only when the handoff still owns the selection; never overwrite another owner.
    fn restore(&mut self, snapshot: Self::Snapshot, offered: Option<(&str, &[u8])>) -> Result<()>;
    fn image(&mut self, image: &[u8]) -> Result<()>;
    fn text(&mut self, text: &str) -> Result<()>;
    fn paste(&mut self) -> Result<()>;
}

#[cfg(target_os = "linux")]
struct LinuxDraftHandoff;

#[cfg(target_os = "linux")]
impl DraftHandoffOps for LinuxDraftHandoff {
    type Snapshot = crate::linux::clipboard::TextSnapshot;
    type Target = crate::linux::hyprland::FocusedWindow;
    fn target(&mut self) -> Result<Self::Target> {
        crate::linux::hyprland::focused_window()
    }
    fn supported(&mut self, _target: &Self::Target) -> Result<()> {
        bail!("No verified attachment observer is available for this composer")
    }
    fn editor_ready(&mut self, _target: &Self::Target) -> Result<bool> {
        // Window identity alone cannot establish that a focused text field exists.
        Ok(false)
    }
    fn still_ours(&mut self, mime: &str, bytes: &[u8]) -> Result<bool> {
        crate::linux::clipboard::still_ours(mime, bytes)
    }
    fn attachment_visible(&mut self, _target: &Self::Target, _image: &[u8]) -> Result<bool> {
        bail!("No attachment observer")
    }
    fn text_visible(&mut self, _target: &Self::Target, _text: &str) -> Result<bool> {
        bail!("No text observer")
    }
    fn snapshot(&mut self) -> Result<Self::Snapshot> {
        crate::linux::clipboard::snapshot_text_wayland()
    }
    fn restore(&mut self, snapshot: Self::Snapshot, offered: Option<(&str, &[u8])>) -> Result<()> {
        crate::linux::clipboard::restore_text_wayland(snapshot, offered)
    }
    fn image(&mut self, image: &[u8]) -> Result<()> {
        copy_png_to_clipboard(image)
    }
    fn text(&mut self, text: &str) -> Result<()> {
        copy_string_to_clipboard(text)
    }
    fn paste(&mut self) -> Result<()> {
        std::thread::sleep(std::time::Duration::from_millis(20));
        crate::capture::try_post_synthetic_cmd_v()
    }
}
#[cfg(test)]
mod tests {
    use super::super::test_support::Fixture;
    use super::*;
    #[test]
    fn demo_video_request_is_only_added_to_enabled_copy_text() {
        let fixture = Fixture::new();
        let directory = fixture.bundle("demo-video", 100);
        let (_, bundle) = load_bundle(&directory).unwrap();
        let original = clipboard_summary_with_demo_video(&bundle, &directory, false);
        assert!(original.contains("apparent"));
        assert!(!original.contains(DEMO_VIDEO_REQUEST));
        let enabled = clipboard_summary_with_demo_video(&bundle, &directory, true);
        assert!(enabled.starts_with(&original));
        assert!(enabled.contains("complex visible changes"));
        assert!(enabled.contains("Use make-it-apparent"));
        assert!(enabled.contains("Share verified video proof"));
        assert!(enabled.contains("explain why you can't"));
        assert!(DEMO_VIDEO_REQUEST.len() <= 120);
        assert_eq!(enabled.matches(DEMO_VIDEO_REQUEST).count(), 1);
    }
    #[test]
    fn image_offer_is_opt_in_and_falls_back_to_text_if_unavailable() {
        use std::cell::RefCell;
        let calls = RefCell::new(Vec::new());
        let offer = |enabled, image: Result<Vec<u8>>| {
            offer_image_handoff(
                enabled,
                || {
                    calls.borrow_mut().push("read".into());
                    image
                },
                "summary",
                |png, text| {
                    calls
                        .borrow_mut()
                        .push(format!("image:{}:{text}", png.len()));
                    Ok(true)
                },
                |text| {
                    calls.borrow_mut().push(format!("text:{text}"));
                    Ok(())
                },
            )
        };
        offer(false, Ok(vec![1, 2, 3])).unwrap();
        offer(true, Ok(vec![1, 2, 3])).unwrap();
        offer(true, Err(anyhow::anyhow!("missing sheet"))).unwrap();
        offer_image_handoff(
            true,
            || Ok(vec![1]),
            "summary",
            |_, _| {
                calls.borrow_mut().push("unsupported".into());
                Ok(false)
            },
            |text| {
                calls.borrow_mut().push(format!("text:{text}"));
                Ok(())
            },
        )
        .unwrap();
        let contended = offer_image_handoff(
            true,
            || Ok(vec![1]),
            "summary",
            |_, _| {
                calls.borrow_mut().push("ownership-lost".into());
                anyhow::bail!("clipboard changed after image publication")
            },
            |_| panic!("must not overwrite the new clipboard owner"),
        );
        assert!(contended.is_err());
        assert_eq!(
            *calls.borrow(),
            [
                "text:summary",
                "read",
                "image:3:summary",
                "read",
                "text:summary",
                "unsupported",
                "text:summary",
                "ownership-lost"
            ]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_receiver_refuses_before_clipboard_or_paste() {
        let target = crate::linux::hyprland::FocusedWindow {
            address: "0x123".into(),
            pid: 123,
            class: "t3code".into(),
        };
        let error = run_draft_handoff_at(
            b"image",
            "text",
            Path::new("contact-sheet.png"),
            false,
            &target,
            &mut LinuxDraftHandoff,
        )
        .unwrap_err();
        assert!(format!("{error:#}").contains("No verified attachment observer"));
        assert!(
            format!("{:#}", draft_receiver_preflight(&target).unwrap_err())
                .contains("No verified attachment observer")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn draft_handoff_attaches_image_and_text_without_sending_and_restores_clipboard() {
        struct Draft {
            clipboard: Vec<u8>,
            draft_image: Option<Vec<u8>>,
            draft_text: String,
            pastes: usize,
            fail_at: Option<usize>,
            focus_lost_after_first: bool,
            focus: (u8, u8), // window and focused editor
            supported: bool,
            attachment_ready_after: usize,
            attachment_checks: usize,
            editable_checks: usize,
            editable_after: usize,
            clipboard_contended_after_first: bool,
        }
        impl DraftHandoffOps for Draft {
            type Snapshot = Vec<u8>;
            type Target = (u8, u8);
            fn target(&mut self) -> Result<(u8, u8)> {
                Ok(self.focus)
            }
            fn supported(&mut self, _: &(u8, u8)) -> Result<()> {
                ensure!(self.supported, "Unsupported composer");
                Ok(())
            }
            fn editor_ready(&mut self, _: &(u8, u8)) -> Result<bool> {
                self.editable_checks += 1;
                Ok(self.editable_checks >= self.editable_after)
            }
            fn still_ours(&mut self, _: &str, bytes: &[u8]) -> Result<bool> {
                Ok(self.clipboard == bytes)
            }
            fn attachment_visible(&mut self, _: &(u8, u8), image: &[u8]) -> Result<bool> {
                self.attachment_checks += 1;
                Ok(self.attachment_checks >= self.attachment_ready_after
                    && self.draft_image.as_deref() == Some(image))
            }
            fn text_visible(&mut self, _: &(u8, u8), text: &str) -> Result<bool> {
                Ok(self.draft_text == text)
            }
            fn snapshot(&mut self) -> Result<Vec<u8>> {
                Ok(self.clipboard.clone())
            }
            fn restore(&mut self, bytes: Vec<u8>, offered: Option<(&str, &[u8])>) -> Result<()> {
                if let Some((_, expected)) = offered {
                    ensure!(self.clipboard == expected, "clipboard changed");
                    self.clipboard = bytes;
                }
                Ok(())
            }
            fn image(&mut self, image: &[u8]) -> Result<()> {
                ensure!(
                    self.editable_checks >= self.editable_after,
                    "no editable field was selected"
                );
                self.clipboard = image.to_vec();
                Ok(())
            }
            fn text(&mut self, text: &str) -> Result<()> {
                self.clipboard = text.as_bytes().to_vec();
                Ok(())
            }
            fn paste(&mut self) -> Result<()> {
                self.pastes += 1;
                if self.fail_at == Some(self.pastes) {
                    bail!("paste refused");
                }
                if self.pastes == 1 {
                    self.draft_image = Some(self.clipboard.clone());
                    if self.focus_lost_after_first {
                        self.focus.1 = 2;
                    }
                    if self.clipboard_contended_after_first {
                        self.clipboard = b"other app".to_vec();
                    }
                } else {
                    self.draft_text = String::from_utf8(self.clipboard.clone())?;
                }
                Ok(())
            }
        }
        let mut image = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut image, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[255, 0, 0, 255])
                .unwrap();
        }
        let mut receiver = Draft {
            clipboard: b"original clipboard".to_vec(),
            draft_image: None,
            draft_text: String::new(),
            pastes: 0,
            fail_at: None,
            focus_lost_after_first: false,
            focus: (1, 1),
            supported: true,
            attachment_ready_after: 3,
            attachment_checks: 0,
            editable_checks: 0,
            editable_after: 3,
            clipboard_contended_after_first: false,
        };
        run_draft_handoff(
            &image,
            "Synthetic transcript",
            Path::new("contact-sheet.png"),
            false,
            &mut receiver,
        )
        .unwrap();
        assert_eq!(receiver.draft_image.as_deref(), Some(image.as_slice()));
        assert_eq!(receiver.draft_text, "Synthetic transcript");
        assert_eq!(receiver.clipboard, b"original clipboard");
        assert_eq!(receiver.pastes, 2);
        assert_eq!(
            receiver.attachment_checks, 3,
            "confirmation retries must not repaste"
        );
        assert!(
            receiver.editable_checks >= 3,
            "wait for a focused writable field"
        );

        receiver.pastes = 0;
        receiver.supported = false;
        assert!(
            run_draft_handoff(
                &image,
                "Synthetic transcript",
                Path::new("contact-sheet.png"),
                false,
                &mut receiver
            )
            .is_err()
        );
        assert_eq!(receiver.pastes, 0);
        assert_eq!(receiver.clipboard, b"original clipboard");
        receiver.supported = true;

        receiver.pastes = 0;
        receiver.editable_checks = 0;
        receiver.editable_after = usize::MAX;
        let error = run_draft_handoff(
            &image,
            "Synthetic transcript",
            Path::new("contact-sheet.png"),
            false,
            &mut receiver,
        )
        .unwrap_err();
        assert!(format!("{error:#}").contains("No writable field selected"));
        assert_eq!(receiver.pastes, 0, "no field must mean no paste");
        assert_eq!(receiver.clipboard, b"original clipboard");
        receiver.editable_after = 3;

        receiver.pastes = 0;
        receiver.attachment_checks = 0;
        receiver.attachment_ready_after = 99;
        assert!(
            run_draft_handoff(
                &image,
                "Synthetic transcript",
                Path::new("contact-sheet.png"),
                false,
                &mut receiver
            )
            .is_err()
        );
        assert_eq!(receiver.pastes, 1, "missing attachment must not paste text");
        receiver.attachment_ready_after = 1;

        receiver.pastes = 0;
        receiver.fail_at = None;
        receiver.focus_lost_after_first = true;
        assert!(
            run_draft_handoff(
                &image,
                "Synthetic transcript",
                Path::new("contact-sheet.png"),
                false,
                &mut receiver
            )
            .is_err()
        );
        assert_eq!(
            receiver.pastes, 1,
            "focus loss must prevent the second paste"
        );
        receiver.focus = (1, 1);
        receiver.focus_lost_after_first = false;

        receiver.pastes = 0;
        receiver.clipboard_contended_after_first = true;
        assert!(
            run_draft_handoff(
                &image,
                "Synthetic transcript",
                Path::new("contact-sheet.png"),
                false,
                &mut receiver
            )
            .is_err()
        );
        assert_eq!(
            receiver.pastes, 1,
            "clipboard contention must prevent text paste"
        );
        assert_eq!(receiver.clipboard, b"other app");
        receiver.clipboard_contended_after_first = false;
        receiver.clipboard = b"original clipboard".to_vec();

        receiver.pastes = 0;
        receiver.fail_at = Some(1);
        assert!(
            run_draft_handoff(
                &image,
                "Synthetic transcript",
                Path::new("contact-sheet.png"),
                false,
                &mut receiver
            )
            .is_err()
        );
        assert_eq!(
            receiver.pastes, 1,
            "refused first paste must not advance to text"
        );
        assert_eq!(receiver.clipboard, b"original clipboard");

        receiver.pastes = 0;
        receiver.fail_at = Some(2);
        assert!(
            run_draft_handoff(
                &image,
                "Synthetic transcript",
                Path::new("contact-sheet.png"),
                false,
                &mut receiver
            )
            .is_err()
        );
        assert_eq!(receiver.clipboard, b"original clipboard");
        assert_eq!(receiver.pastes, 2);

        receiver.pastes = 0;
        receiver.focus = (2, 1);
        assert!(
            run_draft_handoff_at(
                &image,
                "Synthetic transcript",
                Path::new("contact-sheet.png"),
                false,
                &(1, 1),
                &mut receiver,
            )
            .is_err()
        );
        assert_eq!(
            receiver.pastes, 0,
            "a changed window must not receive the first paste"
        );
        receiver.focus = (1, 1);
    }
}
