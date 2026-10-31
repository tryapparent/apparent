//! What a Wayland session asks the compositor for, over D-Bus: the screen (GNOME's own
//! `org.gnome.Mutter.ScreenCast`, which records any rect of the screen without a dialog, else the
//! ScreenCast portal, which asks once and is remembered with a restore token), the shortcuts
//! (the GlobalShortcuts portal: GNOME 48+, KDE Plasma 5.27+), and keystrokes for pasting (the
//! RemoteDesktop portal, which asks once too). On X11 the recording reads the X screen directly
//! (`source_for`).

use std::collections::HashMap;
use std::os::fd::{AsRawFd, OwnedFd};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use futures_lite::StreamExt as _;

use super::media::Source;
use crate::capture::apparent_log;
use crate::model::{CaptureMode, TargetInfo};

/// A PipeWire stream a compositor is sending, open until dropped.
pub struct Stream {
    pub node: u32,
    /// The portal's PipeWire connection; Mutter's streams are on the user's own PipeWire.
    fd: Option<PortalFd>,
    /// Portal compositor coordinates, not XWayland pixels; Hyprland reports (0, 0) for
    /// every output, so do not use this to identify the selected output there.
    pub rect: Option<[f64; 4]>,
    /// The output name supplied by the portal (Hyprland reports this even when position is 0).
    pub mapping_id: Option<String>,
    monitor: bool,
    stop: Option<Arc<SessionStop>>,
}

struct SessionStop(flume::Sender<()>);

impl Drop for SessionStop {
    fn drop(&mut self) { let _ = self.0.try_send(()); }
}

impl Stream {
    /// The PipeWire fd for `pipewiresrc fd=`, or -1 for the default PipeWire.
    pub fn fd(&self) -> i32 {
        self.fd.as_ref().map_or(-1, |fd| fd.fd.as_ref().expect("held portal fd").as_raw_fd())
    }

    pub(super) fn diagnostic_media_binding(&self) {
        if let Some(fd) = &self.fd { fd.event("media_binding", serde_json::json!({"node": self.node})); }
    }
}

/// Opt-in facts only. Never serialize portal options, tokens, errors or source titles.
/// One context per authorization, shared by its requests and every remote clone.
#[derive(Clone)]
struct PortalDiagnostic(Option<Arc<(serde_json::Value, std::sync::atomic::AtomicUsize)>>);

impl PortalDiagnostic {
    fn new(connection: &zbus::Connection, session: Option<serde_json::Value>) -> Self {
        if std::env::var("APPARENT_PORTAL_DIAGNOSTICS").as_deref() != Ok("1") { return Self(None); }
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let start = std::fs::read_to_string("/proc/self/stat").ok().and_then(|s|
            s.rsplit_once(") ").and_then(|(_, fields)| fields.split_whitespace().nth(19)).map(str::to_owned));
        Self(Some(Arc::new((serde_json::json!({"schema": 1, "pid": std::process::id(),
            "start_ticks": start, "generation": NEXT.fetch_add(1, Ordering::Relaxed),
            "bus": connection.unique_name().map(|name| name.as_str()), "session": session}),
            std::sync::atomic::AtomicUsize::new(0)))))
    }

    fn event(&self, event: &str, fields: serde_json::Value) {
        if let Some(base) = &self.0 {
            let index = base.1.fetch_add(1, Ordering::Relaxed);
            if index > 256 { return; }
            let mut value = base.0.clone();
            value.as_object_mut().unwrap().extend(fields.as_object().unwrap().clone());
            value["event"] = if index == 256 { "diagnostic_truncated" } else { event }.into();
            apparent_log(format!("portal-resource {value}"));
        }
    }
}

/// Own the actual descriptor, not a raw-number proxy. Drop logs only AFTER OwnedFd drop.
struct PortalFd {
    fd: Option<OwnedFd>,
    diagnostic: PortalDiagnostic,
    binding: serde_json::Value,
}

impl PortalFd {
    fn new(fd: OwnedFd, diagnostic: PortalDiagnostic, mut binding: serde_json::Value) -> Self {
        if diagnostic.0.is_some() {
            let raw = fd.as_raw_fd();
            // Socket cookies distinguish inode reuse. Never export arbitrary /proc path targets.
            let target = std::fs::read_link(format!("/proc/self/fd/{raw}")).ok()
                .and_then(|p| p.to_str().filter(|s| s.starts_with("socket:[") && s.ends_with(']')).map(str::to_owned));
            let mut cookie: u64 = 0;
            let mut len = std::mem::size_of::<u64>() as libc::socklen_t;
            // SAFETY: both output pointers reference initialized storage of the advertised size.
            let ok = unsafe { libc::getsockopt(raw, libc::SOL_SOCKET, libc::SO_COOKIE,
                (&mut cookie as *mut u64).cast(), &mut len) } == 0 && len as usize == std::mem::size_of::<u64>();
            binding["fd"] = raw.into();
            binding["target"] = target.into();
            binding["socket_cookie"] = if ok { cookie.to_string().into() } else { serde_json::Value::Null };
            binding["identity_status"] = if binding["target"].is_string() && ok { "OBSERVED" } else { "UNKNOWN" }.into();
        }
        let owned = Self { fd: Some(fd), diagnostic, binding };
        owned.event("held_fd", serde_json::json!({}));
        owned
    }

    fn event(&self, event: &str, extra: serde_json::Value) {
        let mut binding = self.binding.clone();
        binding.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        self.diagnostic.event(event, binding);
    }

    fn try_clone(&self, node: u32, index: usize, mapping: Option<&str>, monitor: bool) -> Result<Self> {
        use sha2::{Digest, Sha256};
        let mapping_hash = mapping.filter(|_| monitor).map(|s| format!("{:x}", Sha256::digest(s.as_bytes())));
        match self.fd.as_ref().expect("held portal fd").try_clone() {
            Ok(fd) => Ok(Self::new(fd, self.diagnostic.clone(), serde_json::json!({
                "role": "stream", "clone_index": index, "parent_fd": self.fd.as_ref().unwrap().as_raw_fd(),
                "node": node, "mapping_sha256": mapping_hash, "monitor": monitor}))),
            Err(error) => {
                self.event("clone_failed", serde_json::json!({"clone_index": index, "node": node}));
                Err(error.into())
            }
        }
    }
}

