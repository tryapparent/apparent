use std::io::{ErrorKind, Read};
use std::os::unix::net::UnixStream;
use std::time::Duration;

use serde::Deserialize;

use crate::capture::desktop::linux::{self, hyprland};

const REQUEST: Duration = Duration::from_millis(65);
const EVENTS_LIMIT: usize = 16_384;

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    address: String,
    #[serde(default)]
    stable_id: String,
    pub pid: u32,
    #[serde(default)]
    pub class: String,
    #[serde(default)]
    pub title: String,
    at: [i32; 2],
    size: [i32; 2],
    workspace: Workspace,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct Workspace {
    id: i64,
}

#[derive(Deserialize)]
struct Client {
    #[serde(flatten)]
    window: Window,
    mapped: bool,
    hidden: bool,
    pinned: bool,
    #[serde(default, rename = "focusHistoryID")]
    focus_history: Option<i32>,
}

pub fn focused() -> Option<Window> {
    let window = action_focused()?;
    (window.pid != std::process::id()).then_some(window)
}

pub fn action_focused() -> Option<Window> {
    let window = read::<Window>("j/activewindow")?;
    (window.identified() && !window.is_ink()).then_some(window)
}

pub fn stroke_focused() -> Option<Window> {
    let window = read::<Window>("j/activewindow")?;
    if !window.identified() {
        return None;
    }
    if !window.is_ink() {
        return Some(window);
    }
    stroke_under_ink(window, read("j/clients")?)
}

fn stroke_under_ink(ink: Window, clients: Vec<Client>) -> Option<Window> {
    if !clients.iter().any(|client| {
        client.window == ink && client.focus_history == Some(0) && client.mapped && !client.hidden
    }) {
        return None;
    }
    let mut previous = clients.into_iter().filter(|client| client.focus_history == Some(1));
    let candidate = previous.next()?;
    (previous.next().is_none()
        && candidate.mapped
        && !candidate.hidden
        && candidate.window.workspace == ink.workspace
        && candidate.window.identified()
        && !candidate.window.is_ink())
    .then_some(candidate.window)
}

pub fn focused_for_mark(rect: [i32; 4]) -> Option<Window> {
    stroke_focused().filter(|window| window.pid != std::process::id() && window.contains(rect))
}

pub fn share_picker_clear(rect: [i32; 4]) -> Option<bool> {
    #[derive(Deserialize)]
    struct Layer {
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        namespace: String,
    }
    #[derive(Deserialize)]
    struct Output {
        levels: std::collections::HashMap<String, Vec<Layer>>,
    }
    let outputs: std::collections::HashMap<String, Output> = read("j/layers")?;
    Some(!outputs.values().any(|output| {
        ["2", "3"].into_iter().filter_map(|level| output.levels.get(level))
            .flatten().any(|layer| {
                matches!(layer.namespace.as_str(),
                    "ch.wysbd.hyprland-preview-share-picker" | "xdg-desktop-portal-hyprland")
                    && overlaps(rect, [layer.x, layer.y, layer.w, layer.h])
            })
    }))
}

fn read<T: serde::de::DeserializeOwned>(request: &str) -> Option<T> {
    let output = hyprland::request_with_timeout(request, REQUEST).ok()?;
    serde_json::from_str(&output).ok()
}

pub fn layout_rect(rect: [i32; 4]) -> Option<[i32; 4]> {
    let monitors = read::<Vec<hyprland::Monitor>>("j/monitors")?;
    let outputs: Vec<_> = linux::monitors()
        .into_iter()
        .filter(|monitor| !monitor.name.is_empty() && monitor.outputs == 1)
        .map(|monitor| (monitor.name, monitor.rect))
        .collect();
    let matching = outputs
        .iter()
        .filter(|(_, [x, y, w, h])| {
            let [left, top, width, height] = rect.map(f64::from);
            left >= *x && top >= *y && left + width <= x + w && top + height <= y + h
        })
        .count();
    if matching != 1 {
        return None;
    }
    hyprland::note_rect_in_layout(rect, &monitors, &outputs)
}

impl Window {
    fn identified(&self) -> bool {
        !self.address.is_empty() && !self.stable_id.is_empty() && self.pid != 0
    }

