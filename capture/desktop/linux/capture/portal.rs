//! What a Wayland session asks the compositor for, over D-Bus: the screen (GNOME's own
//! `org.gnome.Mutter.ScreenCast`, which records any rect of the screen without a dialog, else the
//! ScreenCast portal, which asks once and is remembered with a restore token), the shortcuts
//! (the GlobalShortcuts portal: GNOME 48+, KDE Plasma 5.27+), and keystrokes for pasting (the
//! RemoteDesktop portal, which asks once too). On X11 the recording reads the X screen directly
//! (`source_for`).

use crate::capture::desktop::workflow::performance::{Startup, StartupPoint};
use std::collections::HashMap;
use std::os::fd::{AsRawFd, OwnedFd};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use futures_lite::StreamExt as _;

use super::media::Source;
use crate::capture::engine::runtime::apparent_log;
use crate::shared::model::{CaptureMode, TargetInfo};

/// A PipeWire stream a compositor is sending, open until dropped.
pub struct Stream {
    pub node: u32,
    /// The portal's PipeWire connection; Mutter's streams are on the user's own PipeWire.
    fd: Option<OwnedFd>,
    /// Portal compositor coordinates, not XWayland pixels; Hyprland reports (0, 0) for
    /// every output, so do not use this to identify the selected output there.
    pub rect: Option<[f64; 4]>,
    /// The output name supplied by the portal (Hyprland reports this even when position is 0).
    pub mapping_id: Option<String>,
    /// Explicit portal Monitor source type; absent/other types cannot use the fallback.
    pub portal_monitor: bool,
    stop: Option<flume::Sender<()>>,
}