impl Drop for PortalFd {
    fn drop(&mut self) {
        drop(self.fd.take());
        // This proves this producer handle was dropped, NOT plugin/backend/kernel release.
        self.event("producer_fd_dropped", serde_json::json!({}));
    }
}

/// Where to record `target` from.
pub fn source_for(target: &TargetInfo, stopping: &AtomicBool) -> Result<Source> {
    let f = target.frame;
    let rect = [f.x, f.y, f.width, f.height];
    anyhow::ensure!(target.mode != CaptureMode::Window || target.window_id.is_some(),
        "Window capture has no selected window ID");
    if !super::wayland_session() {
        return Ok(match (target.mode, target.window_id) {
            (CaptureMode::Window, Some(xid)) => Source::X11Window { xid },
            _ => Source::X11 { rect },
        });
    }
    // An X11 app's window on XWayland can be read like on X11.
    if target.mode == CaptureMode::Window
        && let Some(xid) = target.window_id
    {
        return Ok(Source::X11Window { xid });
    }
    if super::gnome() && target.mode != CaptureMode::Window {
        match mutter_area(rect) {
            Ok(session) => {
                return Ok(Source::PipeWire {
                    session,
                    crop: None,
                });
            }
            Err(error) => apparent_log(format!("GNOME screencast unavailable: {error:#}")),
        }
    }
    let window = target.mode == CaptureMode::Window;
    let monitors = if window { Vec::new() } else { super::monitors() };
    let output = if window {
        None
    } else {
        let output = selected_monitor(&monitors, target.display_id)
            .context("The selected display is no longer connected")?;
        // A connected output can still move after selection; do not use stale coordinates.
        if !target_fits_output(target.mode, rect, output.rect) {
            bail!("The selected display moved or changed; choose the target again");
        }
        Some(output)
    };
    // A token for another output must never silently override the target chosen in the picker.
    let key = screencast_key(output.map(|m| m.name.as_str()), monitors.len());
    let (session, token) = portal_screencast(window, &key, stopping)?;
    if let Some(output) = output
        && !output_still_selected(output, &super::monitors(), monitors.len())
    {
        bail!("The display layout changed while screen sharing was chosen; choose the target again");
    }
    if let Some(output) = output
        && super::hyprland()
        && monitors.len() > 1
    {
        if !selected_output_matches(&output.name, session.mapping_id.as_deref()) {
            // Discard a stale restore token too, otherwise every retry restores the wrong screen.
            save_token(&key, None);
            bail!("The sharing portal selected {:?}, not {}. Choose that screen in the sharing dialog and try again.", session.mapping_id, output.name);
        }
    }
    // Portal positions are in compositor coordinates, not XWayland pixels. Crop relative to
    // the chosen RandR output; its pixel size is the captured stream's pixel size.
    let crop_rect = if super::hyprland() {
        output.map(|m| m.rect)
    } else {
        session.rect
    };
    let crop = portal_crop(target.mode, rect, crop_rect);
    if target.mode == CaptureMode::Region && crop.is_none() {
        bail!("The selected screen does not contain the capture region (or the portal did not report its position). Choose the screen containing the region and try again.");
    }
    if !window {
        save_token(&key, token.as_deref());
    }
    Ok(Source::PipeWire { session, crop })
}

fn screencast_key(output: Option<&str>, count: usize) -> String {
    match output {
        None => "screencast-window".into(),
        Some(name) if count > 1 => format!("screencast:{name}"),
        Some(_) => "screencast".into(),
    }
}

fn selected_output_matches(name: &str, mapping_id: Option<&str>) -> bool {
    mapping_id == Some(name)
}

/// Independent sessions on XDPH; preserve multi-source sessions on other backends.
pub(crate) fn desktop_sources(displays: &[crate::model::CapturedDisplay], stopping: &AtomicBool,
    deadline: std::time::Instant, mut deliver: impl FnMut(usize, Result<Source>))
{
    if !super::wayland_session() {
        for (index, d) in displays.iter().enumerate() {
            deliver(index, Ok(Source::X11 { rect: [d.frame.x, d.frame.y, d.frame.width, d.frame.height] }));
        }
        return;
    }
    if super::hyprland() {
        use super::desktop_consent::{sequence, Failure};
        let cancelled = std::cell::Cell::new(false);
        let mut used = std::collections::HashSet::new();
        sequence(displays.len(), stopping, deadline, |index, deadline| {
            let d = &displays[index];
            let key = format!("screencast:{}", d.name);
            apparent_log(format!("Screen sharing approval {}/{}: choose monitor {}", index + 1, displays.len(), d.name));
            let result = (|| -> Result<Source> {
                let (mut streams, token) = portal_screencasts_until(false, false, &key, stopping, deadline)?;
                anyhow::ensure!(streams.len() == 1, "Expected one monitor per independent sharing session");
                let session = streams.remove(0);
                validate_desktop_source(d, session.monitor, session.mapping_id.as_deref(), &super::monitors(), &used)?;
                anyhow::ensure!(!stopping.load(Ordering::Acquire) && std::time::Instant::now() < deadline,
                    "Sharing approval arrived after Stop or the consent deadline");
                used.insert(d.name.clone());
                save_token(&key, token.as_deref());
                apparent_log(format!("Desktop monitor {} authorized as PipeWire node {} in its own session", d.name, session.node));
                Ok(Source::PipeWire { session, crop: None })
            })();
            result.map_err(|error| {
                save_token(&key, None);
                if user_cancelled(&error) { cancelled.set(true); Failure::Cancelled }
                else { Failure::Source(format!("{error:#}")) }
            })
        }, |index, result| {
            // Recheck earlier approvals after the final picker while holding their
            // independent leases. Never substitute a changed output.
            let result = result.map_err(|message| if cancelled.get() { anyhow::Error::new(SharingCancelled) } else { anyhow!(message) })
                .and_then(|source| {
                    let d = &displays[index];
                    validate_desktop_layout(d, &super::monitors())?;
                    Ok(source)
                });
            deliver(index, result);
        });
        return;
    }
    let (streams, token) = match portal_screencasts_until(false, true, "screencast-desktop", stopping, deadline) {
        Ok(result) => result,
        Err(error) => {
            let cancelled = user_cancelled(&error);
            for index in 0..displays.len() {
                deliver(index, Err(if cancelled { anyhow::Error::new(SharingCancelled) } else { anyhow!("Screen sharing: {error:#}") }));
            }
            return;
        }
    };
    save_token("screencast-desktop", token.as_deref());
    let identities: Vec<_> = streams.iter().map(|s| (s.mapping_id.as_deref(), s.rect)).collect();
    let mapping = desktop_source_indices(displays, &identities, false);
    let current = super::monitors();
    let mut streams: Vec<Option<Stream>> = streams.into_iter().map(Some).collect();
    for (i, (d, index)) in displays.iter().zip(mapping).enumerate() {
        let result = (|| -> Result<Source> {
            let index = index.map_err(|message| anyhow!(message))?;
            validate_desktop_layout(d, &current)?;
            let session = streams[index].take().expect("one portal stream per display");
            anyhow::ensure!(session.monitor, "Sharing portal did not authorize a Monitor source");
            apparent_log(format!("Desktop source {} ({}) authorized as PipeWire node {}", d.name, d.id, session.node));
            Ok(Source::PipeWire { session, crop: None })
        })();
        deliver(i, result);
    }
}