    pub fn browser_attribute(&self) -> Option<&'static str> {
        match self.class.as_str() {
            "chromium" | "Chromium" | "google-chrome" | "Google-chrome" | "google-chrome-stable" => Some("URI"),
            "firefox" | "Firefox" | "org.mozilla.firefox" => Some("DocURL"),
            _ => None,
        }
    }

    pub fn size(&self) -> [i32; 2] {
        self.size
    }

    pub fn pin_tree_identity(&self) -> Option<bool> {
        let clients = read::<Vec<Client>>("j/clients")?;
        let mut found = false;
        let mut unique = true;
        for client in clients.into_iter().filter(|client| {
            client.window.pid == self.pid && client.mapped && !client.hidden
        }) {
            if client.window == *self {
                found = true;
            } else {
                if client.window.title == self.title {
                    return None;
                }
                unique = false;
            }
        }
        found.then_some(unique)
    }

    pub fn unique_mapped_client(&self) -> Option<([i32; 2], String)> {
        let clients = read::<Vec<Client>>("j/clients")?;
        let mut windows = clients.iter().filter(|client| client.window.pid == self.pid && client.mapped);
        let only = windows.next()?;
        (only.window.address == self.address && windows.next().is_none())
            .then(|| (self.size, only.window.title.clone()))
    }

    pub fn point(&self, x: f64, y: f64) -> Option<([i32; 4], (i32, i32))> {
        let rect = layout_rect([x.floor() as i32, y.floor() as i32, 1, 1])?;
        self.contains(rect).then(|| (rect, (rect[0] - self.at[0], rect[1] - self.at[1])))
    }

    fn is_ink(&self) -> bool {
        self.pid == std::process::id() && self.title.starts_with("Apparent Ink ")
    }

    pub fn action_id(&self) -> String {
        format!("hyprland:{}:{}", self.pid, self.stable_id)
    }

    pub fn overlaps(&self, rect: [i32; 4]) -> bool {
        overlaps(rect, [self.at[0], self.at[1], self.size[0], self.size[1]])
    }

    pub fn action_uncovered(&self, rect: [i32; 4]) -> Option<bool> {
        self.uncovered(rect, |client| client.is_ink())
    }


    pub fn contains(&self, rect: [i32; 4]) -> bool {
        let [x, y, w, h] = rect.map(i64::from);
        let [left, top] = self.at.map(i64::from);
        let [width, height] = self.size.map(i64::from);
        w > 0 && h > 0 && x >= left && y >= top && x + w <= left + width && y + h <= top + height
    }

    pub fn is_uncovered(&self, rect: [i32; 4]) -> Option<bool> {
        let mut region = rect;
        if underline(rect) {
            region[1] = rect[1].checked_sub(8)?;
            region[3] = rect[3].checked_add(8)?;
        }
        self.uncovered(region, |client| client.pid == std::process::id())
    }

    fn uncovered(&self, region: [i32; 4], ignore: impl Fn(&Window) -> bool) -> Option<bool> {
        let clients = read::<Vec<Client>>("j/clients")?;
        if !clients
            .iter()
            .any(|client| client.window.address == self.address && client.mapped && !client.hidden)
        {
            return None;
        }
        let covered = clients.iter().any(|client| {
            client.window.address != self.address
                && !ignore(&client.window)
                && client.mapped
                && !client.hidden
                && (client.window.workspace == self.workspace || client.pinned)
                && client.window.overlaps(region)
        });
        Some(!covered)
    }

    pub fn mark_point(&self, rect: [i32; 4]) -> Option<(i32, i32)> {
        let [x, y, width, height] = rect;
        let x = x.checked_add(width / 2)?;
        let y = y.checked_add(if underline(rect) { -8 } else { height / 2 })?;
        if !self.contains([x, y, 1, 1]) {
            return None;
        }
        Some((x.checked_sub(self.at[0])?, y.checked_sub(self.at[1])?))
    }
}

fn underline([_, _, width, height]: [i32; 4]) -> bool {
    height < 24 && i64::from(width) > 3 * i64::from(height)
}

fn overlaps(a: [i32; 4], b: [i32; 4]) -> bool {
    let [x, y, w, h] = a.map(i64::from);
    let [left, top, width, height] = b.map(i64::from);
    width > 0 && height > 0 && x < left + width && left < x + w && y < top + height && top < y + h
}

pub struct Events {
    stream: UnixStream,
    partial: Vec<u8>,
    ink_title_prefix: String,
    ink_focused: bool,
    watch_title: bool,
}

impl Events {
    pub fn open() -> Option<Self> {
        let stream = UnixStream::connect(hyprland::instance_dir()?.join(".socket2.sock")).ok()?;
        stream.set_nonblocking(true).ok()?;
        Some(Self::new(stream))
    }

    fn new(stream: UnixStream) -> Self {
        Self {
            stream,
            partial: Vec::new(),
            ink_title_prefix: format!("Apparent,Apparent Ink {} ", std::process::id()),
            ink_focused: false,
            watch_title: false,
        }
    }

    pub fn drain_action(&mut self, window: &Window) -> Option<bool> {
        self.watch_title = true;
        let changed = self.drain(Some(window));
        self.watch_title = false;
        changed
    }