impl Stream {
    /// The PipeWire fd for `pipewiresrc fd=`, or -1 for the default PipeWire.
    pub fn fd(&self) -> i32 {
        self.fd.as_ref().map_or(-1, AsRawFd::as_raw_fd)
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

pub(crate) fn choose_display(stopping: &AtomicBool) -> Result<(TargetInfo, Source)> {
    anyhow::ensure!(super::super::wayland_session(), "The system screen picker requires Wayland");
    let monitors = super::super::monitors();
    let (session, _) = portal_screencast(false, None, stopping, None, None)?;
    anyhow::ensure!(session.portal_monitor, "Choose a display in the system screen picker");
    let output = picked_monitor(&monitors, session.mapping_id.as_deref(), super::super::hyprland())
        .context("The sharing portal did not identify the selected display")?;
    anyhow::ensure!(
        output_still_selected(output, &super::super::monitors(), monitors.len()),
        "The display layout changed while screen sharing was chosen; try again"
    );
    let [x, y, width, height] = output.rect;
    let target = TargetInfo {
        mode: CaptureMode::Display,
        app: None,
        bundle_id: None,
        window_title: None,
        window_id: None,
        display_id: super::super::monitor_id(output),
        frame: crate::shared::model::TargetFrame { x, y, width, height, scale: output.scale },
    };
    Ok((target, Source::PipeWire { session, crop: None }))
}

#[path = "../../../../engine/wayland/display.rs"]
mod display;
pub(crate) use display::Crop;
use display::{output_still_selected, picked_monitor, portal_output_verified, portal_request_supported, region_crop, screencast_key, selected_monitor, target_fits_output};

// MARK: GNOME's screencast

/// `org.gnome.Mutter.ScreenCast.Session.RecordArea`: any rect of the screen (logical pixels,
/// which are XWayland's at scale 1), with the pointer drawn in, no dialog.
fn mutter_area(rect: [f64; 4]) -> Result<Stream> {
    let (ready_tx, ready_rx) = flume::bounded::<Result<u32>>(1);
    let (stop_tx, stop_rx) = flume::bounded::<()>(1);
    std::thread::Builder::new()
        .name("apparent-mutter-screencast".into())
        .spawn(move || {
            let run = || -> Result<(zbus::blocking::Connection, zbus::zvariant::OwnedObjectPath, u32)> {
                let bus = zbus::blocking::Connection::session()?;
                let cast = zbus::blocking::Proxy::new(
                    &bus,
                    "org.gnome.Mutter.ScreenCast",
                    "/org/gnome/Mutter/ScreenCast",
                    "org.gnome.Mutter.ScreenCast",
                )?;
                let props: HashMap<&str, zbus::zvariant::Value> = HashMap::new();
                let session_path: zbus::zvariant::OwnedObjectPath =
                    cast.call("CreateSession", &(props,))?;
                let session = zbus::blocking::Proxy::new(
                    &bus,
                    "org.gnome.Mutter.ScreenCast",
                    session_path.clone(),
                    "org.gnome.Mutter.ScreenCast.Session",
                )?;
                let mut props: HashMap<&str, zbus::zvariant::Value> = HashMap::new();
                // 1: the pointer drawn into the frames.
                props.insert("cursor-mode", zbus::zvariant::Value::U32(1));
                props.insert("is-recording", zbus::zvariant::Value::Bool(true));
                let [x, y, w, h] = rect.map(|v| v.round() as i32);
                let stream_path: zbus::zvariant::OwnedObjectPath =
                    session.call("RecordArea", &(x, y, w, h, props))?;
                let stream = zbus::blocking::Proxy::new(
                    &bus,
                    "org.gnome.Mutter.ScreenCast",
                    stream_path,
                    "org.gnome.Mutter.ScreenCast.Stream",
                )?;
                let mut added = stream.receive_signal("PipeWireStreamAdded")?;
                session.call_method("Start", &())?;
                let node: u32 = added
                    .next()
                    .context("No stream")?
                    .body()
                    .deserialize()?;
                Ok((bus, session_path, node))
            };
            match run() {
                Ok((bus, session_path, node)) => {
                    let _ = ready_tx.send(Ok(node));
                    let _ = stop_rx.recv();
                    let _ = bus.call_method(
                        Some("org.gnome.Mutter.ScreenCast"),
                        session_path.as_str(),
                        Some("org.gnome.Mutter.ScreenCast.Session"),
                        "Stop",
                        &(),
                    );
                }
                Err(error) => {
                    let _ = ready_tx.send(Err(error));
                }
            }
        })?;
    let node = ready_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| anyhow!("GNOME's screencast didn't answer"))??;
    Ok(Stream {
        node,
        fd: None,
        rect: Some(rect),
        mapping_id: None,
        portal_monitor: false,
        stop: Some(stop_tx),
    })
}

// MARK: The ScreenCast portal

fn state_path() -> PathBuf {
    super::super::local_dir().join("portal.json")
}

fn saved_token(key: &str) -> Option<String> {
    let bytes = std::fs::read(state_path()).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value[key].as_str().map(str::to_owned)
}

fn save_token(key: &str, token: Option<&str>) {
    let path = state_path();
    let mut value: serde_json::Value = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    value[key] = token.map_or(serde_json::Value::Null, |t| t.into());
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, value.to_string());
}

/// Check returned scope before opening PipeWire or retaining the restore token.
fn validate_source_type(window: bool, actual: Option<ashpd::desktop::screencast::SourceType>) -> Result<()> {
    use ashpd::desktop::screencast::SourceType;
    let expected = if window { SourceType::Window } else { SourceType::Monitor };
    // SelectSources is a request, not proof of the compositor's actual selection.
    // In particular, the Hyprland chooser can still offer a window for Monitor.
    if let Some(actual) = actual {
        anyhow::ensure!(actual == expected,
            "The sharing portal selected {actual:?}, not {expected:?}. Choose the screen under Outputs in the sharing dialog and try again.");
    }
    Ok(())
}

/// A display (or a window, `window`) through the ScreenCast portal. The first time, the
/// desktop asks which; the answer is remembered (a restore token), so later recordings start
/// without asking.
include!("../../../../engine/recording/lifecycle/linux_portal_start.rs");

// MARK: Shortcuts