#[derive(Debug)]
struct SharingCancelled;
impl std::fmt::Display for SharingCancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("Screen sharing cancelled by user") }
}
impl std::error::Error for SharingCancelled {}

pub(crate) fn user_cancelled(error: &anyhow::Error) -> bool {
    error.is::<SharingCancelled>() || error.chain().any(|cause| matches!(cause.downcast_ref::<ashpd::Error>(),
        Some(ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled))))
}

fn validate_desktop_source(d: &crate::model::CapturedDisplay, monitor: bool, mapping: Option<&str>,
    current: &[super::Monitor], used: &std::collections::HashSet<String>) -> Result<()> {
    anyhow::ensure!(monitor, "Sharing portal did not authorize a Monitor source");
    anyhow::ensure!(mapping == Some(d.name.as_str()) && !used.contains(&d.name),
        "Sharing portal selected a wrong, missing or duplicate output; expected {}", d.name);
    validate_desktop_layout(d, current)
}

fn desktop_source_indices(displays: &[crate::model::CapturedDisplay],
    identities: &[(Option<&str>, Option<[f64; 4]>)], require_name: bool) -> Vec<Result<usize, String>> {
    let mapping: Vec<_> = displays.iter().map(|d| {
        let matches: Vec<_> = identities.iter().enumerate().filter_map(|(i, (name, rect))| {
            let matched = match name {
                Some(name) if *name == d.name => true,
                None if !require_name => *rect == Some([d.frame.x, d.frame.y, d.frame.width, d.frame.height]),
                _ => false,
            };
            matched.then_some(i)
        }).collect();
        if matches.len() == 1 { Ok(matches[0]) }
        else { Err("Display not authorized or portal source identity is ambiguous".to_owned()) }
    }).collect();
    mapping.iter().map(|result| match result {
        Ok(index) if mapping.iter().filter(|other| other.as_ref().ok() == Some(index)).count() != 1 =>
            Err("One portal stream ambiguously identifies multiple displays".into()),
        _ => result.clone(),
    }).collect()
}

fn validate_desktop_layout(d: &crate::model::CapturedDisplay, current: &[super::Monitor]) -> Result<()> {
    anyhow::ensure!(selected_monitor(current, d.id).is_some_and(|m|
        m.name == d.name && m.rect == [d.frame.x, d.frame.y, d.frame.width, d.frame.height]
            && m.scale == d.frame.scale),
        "Display changed while screen sharing was chosen");
    Ok(())
}

fn selected_monitor(monitors: &[super::Monitor], id: u32) -> Option<&super::Monitor> {
    monitors.iter().find(|m| super::monitor_id(m) == id)
}

fn output_still_selected(selected: &super::Monitor, now: &[super::Monitor], count: usize) -> bool {
    now.len() == count
        && selected_monitor(now, super::monitor_id(selected)).is_some_and(|current| {
            current.name == selected.name
                && current.rect.iter().zip(selected.rect).all(|(a, b)| (a - b).abs() <= 1.0)
        })
}

fn target_fits_output(mode: CaptureMode, target: [f64; 4], output: [f64; 4]) -> bool {
    const EPSILON: f64 = 1.0;
    match mode {
        CaptureMode::Display => target.iter().zip(output).all(|(a, b)| (a - b).abs() <= EPSILON),
        CaptureMode::Region => {
            target[0] >= output[0] - EPSILON
                && target[1] >= output[1] - EPSILON
                && target[0] + target[2] <= output[0] + output[2] + EPSILON
                && target[1] + target[3] <= output[1] + output[3] + EPSILON
        }
        CaptureMode::Window => true,
        CaptureMode::Device => false,
    }
}

fn portal_crop(mode: CaptureMode, rect: [f64; 4], stream: Option<[f64; 4]>) -> Option<[u32; 4]> {
    match (mode, stream) {
        (CaptureMode::Region, Some([sx, sy, sw, sh])) if sw > 0.0 && sh > 0.0 => {
            let left = rect[0].max(sx);
            let top = rect[1].max(sy);
            let right = (rect[0] + rect[2]).min(sx + sw);
            let bottom = (rect[1] + rect[3]).min(sy + sh);
            (right > left && bottom > top).then_some([
                (left - sx) as u32,
                (top - sy) as u32,
                (right - left) as u32,
                (bottom - top) as u32,
            ])
        }
        _ => None,
    }
}

