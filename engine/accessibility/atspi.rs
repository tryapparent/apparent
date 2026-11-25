#[path = "pin_tree.rs"]
mod pin_tree;

use std::time::Duration;

use zbus::blocking::connection::Builder;
use zbus::blocking::fdo::DBusProxy;
use zbus::blocking::{Connection, Proxy};
use zbus::names::BusName;
use zbus::proxy::CacheProperties;
use zbus::zvariant::OwnedObjectPath;

const REQUEST: Duration = Duration::from_millis(65);
const ROOT: &str = "/org/a11y/atspi/accessible/root";
const REGISTRY: &str = "org.a11y.atspi.Registry";
const ACCESSIBLE: &str = "org.a11y.atspi.Accessible";
const COMPONENT: &str = "org.a11y.atspi.Component";
const ACTIVE: u32 = 1 << 1;
const DEFUNCT: u32 = 1 << 6;
const EDITABLE: u32 = 1 << 7;
const SHOWING: u32 = 1 << 25;
const VISIBLE: u32 = 1 << 30;
const MARK_ROLE_PRIORITY: [[bool; 4]; 4] =
    include!("../../record/media/src/assembly/target/mark-role-priority.json");

#[derive(Clone, Copy)]
enum MarkRole {
    Text = 1,
    Image = 2,
    Control = 3,
}

impl MarkRole {
    fn preferred(self, selected: Option<Self>) -> bool {
        MARK_ROLE_PRIORITY[self as usize][selected.map_or(0, |role| role as usize)]
    }
}

#[derive(Debug, PartialEq, Eq, serde::Deserialize, zbus::zvariant::Type)]
pub struct Object(String, OwnedObjectPath);

pub struct Bus(Connection);

impl Bus {
    pub fn connect() -> Option<Self> {
        let desktop = Builder::session()
            .ok()?
            .method_timeout(REQUEST)
            .build()
            .ok()?;
        let address: String = Proxy::new(&desktop, "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus")
            .ok()?
            .call("GetAddress", &())
            .ok()?;
        let connection = Builder::address(address.as_str())
            .ok()?
            .method_timeout(REQUEST)
            .build()
            .ok()?;
        Some(Self(connection))
    }

    pub fn open() -> Option<Self> {
        let bus = Self::connect()?;
        let connection = &bus.0;
        let registry =
            Proxy::new(connection, REGISTRY, "/org/a11y/atspi/registry", REGISTRY).ok()?;
        let daemon = DBusProxy::new(connection).ok()?;
        let rule = zbus::MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface("org.a11y.atspi.Event.Window")
            .ok()?
            .build();
        daemon.add_match_rule(rule).ok()?;
        for event in [
            "window:activate",
            "window:deactivate",
            "object:state-changed:active",
        ] {
            registry
                .call::<_, _, ()>("RegisterEvent", &(event, Vec::<String>::new(), ""))
                .ok()?;
        }
        drop(registry);
        drop(daemon);
        Some(bus)
    }