/// Binds Apparent's shortcuts with the GlobalShortcuts portal and calls `pressed` with
/// `record` or `paste` when one goes down. `Err` when the desktop has no such portal (GNOME
/// before 48), so the caller can fall back to a desktop keybinding (`bind_gnome_keybindings`).
pub fn global_shortcuts(
    record_trigger: String,
    paste_trigger: Option<String>,
    pressed: impl Fn(&str) + Send + 'static,
) -> Result<()> {
    use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
    let (ready_tx, ready_rx) = flume::bounded::<Result<()>>(1);
    std::thread::Builder::new()
        .name("apparent-global-shortcuts".into())
        .spawn(move || {
            futures_lite::future::block_on(async move {
                let setup = async {
                    let proxy = GlobalShortcuts::new().await?;
                    let session = proxy.create_session().await?;
                    let mut shortcuts = vec![
                        NewShortcut::new("record", "Record the screen, or finish recording")
                            .preferred_trigger(record_trigger.as_str()),
                    ];
                    if let Some(paste_trigger) = &paste_trigger {
                        shortcuts.push(
                            NewShortcut::new("paste", "Paste the latest capture")
                                .preferred_trigger(paste_trigger.as_str()),
                        );
                    }
                    let bound = proxy
                        .bind_shortcuts(&session, &shortcuts, None)
                        .await?
                        .response()?;
                    // Plasma 5.27 returns success with an empty list. That is not a binding:
                    // let the caller try native bindings rather than silently losing shortcuts.
                    if !shortcuts_bound(
                        paste_trigger.is_some(),
                        bound
                            .shortcuts()
                            .iter()
                            .map(|s| (s.id(), s.trigger_description())),
                    ) {
                        let _ = session.close().await;
                        bail!("The desktop did not bind both shortcuts");
                    }
                    let activated = proxy.receive_activated().await?;
                    anyhow::Ok((proxy, session, activated))
                };
                match setup.await {
                    Ok((_proxy, _session, mut activated)) => {
                        let _ = ready_tx.send(Ok(()));
                        while let Some(event) = activated.next().await {
                            pressed(event.shortcut_id());
                        }
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                    }
                }
            });
        })?;
    ready_rx
        .recv_timeout(Duration::from_secs(60))
        .map_err(|_| anyhow!("The shortcuts portal didn't answer"))?
}

/// Whether every shortcut that was requested (paste only while it is set) came back bound.

fn shortcuts_bound<'a>(
    paste: bool,
    shortcuts: impl Iterator<Item = (&'a str, &'a str)> + Clone,
) -> bool {
    let ids: &[&str] = if paste { &["record", "paste"] } else { &["record"] };
    ids.iter().all(|id| {
        shortcuts
            .clone()
            .any(|(bound, trigger)| bound == *id && !trigger.is_empty())
    })
}

/// The portal's trigger syntax for a shortcut (`ALT+SHIFT+s`), from its Carbon bits and key.
pub fn portal_trigger(carbon_modifiers: u32, key: &str) -> String {
    use crate::capture::engine::runtime::{CARBON_CMD_KEY, CARBON_CONTROL_KEY, CARBON_OPTION_KEY, CARBON_SHIFT_KEY};
    let mut parts = Vec::new();
    for (bit, name) in [
        (CARBON_CONTROL_KEY, "CTRL"),
        (CARBON_OPTION_KEY, "ALT"),
        (CARBON_SHIFT_KEY, "SHIFT"),
        (CARBON_CMD_KEY, "LOGO"),
    ] {
        if carbon_modifiers & bit != 0 {
            parts.push(name.to_owned());
        }
    }
    parts.push(key.to_ascii_lowercase());
    parts.join("+")
}

/// GNOME's keybinding syntax (`<Alt><Shift>s`).
pub fn gnome_binding(carbon_modifiers: u32, key: &str) -> String {
    use crate::capture::engine::runtime::{CARBON_CMD_KEY, CARBON_CONTROL_KEY, CARBON_OPTION_KEY, CARBON_SHIFT_KEY};
    let mut out = String::new();
    for (bit, name) in [
        (CARBON_CONTROL_KEY, "<Control>"),
        (CARBON_OPTION_KEY, "<Alt>"),
        (CARBON_SHIFT_KEY, "<Shift>"),
        (CARBON_CMD_KEY, "<Super>"),
    ] {
        if carbon_modifiers & bit != 0 {
            out.push_str(name);
        }
    }
    out.push_str(&key.to_ascii_lowercase());
    out
}