#[cfg(test)]
mod display_tests {
    use super::*;

    #[test]
    fn desktop_post_consent_rejects_changed_frozen_identity_geometry_and_scale() {
        let monitor = super::super::Monitor { handle: 100, name: "Virtual-1".into(),
            rect: [0.0, 0.0, 1280.0, 800.0], work: [0.0, 0.0, 1280.0, 800.0], scale: 1.0, primary: true };
        let d = crate::model::CapturedDisplay { id: super::super::monitor_id(&monitor), name: monitor.name.clone(),
            frame: crate::model::TargetFrame { x: 0.0, y: 0.0, width: 1280.0, height: 800.0, scale: 1.0 },
            started_ms: None, failed_ms: None, failure: None };
        assert!(validate_desktop_layout(&d, &[monitor.clone()]).is_ok());
        for changed in 0..4 {
            let mut now = monitor.clone();
            match changed { 0 => now.handle += 1, 1 => now.name = "replacement".into(),
                2 => now.rect[0] += 100.0, _ => now.scale = 1.25 }
            assert!(validate_desktop_layout(&d, &[now]).is_err(), "changed frozen field {changed}");
        }
    }

    #[test]
    fn desktop_explicit_wrong_mapping_cannot_fall_back_to_geometry() {
        let d = crate::model::CapturedDisplay { id: 1, name: "Virtual-1".into(),
            frame: crate::model::TargetFrame { x: 0.0, y: 0.0, width: 1280.0, height: 800.0, scale: 1.0 },
            started_ms: None, failed_ms: None, failure: None };
        let rect = Some([0.0, 0.0, 1280.0, 800.0]);
        assert_eq!(desktop_source_indices(&[d.clone()], &[(None, rect)], false), vec![Ok(0)]);
        assert!(desktop_source_indices(&[d], &[(Some("different-output"), rect)], false)[0].is_err());
    }

    #[test]
    fn desktop_authorization_maps_names_not_stream_order_or_shared_positions() {
        let display = |id, name: &str| crate::model::CapturedDisplay { id, name: name.into(),
            frame: crate::model::TargetFrame { x: 0.0, y: 0.0, width: 1280.0, height: 800.0, scale: 1.0 },
            started_ms: None, failed_ms: None, failure: None };
        let a = display(11, "Virtual-1"); let b = display(22, "HEADLESS-1");
        let identities = [(Some("HEADLESS-1"), Some([0.0, 0.0, 1280.0, 800.0])),
            (Some("Virtual-1"), Some([0.0, 0.0, 1280.0, 800.0]))];
        assert_eq!(desktop_source_indices(&[a.clone(), b.clone()], &identities, true), vec![Ok(1), Ok(0)]);
        let partial = desktop_source_indices(&[a.clone(), b.clone()], &identities[..1], true);
        assert!(partial[0].is_err()); assert_eq!(partial[1], Ok(0));
        assert!(desktop_source_indices(&[a.clone()], &[(None, identities[0].1)], true)[0].is_err());
        assert!(desktop_source_indices(&[a.clone(), a.clone()], &identities, true).iter().all(Result::is_err));
        assert!(desktop_source_indices(&[a.clone()], &[identities[1], identities[1]], true)[0].is_err());
        assert!(desktop_source_indices(&[a.clone(), b], &[(None, identities[0].1)], false).iter().all(Result::is_err));
        assert_eq!(desktop_source_indices(&[a], &[(None, identities[0].1)], false), vec![Ok(0)]);
    }

    #[test]
    fn restore_tokens_are_scoped_to_the_selected_output() {
        assert_eq!(screencast_key(Some("Virtual-1"), 2), "screencast:Virtual-1");
        assert_eq!(screencast_key(Some("HEADLESS-1"), 2), "screencast:HEADLESS-1");
        assert_eq!(screencast_key(Some("Virtual-1"), 1), "screencast");
        assert_eq!(screencast_key(None, 2), "screencast-window");
    }

    #[test]
    fn portal_output_is_checked_by_name_even_when_positions_overlap() {
        assert!(selected_output_matches("HEADLESS-1", Some("HEADLESS-1")));
        assert!(!selected_output_matches("HEADLESS-1", Some("Virtual-1")));
        assert!(!selected_output_matches("HEADLESS-1", None));
    }

    #[test]
    fn a_reordered_display_id_cannot_capture_a_different_output() {
        let chosen = [1280.0, 0.0, 1920.0, 1080.0];
        assert!(target_fits_output(CaptureMode::Display, chosen, chosen));
        assert!(!target_fits_output(CaptureMode::Display, chosen, [0.0, 0.0, 1280.0, 800.0]));
        assert!(target_fits_output(CaptureMode::Region, [1480.0, 120.0, 300.0, 240.0], chosen));
        assert!(!target_fits_output(CaptureMode::Region, [1480.0, 120.0, 300.0, 240.0], [0.0, 0.0, 1280.0, 800.0]));
    }

    #[test]
    fn region_selection_keeps_its_output_after_monitors_reorder_or_overlap() {
        let monitor = |handle, name: &str| super::super::Monitor {
            handle,
            name: name.into(),
            rect: [0.0, 0.0, 1920.0, 1080.0],
            work: [0.0, 0.0, 1920.0, 1080.0],
            scale: 1.0,
            primary: false,
        };
        let selected = monitor(100, "HEADLESS-1");
        let other = monitor(101, "Virtual-1");
        let id = super::super::monitor_id(&selected);
        let reordered = [other, selected];
        assert_eq!(selected_monitor(&reordered, id).unwrap().name, "HEADLESS-1");
        assert!(selected_monitor(&reordered, 102).is_none());
        // Both rectangles contain this Region; geometry alone cannot identify its output.
        assert!(target_fits_output(CaptureMode::Region, [20.0, 20.0, 100.0, 100.0], reordered[0].rect));
    }