    pub fn drain(&mut self, window: Option<&Window>) -> Option<bool> {
        let mut buffer = [0; 1024];
        let mut total = self.partial.len();
        let mut changed = false;
        let address = window.map(|w| w.address.trim_start_matches("0x").as_bytes());
        loop {
            match self.stream.read(&mut buffer) {
                Ok(0) => return None,
                Ok(n) => {
                    total += n;
                    changed |= self.record(&buffer[..n], address);
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => return Some(changed),
                Err(_) => return None,
            }
            if total >= EVENTS_LIMIT {
                return None;
            }
        }
    }

    fn record(&mut self, bytes: &[u8], address: Option<&[u8]>) -> bool {
        let mut changed = false;
        for line in bytes.split_inclusive(|&byte| byte == b'\n') {
            self.partial.extend_from_slice(line);
            if let Some(event) = self.partial.strip_suffix(b"\n") {
                if let Some(active) = event.strip_prefix(b"activewindow>>") {
                    self.ink_focused = active.starts_with(self.ink_title_prefix.as_bytes());
                } else if let Some(active) = event.strip_prefix(b"activewindowv2>>") {
                    changed |= !std::mem::take(&mut self.ink_focused) && Some(active) != address;
                } else {
                    changed |= changes_layout(event) || (self.watch_title && address.is_some_and(|address| {
                        event.strip_prefix(b"windowtitlev2>>")
                            .and_then(|rest| rest.split(|&c| c == b',').next()) == Some(address)
                        || event.strip_prefix(b"windowtitle>>") == Some(address)
                        || event.strip_prefix(b"closewindow>>") == Some(address)
                    }));
                }
                self.partial.clear();
            }
        }
        changed
    }
}

fn changes_layout(line: &[u8]) -> bool {
    let Some(end) = line.windows(2).position(|pair| pair == b">>") else {
        return false;
    };
    matches!(
        &line[..end],
        b"workspacev2"
            | b"focusedmon"
            | b"activespecialv2"
            | b"monitoraddedv2"
            | b"monitorremoved"
            | b"configreloaded"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_unique_visible_previous_focus_can_supply_ink_context() {
        let ink = serde_json::json!({
            "address": "0x123", "stableId": "123", "pid": std::process::id(),
            "title": format!("Apparent Ink {} Draw", std::process::id()),
            "at": [0, 0], "size": [1280, 800], "workspace": {"id": 1}
        });
        let resolve = |updates: serde_json::Value| {
            let mut overlay = ink.clone();
            overlay["mapped"] = true.into();
            overlay["hidden"] = false.into();
            overlay["pinned"] = false.into();
            overlay["focusHistoryID"] = 0.into();
            let mut target = serde_json::json!({
                "address": "0x321", "stableId": "321", "pid": 55, "class": "firefox",
                "title": "Synthetic heading", "at": [20, 20], "size": [800, 600],
                "workspace": {"id": 1}, "mapped": true, "hidden": false,
                "pinned": false, "focusHistoryID": 1
            });
            target.as_object_mut().unwrap().extend(updates.as_object().unwrap().clone());
            stroke_under_ink(
                serde_json::from_value(ink.clone()).unwrap(),
                serde_json::from_value(serde_json::json!([overlay, target])).unwrap(),
            )
        };
        assert_eq!(resolve(serde_json::json!({})).unwrap().title, "Synthetic heading");
        for changes in [
            serde_json::json!({"hidden": true}),
            serde_json::json!({"workspace": {"id": 2}}),
            serde_json::json!({"focusHistoryID": -1}),
            serde_json::json!({"stableId": ""}),
        ] {
            assert!(resolve(changes).is_none());
        }
    }

    #[test]
    fn drawing_overlay_events_do_not_invalidate_focus() {
        let (stream, _) = UnixStream::pair().unwrap();
        let mut events = Events::new(stream);
        let original: Option<&[u8]> = Some(b"18");
        let ink = format!("activewindow>>{}Draw\nactivewin", events.ink_title_prefix);
        assert!(!events.record(ink.as_bytes(), original));
        assert!(!events.record(
            b"dowv2>>99\nactivewindowv2>>18\nclosewindow>>99\n",
            original
        ));
        assert!(events.record(b"activewindowv2>>21\nactivewindowv2>>18\n", original));
    }

    #[test]
    fn action_witness_rejects_tab_title_changes_and_closed_windows() {
        let (stream, _) = UnixStream::pair().unwrap();
        let mut events = Events::new(stream);
        events.watch_title = true;
        assert!(!events.record(b"windowtitlev2>>21,Other tab\n", Some(b"18")));
        assert!(events.record(b"windowtitlev2>>18,New tab\n", Some(b"18")));
        assert!(events.record(b"closewindow>>18\n", Some(b"18")));
    }

    #[test]
    fn marked_stroke_stays_inside_focus_and_underline_probes_above_ink() {
        let window = Window {
            address: "0xabc".into(),
            stable_id: "42".into(),
            pid: 101,
            class: String::new(),
            title: String::new(),
            at: [647, 38],
            size: [621, 750],
            workspace: Workspace { id: 1 },
        };
        assert!(window.contains([757, 200, 100, 60]));
        assert!(!window.contains([620, 200, 100, 60]));
        assert_eq!(window.mark_point([757, 200, 100, 60]), Some((160, 192)));
        assert_eq!(window.mark_point([757, 200, 100, 6]), Some((160, 154)));
        assert_eq!(window.mark_point([757, 40, 100, 6]), None);
        assert!(overlaps([757, 200, 100, 60], [800, 215, 60, 70]));
        assert!(!overlaps([757, 200, 100, 60], [857, 215, 60, 70]));
    }
}