const GNOME_KEYS: &str = "org.gnome.settings-daemon.plugins.media-keys";
const GNOME_PATH: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings";

/// GNOME without the GlobalShortcuts portal (before 48): custom keyboard shortcuts in GNOME's
/// own settings (Settings › Keyboard › Custom Shortcuts lists them) that run
/// `apparent shortcut record` and `apparent shortcut paste`, which hand the press to the running app
/// (`super::ipc`). Only Apparent's own two entries are written or changed.
pub fn bind_gnome_keybindings(bindings: &[(&str, String)]) -> Result<()> {
    let exe = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .map_or_else(std::env::current_exe, Ok)?;
    let gsettings = |args: &[&str]| -> Result<String> {
        let out = std::process::Command::new("gsettings")
            .args(args)
            .output()?;
        if !out.status.success() {
            bail!(
                "gsettings {}: {}",
                args.join(" "),
                String::from_utf8_lossy(&out.stderr)
            );
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
    };
    let list = gsettings(&["get", GNOME_KEYS, "custom-keybindings"])?;
    let mut paths: Vec<String> = list
        .trim_start_matches("@as")
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(|p| p.trim().trim_matches('\'').to_owned())
        .filter(|p| !p.is_empty())
        .collect();
    for (id, binding) in bindings {
        let path = format!("{GNOME_PATH}/apparent-{id}/");
        if !paths.contains(&path) {
            paths.push(path.clone());
        }
        let schema = format!("{GNOME_KEYS}.custom-keybinding:{path}");
        let command = format!("'{}' shortcut {id}", exe.display());
        gsettings(&[
            "set",
            &schema,
            "name",
            &gvariant_string(&format!("Apparent: {id}")),
        ])?;
        gsettings(&["set", &schema, "command", &gvariant_string(&command)])?;
        gsettings(&["set", &schema, "binding", &gvariant_string(binding)])?;
    }
    let value = format!(
        "[{}]",
        paths
            .iter()
            .map(|p| format!("'{p}'"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    gsettings(&["set", GNOME_KEYS, "custom-keybindings", &value])?;
    Ok(())
}

/// A string as GVariant text, which `gsettings set` reads: `"…"` with `\\` and `"` escaped.
fn gvariant_string(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

// MARK: Keystrokes

#[path = "../../../../engine/native/input/draft_paste_portal.rs"]
mod paste;
pub(crate) use paste::{draft_paste_supported, send_paste, send_paste_checked};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::engine::runtime::{CARBON_OPTION_KEY, CARBON_SHIFT_KEY};

    #[test]
    fn an_empty_success_from_plasma_is_not_a_working_shortcut_backend() {
        let record = ("record", "Alt+Shift+S");
        let paste = ("paste", "Alt+Shift+V");
        assert!(!shortcuts_bound(true, [].into_iter()));
        assert!(!shortcuts_bound(true, [record].into_iter()));
        assert!(!shortcuts_bound(true, [record, ("paste", "")].into_iter()));
        assert!(shortcuts_bound(true, [record, paste].into_iter()));
        // A cleared paste shortcut is not requested, so only record has to come back.
        assert!(shortcuts_bound(false, [record].into_iter()));
        assert!(!shortcuts_bound(false, [].into_iter()));
    }

    #[test]
    fn shortcuts_are_written_the_way_each_desktop_reads_them() {
        let mods = CARBON_OPTION_KEY | CARBON_SHIFT_KEY;
        assert_eq!(portal_trigger(mods, "S"), "ALT+SHIFT+s");
        assert_eq!(gnome_binding(mods, "S"), "<Alt><Shift>s");
        assert_eq!(
            gvariant_string("'/a b/apparent' shortcut record"),
            "\"'/a b/apparent' shortcut record\""
        );
        assert_eq!(gvariant_string(r#"say "hi"\"#), r#""say \"hi\"\\""#);
    }
}