    #[test]
    fn portal_rejects_a_layout_change_while_the_sharing_dialog_is_open() {
        let selected = super::super::Monitor {
            handle: 100,
            name: "Virtual-1".into(),
            rect: [0.0, 0.0, 1280.0, 800.0],
            work: [0.0, 0.0, 1280.0, 800.0],
            scale: 1.0,
            primary: true,
        };
        let mut moved = selected.clone();
        moved.rect[0] = 1280.0;
        let mut replaced = selected.clone();
        replaced.handle = 101;
        assert!(output_still_selected(&selected, &[selected.clone()], 1));
        assert!(!output_still_selected(&selected, &[selected.clone(), moved.clone()], 1));
        assert!(!output_still_selected(&selected, &[selected.clone()], 2));
        assert!(!output_still_selected(&selected, &[moved], 1));
        assert!(!output_still_selected(&selected, &[replaced], 1));
    }

    #[test]
    fn a_region_on_another_output_cannot_crop_outside_the_portal_stream() {
        assert_eq!(
            portal_crop(CaptureMode::Region, [2040.0, 80.0, 420.0, 320.0], Some([0.0, 0.0, 1920.0, 1080.0])),
            None,
            "an off-stream crop yields an empty frame and a PipeWire not-negotiated error"
        );
    }

    #[test]
    fn a_region_is_trimmed_to_the_selected_stream_in_both_axes() {
        assert_eq!(
            portal_crop(CaptureMode::Region, [2080.0, 600.0, 400.0, 300.0], Some([1920.0, 0.0, 320.0, 720.0])),
            Some([160, 600, 160, 120])
        );
    }

    #[test]
    fn second_display_region_uses_the_selected_streams_origin() {
        assert_eq!(
            portal_crop(CaptureMode::Region, [2070.0, 110.0, 400.0, 250.0], Some([1920.0, 0.0, 1280.0, 720.0])),
            Some([150, 110, 400, 250])
        );
        assert_eq!(
            portal_crop(CaptureMode::Region, [2070.0, 110.0, 400.0, 250.0], None),
            None,
            "unknown stream position must not silently record a whole display"
        );
    }
}

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
        monitor: true,
        stop: Some(Arc::new(SessionStop(stop_tx))),
    })
}

// MARK: The ScreenCast portal