    fn proxy<'a>(&'a self, object: &'a Object, interface: &'static str) -> Option<Proxy<'a>> {
        zbus::blocking::proxy::Builder::new(&self.0)
            .destination(object.0.as_str())
            .ok()?
            .path(object.1.as_str())
            .ok()?
            .interface(interface)
            .ok()?
            .cache_properties(CacheProperties::No)
            .build()
            .ok()
    }

    fn state(&self, object: &Object) -> Option<u32> {
        let states: Vec<u32> = self.proxy(object, ACCESSIBLE)?.call("GetState", &()).ok()?;
        states.first().copied()
    }

    pub fn is_active(&self, object: &Object) -> bool {
        self.state(object).is_some_and(|state| {
            state & (ACTIVE | VISIBLE | SHOWING | DEFUNCT) == ACTIVE | VISIBLE | SHOWING
        })
    }

    pub fn is_showing(&self, object: &Object) -> bool {
        self.state(object).is_some_and(|state| {
            state & (VISIBLE | SHOWING | DEFUNCT) == VISIBLE | SHOWING
        })
    }

    pub fn active_tree(&self, pid: u32) -> Option<Object> {
        self.window_tree(pid, None)
    }

    pub fn window_tree(&self, pid: u32, named_visible: Option<&str>) -> Option<Object> {
        let desktop = Object(REGISTRY.into(), OwnedObjectPath::try_from(ROOT).ok()?);
        let apps: Vec<Object> = self
            .proxy(&desktop, ACCESSIBLE)?
            .call("GetChildren", &())
            .ok()?;
        let daemon = DBusProxy::new(&self.0).ok()?;
        let mut active = None;
        for app in apps.iter().take(64) {
            let name = BusName::try_from(app.0.as_str()).ok()?;
            if daemon.get_connection_unix_process_id(name).ok() != Some(pid) {
                continue;
            }
            let windows: Vec<Object> =
                self.proxy(app, ACCESSIBLE)?.call("GetChildren", &()).ok()?;
            if windows.len() > 64 {
                return None;
            }
            for tree in windows {
                if tree.0 != app.0 {
                    continue;
                }
                let accessible = self.proxy(&tree, ACCESSIBLE)?;
                let matched = match named_visible {
                    Some(title) => !title.is_empty() && self.is_showing(&tree)
                        && accessible.get_property::<String>("Name").ok().as_deref() == Some(title),
                    None => self.is_active(&tree),
                };
                if !matched {
                    continue;
                }
                let role: String = accessible.call("GetRoleName", &()).ok()?;
                drop(accessible);
                if !matches!(role.as_str(), "frame" | "window" | "dialog") {
                    continue;
                }
                if active.replace(tree).is_some() {
                    return None;
                }
            }
        }
        if apps.len() > 64 {
            return None;
        }
        active
    }

    pub fn browser_page(
        &self,
        pid: u32,
        size: [i32; 2],
        title: &str,
        point: (i32, i32),
        attribute: &str,
    ) -> Option<String> {
        let desktop = Object(REGISTRY.into(), OwnedObjectPath::try_from(ROOT).ok()?);
        let apps: Vec<Object> = self.proxy(&desktop, ACCESSIBLE)?.call("GetChildren", &()).ok()?;
        let daemon = DBusProxy::new(&self.0).ok()?;
        let mut frames = Vec::new();
        let mut named_frames = Vec::new();
        for app in apps.iter().take(64) {
            if daemon.get_connection_unix_process_id(BusName::try_from(app.0.as_str()).ok()?).ok() != Some(pid) {
                continue;
            }
            let children: Vec<Object> = self.proxy(app, ACCESSIBLE)?.call("GetChildren", &()).ok()?;
            if children.len() > 16 {
                return None;
            }
            for frame in children {
                if frame.0 != app.0 {
                    continue;
                }
                let accessible = self.proxy(&frame, ACCESSIBLE)?;
                let role: String = accessible.call("GetRoleName", &()).ok()?;
                if !matches!(role.as_str(), "frame" | "window") {
                    continue;
                }
                let (_, _, width, height): (i32, i32, i32, i32) =
                    self.proxy(&frame, COMPONENT)?.call("GetExtents", &(1_u32,)).ok()?;
                let name: String = accessible.get_property("Name").ok()?;
                drop(accessible);
                if !title.is_empty() && name == title && width > 0 && height > 0 {
                    named_frames.push(frame);
                } else if [width, height] == size {
                    frames.push(frame);
                }
            }
        }
        let candidates = if named_frames.is_empty() { &mut frames } else { &mut named_frames };
        if apps.len() > 64 || candidates.len() != 1 {
            return None;
        }
        let frame = candidates.pop()?;
        self.document_at(&frame, point, attribute)
    }

    fn document_at(&self, frame: &Object, (x, y): (i32, i32), attribute: &str) -> Option<String> {
        let mut hit: Object = self.proxy(frame, COMPONENT)?
            .call("GetAccessibleAtPoint", &(x, y, 1_u32)).ok()?;
        let mut page = None;
        for _ in 0..20 {
            if hit == *frame {
                break;
            }
            if hit.0 != frame.0 || hit.1.as_str() == "/org/a11y/atspi/null" {
                return None;
            }
            let accessible = self.proxy(&hit, ACCESSIBLE)?;
            let role: String = accessible.call("GetRoleName", &()).ok()?;
            if role == "document web" {
                page = self.document_url(&hit, attribute).or(page);
            }
            let (bus, path) = accessible.get_property::<(String, OwnedObjectPath)>("Parent").ok()?;
            drop(accessible);
            hit = Object(bus, path);
        }
        if hit != *frame {
            return None;
        }
        if page.is_some() {
            return page;
        }
        let relations: Vec<(u32, Vec<Object>)> =
            self.proxy(frame, ACCESSIBLE)?.call("GetRelationSet", &()).ok()?;
        let mut embedded = relations.into_iter().filter(|(kind, _)| *kind == 13)
            .flat_map(|(_, targets)| targets);
        let document = embedded.next()?;
        if embedded.next().is_some() || document.0 != frame.0 {
            return None;
        }
        let (left, top, width, height): (i32, i32, i32, i32) =
            self.proxy(&document, COMPONENT)?.call("GetExtents", &(1_u32,)).ok()?;
        if x < left || y < top || x >= left.saturating_add(width) || y >= top.saturating_add(height) {
            return None;
        }
        self.document_url(&document, attribute)
    }

    fn document_url(&self, document: &Object, attribute: &str) -> Option<String> {
        let raw: String = self.proxy(document, "org.a11y.atspi.Document")?
            .call("GetAttributeValue", &(attribute,)).ok()?;
        crate::shared::routing::parse_url(&raw)?;
        Some(raw)
    }

    pub fn label_at(&self, tree: &Object, (x, y): (i32, i32)) -> Option<String> {
        let mut object: Object = self
            .proxy(tree, COMPONENT)?
            .call("GetAccessibleAtPoint", &(x, y, 1_u32))
            .ok()?;
        let mut candidate: Option<(Object, &str, MarkRole)> = None;
        for _ in 0..16 {
            if object == *tree {
                let (target, role, _) = candidate?;
                let name: String = self.proxy(&target, ACCESSIBLE)?.get_property("Name").ok()?;
                return label(role, &name);
            }
            if object.0 != tree.0
                || object.1.as_str() == "/org/a11y/atspi/null"
                || self.state(&object)? & (DEFUNCT | EDITABLE) != 0
            {
                return None;
            }
            let accessible = self.proxy(&object, ACCESSIBLE)?;
            let role: String = accessible.call("GetRoleName", &()).ok()?;
            if matches!(
                role.as_str(),
                "password text" | "entry" | "text" | "terminal"
            ) {
                return None;
            }
            let (bus, path) = accessible
                .get_property::<(String, OwnedObjectPath)>("Parent")
                .ok()?;
            drop(accessible);
            if let Some((name, kind)) = label_role(&role)
                && kind.preferred(candidate.as_ref().map(|(_, _, kind)| *kind))
            {
                candidate = Some((object, name, kind));
            }
            object = Object(bus, path);
        }
        None
    }
}

