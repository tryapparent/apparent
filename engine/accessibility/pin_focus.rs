use super::{Client, Events, Window, previous_under_overlay, read};

pub struct PinFocus {
    pub window: Window,
    pub editor: Option<Window>,
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

pub fn pin_focus(rect: [i32; 4], note_pid: u32) -> Option<PinFocus> {
    let foreground = read::<Window>("j/activewindow")?;
    if !foreground.identified() {
        return None;
    }
    let (window, editor) = if notes_surface(&foreground, note_pid) {
        let source = previous_under_overlay(&foreground, read("j/clients")?)?;
        (source, Some(foreground))
    } else if foreground.is_ink() {
        (
            previous_under_overlay(&foreground, read("j/clients")?)?,
            None,
        )
    } else {
        (foreground, None)
    };
    (window.pid != std::process::id() && window.pid != note_pid && window.contains(rect))
        .then_some(PinFocus { window, editor })
}

impl Window {
    pub fn size(&self) -> [i32; 2] {
        self.size
    }

    pub fn pin_tree_identity(&self) -> Option<bool> {
        let clients = read::<Vec<Client>>("j/clients")?;
        let mut found = false;
        let mut unique = true;
        for client in clients
            .into_iter()
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

    pub fn pin_point_clear(&self, rect: [i32; 4], editor: Option<&Window>) -> Option<bool> {
        self.uncovered(rect, |other| {
            other.is_ink() || editor.is_some_and(|editor| editor.address == other.address)
        })
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