fn state_path() -> PathBuf {
    super::local_dir().join("portal.json")
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

/// A display (or a window, `window`) through the ScreenCast portal. The first time, the
/// desktop asks which; the answer is remembered (a restore token), so later recordings start
/// without asking.
fn portal_screencast(window: bool, key: &str, stopping: &AtomicBool) -> Result<(Stream, Option<String>)> {
    let (mut streams, token) = portal_screencasts(window, false, key, stopping)?;
    anyhow::ensure!(streams.len() == 1, "The selected-target portal returned multiple sources");
    Ok((streams.remove(0), token))
}

fn portal_screencasts(window: bool, multiple: bool, key: &str, stopping: &AtomicBool) -> Result<(Vec<Stream>, Option<String>)> {
    portal_screencasts_until(window, multiple, key, stopping, std::time::Instant::now() + Duration::from_secs(120))
}

// ashpd 0.11.1 returns Request only after Response, and Request has no Drop.
// Own its standard handle_token/path before sending on the authorization's connection.
struct OwnedPortalRequest {
    token: String,
    path: zbus::zvariant::OwnedObjectPath,
    diagnostic: PortalDiagnostic,
}

impl OwnedPortalRequest {
    fn new(connection: &zbus::Connection) -> Result<Self> {
        let token = crate::make_bundle_id().replace('-', "_");
        let sender = connection.unique_name().context("Portal connection has no unique name")?
            .trim_start_matches(':').replace('.', "_");
        let path = format!("/org/freedesktop/portal/desktop/request/{sender}/{token}").try_into()?;
        Ok(Self { token, path, diagnostic: PortalDiagnostic::new(connection, None) })
    }

    async fn perform<B: serde::Serialize + zbus::zvariant::Type>(&self, proxy: &zbus::Proxy<'_>,
        method: &str, body: &B, pending: &std::cell::RefCell<Option<zbus::zvariant::OwnedObjectPath>>) -> Result<zbus::Message> {
        let request = zbus::Proxy::new(proxy.connection(), "org.freedesktop.portal.Desktop", self.path.clone(),
            "org.freedesktop.portal.Request").await?;
        let mut responses = request.receive_signal("Response").await?;
        pending.replace(Some(self.path.clone()));
        self.diagnostic.event("request_pending", serde_json::json!({"request": self.path.as_str(), "method": method}));
        let reply = proxy.call_method(method, body).await?;
        let returned: zbus::zvariant::OwnedObjectPath = reply.body().deserialize()?;
        anyhow::ensure!(returned == self.path, "Portal returned an unexpected request identity");
        let message = responses.next().await.context("Sharing request ended without Response")?;
        let (status, _): (u32, HashMap<String, zbus::zvariant::OwnedValue>) = message.body().deserialize()?;
        pending.take(); // Response ends the request; never close an unrelated object later.
        self.diagnostic.event("request_response", serde_json::json!({"request": self.path.as_str(), "status": status}));
        match status {
            0 => Ok(message),
            1 => Err(SharingCancelled.into()),
            _ => bail!("Sharing request failed with response {status}"),
        }
    }
}

async fn cleanup_portal(request: impl std::future::Future<Output = ()>, session: impl std::future::Future<Output = ()>, budget: Duration) {
    async fn bounded(future: impl std::future::Future<Output = ()>, budget: Duration) {
        let (tx, rx) = flume::bounded::<()>(1);
        // This detached timer owns no portal/capture resources. No timer dependency added.
        if std::thread::Builder::new().name("apparent-portal-cleanup-deadline".into()).spawn(move || {
            std::thread::sleep(budget); let _ = tx.try_send(());
        }).is_err() { return; }
        futures_lite::future::race(future, async { let _ = rx.recv_async().await; }).await;
    }
    bounded(request, budget).await;
    bounded(session, budget).await;
}

async fn open_portal_remote(proxy: &zbus::Proxy<'_>, session: &zbus::zvariant::OwnedObjectPath) -> Result<OwnedFd> {
    let options = HashMap::<&str, zbus::zvariant::Value<'_>>::new();
    let fd: zbus::zvariant::OwnedFd = proxy.call("OpenPipeWireRemote", &(session, options)).await?;
    Ok(fd.into())
}

async fn close_portal_session(proxy: &zbus::Proxy<'_>, session: &zbus::zvariant::OwnedObjectPath) -> bool {
    proxy.connection().call_method(Some("org.freedesktop.portal.Desktop"), session,
        Some("org.freedesktop.portal.Session"), "Close", &()).await.is_ok()
}

fn portal_screencasts_until(window: bool, multiple: bool, key: &str, stopping: &AtomicBool,
    deadline: std::time::Instant) -> Result<(Vec<Stream>, Option<String>)> {
    use ashpd::desktop::screencast::{SourceType, Streams};
    use zbus::zvariant::Value;

    type Authorized = (u32, PortalFd, Option<[f64; 4]>, Option<String>, bool);
    let (ready_tx, ready_rx) = flume::bounded::<Result<(Vec<Authorized>, Option<String>)>>(1);
    let (stop_tx, stop_rx) = flume::bounded::<()>(1);
    let request_key = key.to_owned();
    std::thread::Builder::new()
        .name("apparent-portal-screencast".into())
        .spawn(move || {
            futures_lite::future::block_on(async move {
                let run = async {
                    // ashpd's Session constructors are private and create_session
                    // waits for Response before exposing its Request. Use the same
                    // wire protocol on a dedicated, owned zbus connection instead.
                    // Stop covers connection/proxy setup too. Disconnecting this
                    // connection after bounded cleanup also revokes late sessions.
                    let proxy = futures_lite::future::race(async {
                        let connection = zbus::Connection::session().await?;
                        let proxy = zbus::Proxy::new(&connection, "org.freedesktop.portal.Desktop",
                            "/org/freedesktop/portal/desktop", "org.freedesktop.portal.ScreenCast").await?;
                        anyhow::Ok(proxy)
                    }, async { let _ = stop_rx.recv_async().await; bail!("Sharing stopped during connection setup") }).await?;
                    let mut creation = OwnedPortalRequest::new(proxy.connection())?;
                    // The standard session_handle_token owns this exact path even
                    // before the method reply or Response arrives.
                    let session: zbus::zvariant::OwnedObjectPath = creation.path.as_str().replacen("/request/", "/session/", 1).try_into()?;
                    let diagnostic = PortalDiagnostic::new(proxy.connection(), Some(serde_json::json!(session.as_str())));
                    creation.diagnostic = diagnostic.clone();
                    let pending = std::cell::RefCell::new(None);
                    let request = async {
                        let options = HashMap::from([("handle_token", Value::from(creation.token.as_str())),
                            ("session_handle_token", Value::from(creation.token.as_str()))]);
                        let response = creation.perform(&proxy, "CreateSession", &options, &pending).await?;
                        let (_, result): (u32, HashMap<String, zbus::zvariant::OwnedValue>) = response.body().deserialize()?;
                        let handle = result.get("session_handle").context("CreateSession omitted its Session")?;
                        // xdg-desktop-portal historically returns a string, not an
                        // object path. Accept both, as installed ashpd does.
                        let returned = handle.downcast_ref::<&str>().map(str::to_owned).or_else(|_| {
                            handle.downcast_ref::<zbus::zvariant::ObjectPath<'_>>().map(|path| path.as_str().to_owned())
                        })?;
                        anyhow::ensure!(returned == session.as_str(), "Portal returned an unexpected Session identity");
                        diagnostic.event("session_created", serde_json::json!({}));
                        anyhow::ensure!(stop_rx.is_empty() && !stop_rx.is_disconnected(), "Sharing stopped before source selection");
                        let token = saved_token(&request_key);
                        let mut selection = OwnedPortalRequest::new(proxy.connection())?;
                        selection.diagnostic = diagnostic.clone();
                        let mut options = HashMap::from([
                            ("handle_token", Value::from(selection.token.as_str())),
                            ("types", Value::from(if window { 2u32 } else { 1u32 })),
                            ("cursor_mode", Value::from(2u32)), // Embedded cursor.
                            ("multiple", Value::from(multiple)),
                            ("persist_mode", Value::from(if window { 0u32 } else { 2u32 })),
                        ]);
                        if let Some(token) = token.as_deref() { options.insert("restore_token", Value::from(token)); }
                        selection.perform(&proxy, "SelectSources", &(&session, options), &pending).await?;
                        let mut start = OwnedPortalRequest::new(proxy.connection())?;
                        start.diagnostic = diagnostic.clone();
                        let options = HashMap::from([("handle_token", Value::from(start.token.as_str()))]);
                        let response = start.perform(&proxy, "Start", &(&session, "", options), &pending).await?;
                        let (_, streams): (u32, Streams) = response.body().deserialize()?;
                        let token = streams.restore_token().map(str::to_owned);
                        anyhow::ensure!(!streams.streams().is_empty(), "Nothing was shared");
                        // Each Recorder/pipewiresrc owns a protocol core. Different FD
                        // integers that dup one socket do NOT share a GStreamer core.
                        // Open a fresh authorized connection for every selected node.
                        // A distinct portal call creates the observer connection. Never
                        // duplicate the recording socket into a second protocol reader.
                        let graph = if diagnostic.0.is_some() {
                            let nodes: Vec<_> = streams.streams().iter().map(|s| s.pipe_wire_node_id()).collect();
                            let graph = match open_portal_remote(&proxy, &session).await {
                                Ok(observer) => {
                                    let mut observer = PortalFd::new(observer, diagnostic.clone(),
                                        serde_json::json!({"role": "observer"}));
                                    let (tx, rx) = flume::bounded(1);
                                    let started = std::thread::Builder::new().name("apparent-graph-probe".into())
                                        .spawn(move || {
                                            let graph = super::portal_graph::probe(observer.fd.take().unwrap(), &nodes);
                                            // The native probe has disconnected and destroyed its
                                            // core before this explanatory drop record is emitted.
                                            drop(observer);
                                            let _ = tx.send(graph);
                                        });
                                    if started.is_ok() { rx.recv_async().await.unwrap_or_else(|_| serde_json::json!({"status": "UNKNOWN"})) }
                                    else { serde_json::json!({"status": "UNKNOWN", "observer_released": true}) }
                                }
                                Err(_) => serde_json::json!({"status": "UNKNOWN", "observer_released": true}),
                            };
                            Some(graph)
                        } else { None };
                        let mut authorized = Vec::new();
                        for (index, stream) in streams.streams().iter().enumerate() {
                            let rect = match (stream.position(), stream.size()) {
                                (Some((x, y)), Some((w, h))) => Some([f64::from(x), f64::from(y), f64::from(w), f64::from(h)]),
                                _ => None,
                            };
                            let node = stream.pipe_wire_node_id();
                            let monitor = stream.source_type() == Some(SourceType::Monitor);
                            let fd = PortalFd::new(open_portal_remote(&proxy, &session).await?, diagnostic.clone(),
                                serde_json::json!({"role": "remote", "consumer_index": index, "node": node}));
                            if let Some(graph) = &graph {
                                // The observer sees all authorized nodes. Bind only this
                                // consumer's node to this recording socket in the graph join.
                                let mut graph = graph.clone();
                                if let Some(selected) = graph["selected"].as_array_mut() {
                                    selected.retain(|selected| selected["node"] == node);
                                }
                                fd.event("graph_snapshot", serde_json::json!({"graph": graph}));
                            }
                            authorized.push((node, fd.try_clone(node, index, stream.mapping_id(), monitor)?, rect, stream.mapping_id().map(str::to_owned), monitor));
                        }
                        anyhow::Ok((authorized, token))
                    };
                    let cancelled = async {
                        let _ = stop_rx.recv_async().await;
                        bail!("Screen sharing was cancelled")
                    };
                    match futures_lite::future::race(request, cancelled).await {
                        Ok((authorized, token)) => anyhow::Ok((proxy, session, authorized, token, diagnostic)),
                        Err(error) => {
                            diagnostic.event("authorization_failed", serde_json::json!({}));
                            // Return failure first; cleanup stays on this detached worker.
                            let _ = ready_tx.try_send(Err(error));
                            let path = pending.take();
                            cleanup_portal(async {
                                if let Some(path) = path {
                                    diagnostic.event("request_close_requested", serde_json::json!({"request": path.as_str()}));
                                    apparent_log(format!("Closing pending sharing Request {path}"));
                                    let result = proxy.connection().call_method(Some("org.freedesktop.portal.Desktop"), path,
                                        Some("org.freedesktop.portal.Request"), "Close", &()).await;
                                    diagnostic.event("request_close_returned", serde_json::json!({"ok": result.is_ok()}));
                                    if let Err(error) = result {
                                        apparent_log(format!("Pending sharing Request.Close failed: {error}"));
                                    }
                                }
                            }, async {
                                diagnostic.event("session_close_requested", serde_json::json!({}));
                                let ok = close_portal_session(&proxy, &session).await;
                                diagnostic.event("session_close_returned", serde_json::json!({"ok": ok}));
                            }, Duration::from_secs(1)).await;
                            Err(anyhow!("Sharing request failed; cleanup finished"))
                        }
                    }
                };
                match run.await {
                    Ok((proxy, session, authorized, token, diagnostic)) => {
                        let _ = ready_tx.try_send(Ok((authorized, token)));
                        let _ = stop_rx.recv_async().await;
                        cleanup_portal(async {}, async {
                            diagnostic.event("session_close_requested", serde_json::json!({}));
                            let ok = close_portal_session(&proxy, &session).await;
                            diagnostic.event("session_close_returned", serde_json::json!({"ok": ok}));
                        }, Duration::from_secs(1)).await;
                    }
                    Err(error) => {
                        let _ = ready_tx.try_send(Err(error));
                    }
                }
            });
        })?;
    // Every output shares this caller deadline; cleanup never delays its result.
    let lease = Arc::new(SessionStop(stop_tx));
    let (authorized, token) = wait_for_consent(ready_rx, stopping, deadline).inspect_err(|_| save_token(key, None))?;
    Ok((authorized.into_iter().map(|(node, fd, rect, mapping_id, monitor)| Stream {
        node, fd: Some(fd), rect, mapping_id, monitor, stop: Some(Arc::clone(&lease)),
    }).collect(), token))
}

// Caller-side wait never joins session.close. Dropping its lease signals detached cleanup.
fn wait_for_consent<T>(ready: flume::Receiver<Result<T>>, stopping: &AtomicBool,
    deadline: std::time::Instant) -> Result<T> {
    loop {
        anyhow::ensure!(!stopping.load(Ordering::Acquire) && std::time::Instant::now() < deadline,
            "Screen sharing was stopped or the overall consent deadline expired");
        match ready.recv_timeout(Duration::from_millis(100).min(deadline.saturating_duration_since(std::time::Instant::now()))) {
            Ok(result) => {
                anyhow::ensure!(!stopping.load(Ordering::Acquire) && std::time::Instant::now() < deadline,
                    "Sharing result arrived after Stop or the consent deadline");
                return result;
            }
            Err(flume::RecvTimeoutError::Timeout) => {},
            Err(error) => return Err(error.into()),
        }
    }
}

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
    use crate::capture::{CARBON_CMD_KEY, CARBON_CONTROL_KEY, CARBON_OPTION_KEY, CARBON_SHIFT_KEY};
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
    use crate::capture::{CARBON_CMD_KEY, CARBON_CONTROL_KEY, CARBON_OPTION_KEY, CARBON_SHIFT_KEY};
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

/// Ctrl+V (or Ctrl+Shift+V) into the focused app through the RemoteDesktop portal: Wayland lets
/// no app send another keystrokes. The desktop asks once; the answer is remembered.
pub fn send_paste(shift: bool) -> Result<()> {
    use ashpd::desktop::PersistMode;
    use ashpd::desktop::remote_desktop::{DeviceType, KeyState, RemoteDesktop};
    const CTRL: i32 = 0xffe3; // XK_Control_L
    const SHIFT: i32 = 0xffe1; // XK_Shift_L
    const V: i32 = 0x76; // XK_v
    futures_lite::future::block_on(async move {
        let proxy = RemoteDesktop::new().await?;
        let session = proxy.create_session().await?;
        let token = saved_token("remote-desktop");
        proxy
            .select_devices(
                &session,
                DeviceType::Keyboard.into(),
                token.as_deref(),
                PersistMode::ExplicitlyRevoked,
            )
            .await?;
        let started = proxy.start(&session, None).await?.response();
        let started = match started {
            Ok(started) => started,
            Err(error) => {
                save_token("remote-desktop", None);
                return Err(error.into());
            }
        };
        save_token("remote-desktop", started.restore_token());
        let mut keys = vec![CTRL];
        if shift {
            keys.push(SHIFT);
        }
        keys.push(V);
        for &key in &keys {
            proxy
                .notify_keyboard_keysym(&session, key, KeyState::Pressed)
                .await?;
        }
        for &key in keys.iter().rev() {
            proxy
                .notify_keyboard_keysym(&session, key, KeyState::Released)
                .await?;
        }
        let _ = session.close().await;
        anyhow::Ok(())
    })
}

#[cfg(test)]
#[path = "portal_tests.rs"]
mod protocol_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::{CARBON_OPTION_KEY, CARBON_SHIFT_KEY};

    #[test]
    fn independent_monitor_authorization_requires_type_identity_frozen_geometry_and_uniqueness() {
        let monitor = super::super::Monitor { handle: 7, name: "DP-7".into(), rect: [-1600.0, 0.0, 1600.0, 900.0],
            work: [-1600.0, 0.0, 1600.0, 900.0], scale: 1.0, primary: false };
        let d = crate::model::CapturedDisplay { id: 7, name: "DP-7".into(),
            frame: crate::model::TargetFrame { x: -1600.0, y: 0.0, width: 1600.0, height: 900.0, scale: 1.0 },
            started_ms: None, failed_ms: None, failure: None };
        let empty = std::collections::HashSet::new();
        assert!(validate_desktop_source(&d, true, Some("DP-7"), &[monitor.clone()], &empty).is_ok());
        for (is_monitor, name) in [(false, Some("DP-7")), (true, None), (true, Some("DP-8"))] {
            assert!(validate_desktop_source(&d, is_monitor, name, &[monitor.clone()], &empty).is_err());
        }
        assert!(validate_desktop_source(&d, true, Some("DP-7"), &[], &empty).is_err());
        assert!(validate_desktop_source(&d, true, Some("DP-7"), &[monitor.clone()], &std::collections::HashSet::from(["DP-7".into()])).is_err());
        let mut moved = monitor.clone(); moved.rect[0] += 1.0;
        assert!(validate_desktop_source(&d, true, Some("DP-7"), &[moved], &empty).is_err());
        let mut rescaled = monitor; rescaled.scale = 1.25;
        assert!(validate_desktop_source(&d, true, Some("DP-7"), &[rescaled], &empty).is_err());
    }

    #[test]
    fn owned_pending_request_is_closed_before_session_even_when_request_close_blocks() {
        use std::cell::RefCell;
        for blocked in [false, true] {
            let calls = RefCell::new(Vec::new());
            let start = std::time::Instant::now();
            futures_lite::future::block_on(cleanup_portal(async {
                calls.borrow_mut().push("Request.Close");
                if blocked { std::future::pending::<()>().await; }
            }, async {
                calls.borrow_mut().push("Session.Close");
                if blocked { std::future::pending::<()>().await; }
            }, Duration::from_millis(20)));
            assert_eq!(*calls.borrow(), vec!["Request.Close", "Session.Close"]);
            assert!(start.elapsed() < Duration::from_secs(1));
        }
    }

    #[test]
    fn consent_caller_does_not_wait_for_session_close_and_late_results_drop() {
        let (tx, rx) = flume::bounded(1);
        let (release, held) = flume::bounded::<()>(1);
        let worker = std::thread::spawn(move || {
            tx.send(Err::<(), _>(SharingCancelled.into())).unwrap();
            held.recv().unwrap(); // Stand-in for a native close that has not returned.
        });
        let start = std::time::Instant::now();
        let error = wait_for_consent(rx, &AtomicBool::new(false), start + Duration::from_secs(1)).unwrap_err();
        assert!(user_cancelled(&error));
        assert!(!worker.is_finished(), "result must precede close completion");
        assert!(start.elapsed() < Duration::from_secs(1));
        release.send(()).unwrap(); worker.join().unwrap();

        let (tx, rx) = flume::bounded::<Result<Stream>>(1);
        let start = std::time::Instant::now();
        assert!(wait_for_consent(rx, &AtomicBool::new(false), start + Duration::from_millis(30)).is_err());
        assert!(start.elapsed() < Duration::from_secs(1));
        let (stop, stopped) = flume::bounded(1);
        let late = Stream { node: 7, fd: None, rect: None, mapping_id: Some("DP-7".into()), monitor: true,
            stop: Some(Arc::new(SessionStop(stop))) };
        drop(tx.send(Ok(late))); // The disconnected receiver destroys the unauthorized lease.
        stopped.recv_timeout(Duration::from_secs(1)).unwrap();

        let (tx, rx) = flume::bounded(1);
        tx.send(Ok(7)).unwrap();
        assert!(wait_for_consent(rx, &AtomicBool::new(true), std::time::Instant::now() + Duration::from_secs(1)).is_err());
        let error: anyhow::Error = ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled).into();
        assert!(user_cancelled(&error.context("Start response")));
    }

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
