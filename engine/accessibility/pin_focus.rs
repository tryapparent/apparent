use std::time::{Duration, Instant};

use serde::Deserialize;

use super::{
    Client, Events, Window, hyprland, layout_rect_in, overlaps, previous_under_overlay, read,
};

const PIN_REQUEST: Duration = Duration::from_millis(120);

pub struct PinFocus {
    pub window: Window,
    pub editor: Option<Window>,
    pub rect: [i32; 4],
    pub unique_client: bool,
}

#[derive(Deserialize)]
struct Layer {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    namespace: String,
}

#[derive(Deserialize)]
struct OutputLayers {
    levels: std::collections::HashMap<String, Vec<Layer>>,
}

type Layers = std::collections::HashMap<String, OutputLayers>;

pub fn share_picker_clear(rect: [i32; 4]) -> Option<bool> {
    Some(share_picker_clear_in(rect, &read("j/layers")?))
}

fn share_picker_clear_in(rect: [i32; 4], outputs: &Layers) -> bool {
    !outputs.values().any(|output| {
        ["2", "3"].into_iter().filter_map(|level| output.levels.get(level))
            .flatten().any(|layer| {
                matches!(layer.namespace.as_str(),
                    "ch.wysbd.hyprland-preview-share-picker" | "xdg-desktop-portal-hyprland")
                    && overlaps(rect, [layer.x, layer.y, layer.w, layer.h])
            })
    })
}

fn notes_surface(window: &Window, pid: u32) -> bool {
    window.pid == pid
        && pid != 0
        && window.identified()
        && (window.title == "Apparent notes"
            || window
                .title
                .strip_prefix("Apparent notes ")
                .is_some_and(|xid| {
                    !xid.is_empty() && xid.bytes().all(|byte| byte.is_ascii_hexdigit())
                }))
}

pub fn pin_focus(point: [i32; 4], note_pid: u32, deadline: Instant) -> Option<PinFocus> {
    let timeout = deadline.checked_duration_since(Instant::now())?.min(PIN_REQUEST);
    let reply = hyprland::request_with_timeout(
        "[[BATCH]] j/monitors;j/activewindow;j/clients;j/layers",
        timeout,
    )
    .ok()?;
    let mut parts = reply.split("\n\n\n");
    let monitors: Vec<hyprland::Monitor> = serde_json::from_str(parts.next()?).ok()?;
    let foreground: Window = serde_json::from_str(parts.next()?).ok()?;
    let clients: Vec<Client> = serde_json::from_str(parts.next()?).ok()?;
    let layers: Layers = serde_json::from_str(parts.next()?).ok()?;
    if parts.any(|part| !part.trim().is_empty()) || !foreground.identified() {
        return None;
    }
    let rect = layout_rect_in(point, &monitors)?;
    let (window, editor) = if notes_surface(&foreground, note_pid) {
        (
            previous_under_overlay(&foreground, &clients)?.clone(),
            Some(foreground),
        )
    } else if foreground.is_ink() {
        (previous_under_overlay(&foreground, &clients)?.clone(), None)
    } else {
        (foreground, None)
    };
    if window.pid == std::process::id()
        || window.pid == note_pid
        || crate::capture::ui_process::owns(window.pid as i32)
        || !window.contains(rect)
        || !window.uncovered_in(
            rect,
            |other| {
                other.is_ink()
                    || editor.as_ref().is_some_and(|editor| editor.address == other.address)
            },
            &clients,
        )?
        || !share_picker_clear_in(rect, &layers)
        || Instant::now() > deadline
    {
        return None;
    }
    let unique_client = window.pin_tree_identity(&clients)?;
    Some(PinFocus {
        window,
        editor,
        rect,
        unique_client,
    })
}

impl Window {
    pub fn size(&self) -> [i32; 2] {
        self.size
    }

    fn pin_tree_identity(&self, clients: &[Client]) -> Option<bool> {
        let mut found = false;
        let mut unique = true;
        for client in clients
            .iter()
            .filter(|client| client.window.pid == self.pid && client.mapped && !client.hidden)
        {
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
}

impl Events {
    pub fn drain_pin(&mut self, window: &Window, editor: Option<&Window>) -> Option<bool> {
        self.allowed_focus =
            editor.map(|window| window.address.trim_start_matches("0x").as_bytes().to_vec());
        let changed = self.drain_action(window);
        self.allowed_focus = None;
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_notes_surface_requires_registered_process_and_exact_title() {
        let window = |title: &str| {
            serde_json::from_value(serde_json::json!({
                "address": "0x18", "stableId": "18", "pid": 4321, "title": title,
                "at": [0, 0], "size": [50, 50], "workspace": {"id": 1}
            }))
            .unwrap()
        };
        assert!(notes_surface(&window("Apparent notes"), 4321));
        assert!(notes_surface(&window("Apparent notes 4af"), 4321));
        assert!(!notes_surface(&window("Apparent notes 4af"), 1));
        assert!(!notes_surface(
            &window("Apparent notes malicious title"),
            4321
        ));
    }

    #[test]
    fn pin_focus_events_accept_only_the_exact_owned_editor_address() {
        let (tx, rx) = std::os::unix::net::UnixStream::pair().unwrap();
        drop(tx);
        let mut events = Events::new(rx);
        events.allowed_focus = Some(b"18".to_vec());
        assert!(!events.record(b"activewindowv2>>18\n", Some(b"32")));
        assert!(!events.record(b"activewindowv2>>32\n", Some(b"32")));
        assert!(events.record(b"activewindowv2>>77\n", Some(b"32")));
        events.allowed_focus = None;
        assert!(events.record(b"activewindowv2>>18\n", Some(b"32")));
    }
}