fn label_role(role: &str) -> Option<(&'static str, MarkRole)> {
    Some(match role {
        "button" | "push button" | "toggle button" | "push button menu" => {
            ("button", MarkRole::Control)
        }
        "label" | "static" => ("text", MarkRole::Text),
        "check box" => ("checkbox", MarkRole::Control),
        "radio button" => ("radio button", MarkRole::Control),
        "page tab" => ("tab", MarkRole::Control),
        "menu item" | "check menu item" | "radio menu item" => ("menu item", MarkRole::Control),
        "link" => ("link", MarkRole::Control),
        "heading" => ("heading", MarkRole::Text),
        "image" => ("image", MarkRole::Image),
        "list item" => ("list item", MarkRole::Control),
        _ => return None,
    })
}

fn label(role: &str, name: &str) -> Option<String> {
    let single_line = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.is_empty() {
        return None;
    }
    let mut clipped: String = single_line.chars().take(60).collect();
    if clipped.len() < single_line.len() {
        clipped.pop();
        clipped.push('…');
    }
    Some(format!("{role} “{clipped}”"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposed_names_are_bounded_and_input_roles_are_excluded() {
        assert_eq!(
            label(label_role("push button").unwrap().0, "  Save\n now ").as_deref(),
            Some("button “Save now”")
        );
        assert!(label_role("password text").is_none());
        assert!(label_role("entry").is_none());
        assert_eq!(label("button", " "), None);
        assert_eq!(
            label("button", &"目".repeat(61)).unwrap(),
            format!("button “{}…”", "目".repeat(59))
        );
    }

    #[test]
    fn card_and_icon_controls_use_the_nearest_semantic_target() {
        let (text, text_role) = label_role("static").unwrap();
        let (image, image_role) = label_role("image").unwrap();
        let (card, card_role) = label_role("list item").unwrap();
        let (button, button_role) = label_role("push button").unwrap();
        assert_eq!((text, image), ("text", "image"));
        assert!(image_role.preferred(Some(text_role)));
        assert!(card_role.preferred(Some(image_role)));
        assert!(!card_role.preferred(Some(button_role)));
        assert_eq!(
            label(card, "Artist card — Nina Simone").as_deref(),
            Some("list item “Artist card — Nina Simone”")
        );
        assert_eq!(label(button, "Next").as_deref(), Some("button “Next”"));
        assert_eq!(label(button, ""), None);
    }
}
