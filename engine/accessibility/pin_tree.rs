use std::collections::{HashSet, VecDeque};
use std::time::{Duration, Instant};

use super::{ACCESSIBLE, Bus, COMPONENT, DEFUNCT, EDITABLE, Object, SHOWING, VISIBLE, label_role};
use crate::shared::model::PinWindowElement;

const MAX_NODES: usize = 128;
const MAX_DEPTH: usize = 32;
const MAX_SERIALIZED_BYTES: usize = 24_000;
const MAX_LABEL_CHARS: usize = 120;
const TREE_BUDGET: Duration = Duration::from_millis(180);
const ENABLED: u32 = 1 << 8;
const SENSITIVE: u32 = 1 << 24;

struct Branch {
    object: Object,
    parent: Option<usize>,
    depth: usize,
    document: bool,
}

impl Bus {
    pub fn pin_tree(
        &self,
        root: &Object,
        title: &str,
        size: [i32; 2],
        unique_client: bool,
        browser_point: Option<(i32, i32)>,
    ) -> Option<(Vec<PinWindowElement>, bool)> {
        let accessible = self.proxy(root, ACCESSIBLE)?;
        let accessible_title: String = accessible.get_property("Name").ok()?;
        let rect = self
            .window_extents(root)
            .filter(|&[x, y, w, h]| x == 0 && y == 0 && [w, h] == size && w > 0 && h > 0);
        let matches_title = !title.is_empty() && accessible_title == title;
        if !(matches_title || unique_client && rect.is_some()) {
            return None;
        }

        let deadline = Instant::now() + TREE_BUDGET;
        let mut pending = VecDeque::new();
        let mut truncated = !self.queue_pin_children(root, None, 1, false, &mut pending);
        if let Some(point) = browser_point
            && let Some(document) = self
                .embedded_document_at(root, point)
                .or_else(|| self.documents_at_point(root, point)?.pop())
        {
            pending.push_front(Branch {
                object: document,
                parent: None,
                depth: 1,
                document: true,
            });
        }
        let mut seen = HashSet::new();
        let mut elements = Vec::new();
        let mut bytes = 2;
        while let Some(Branch {
            object,
            parent,
            depth,
            document,
        }) = pending.pop_front()
        {
            if Instant::now() >= deadline || seen.len() >= MAX_NODES {
                truncated = true;
                break;
            }
            if object.0 != root.0 || object == *root {
                truncated = true;
                continue;
            }
            if !seen.insert(object.1.clone()) {
                continue;
            }
            let Some(state) = self.state(&object) else {
                truncated = true;
                continue;
            };
            let Some(accessible) = self.proxy(&object, ACCESSIBLE) else {
                truncated = true;
                continue;
            };
            let Ok(role) = accessible.call::<_, _, String>("GetRoleName", &()) else {
                truncated = true;
                continue;
            };
            if !admit_subtree(state, &role) {
                continue;
            }
            let mut children_parent = parent;
            if admitted_role(&role) {
                let name = accessible
                    .get_property::<String>("Name")
                    .ok()
                    .and_then(|name| {
                        let (name, clipped) = clip_label(&name);
                        truncated |= clipped;
                        name
                    });
                let window_bounds = rect.and_then(|[_, _, w, h]| {
                    let bounds = self.window_extents(&object)?;
                    checked_bounds(bounds, [w, h])
                });
                let states = element_states(state, &role);
                if name.is_some() || window_bounds.is_some() || !states.is_empty() {
                    let element = PinWindowElement {
                        role,
                        name,
                        parent,
                        states,
                        window_bounds,
                    };
                    bytes += serde_json::to_vec(&element).ok()?.len() + 1;
                    if bytes > MAX_SERIALIZED_BYTES {
                        truncated = true;
                        break;
                    }
                    children_parent = Some(elements.len());
                    elements.push(element);
                }
            }
            if Instant::now() >= deadline {
                truncated = true;
                break;
            }
            truncated |= !self.queue_pin_children(
                &object,
                children_parent,
                depth + 1,
                document,
                &mut pending,
            );
        }
        if !elements.iter().any(|element| {
            element
                .window_bounds
                .is_some_and(|[x, y, _, _]| x != 0 || y != 0)
        }) {
            for element in &mut elements {
                element.window_bounds = None;
            }
        }
        (!elements.is_empty()).then_some((elements, truncated))
    }

    fn window_extents(&self, object: &Object) -> Option<[i32; 4]> {
        let (x, y, w, h) = self
            .proxy(object, COMPONENT)?
            .call("GetExtents", &(1_u32,))
            .ok()?;
        Some([x, y, w, h])
    }

    fn queue_pin_children(
        &self,
        object: &Object,
        parent: Option<usize>,
        depth: usize,
        document: bool,
        pending: &mut VecDeque<Branch>,
    ) -> bool {
        let Some(accessible) = self.proxy(object, ACCESSIBLE) else {
            return false;
        };
        let Ok(count) = accessible.get_property::<i32>("ChildCount") else {
            return false;
        };
        if count == 0 {
            return true;
        }
        let room = MAX_NODES.saturating_sub(pending.len());
        if depth > MAX_DEPTH || count < 0 || room == 0 {
            return false;
        }
        if usize::try_from(count)
            .ok()
            .is_some_and(|count| count <= MAX_NODES)
        {
            let Ok(children) = accessible.call::<_, _, Vec<Object>>("GetChildren", &()) else {
                return false;
            };
            let complete = children.len() <= room;
            queue_branches(
                pending,
                children.into_iter().take(room),
                parent,
                depth,
                document,
            );
            return complete;
        }
        let children: Vec<Object> = (0..room.min(8))
            .map_while(|index| accessible.call("GetChildAtIndex", &(index as i32,)).ok())
            .collect();
        queue_branches(pending, children.into_iter(), parent, depth, document);
        false
    }
}

fn queue_branches(
    pending: &mut VecDeque<Branch>,
    children: impl DoubleEndedIterator<Item = Object>,
    parent: Option<usize>,
    depth: usize,
    document: bool,
) {
    let branches = children.map(|object| Branch {
        object,
        parent,
        depth,
        document,
    });
    if document {
        for branch in branches.rev() {
            pending.push_front(branch);
        }
    } else {
        pending.extend(branches);
    }
}

fn admit_subtree(state: u32, role: &str) -> bool {
    state & (DEFUNCT | EDITABLE | SHOWING | VISIBLE) == SHOWING | VISIBLE
        && !matches!(
            role,
            "password text"
                | "entry"
                | "text"
                | "terminal"
                | "combo box"
                | "autocomplete"
                | "search box"
                | "spin button"
        )
}

fn admitted_role(role: &str) -> bool {
    label_role(role).is_some()
        || matches!(
            role,
            "paragraph" | "status bar" | "slider" | "progress bar" | "alert" | "switch"
        )
}

fn clip_label(raw: &str) -> (Option<String>, bool) {
    let mut chars = raw.chars().map(|ch| if ch.is_control() { ' ' } else { ch });
    let clipped: String = chars.by_ref().take(MAX_LABEL_CHARS).collect();
    let truncated = chars.next().is_some();
    let label = clipped.split_whitespace().collect::<Vec<_>>().join(" ");
    ((!label.is_empty()).then_some(label), truncated)
}

fn checked_bounds([x, y, w, h]: [i32; 4], [width, height]: [i32; 2]) -> Option<[i32; 4]> {
    (x >= 0
        && y >= 0
        && w > 0
        && h > 0
        && x.checked_add(w)? <= width
        && y.checked_add(h)? <= height)
        .then_some([x, y, w, h])
}

fn element_states(state: u32, role: &str) -> Vec<String> {
    let mut states = Vec::new();
    if label_role(role).is_some_and(|(_, kind)| matches!(kind, super::MarkRole::Control))
        && state & (ENABLED | SENSITIVE) != ENABLED | SENSITIVE
    {
        states.push("disabled".into());
    }
    if state & (1 << 4) != 0 {
        states.push("checked".into());
    } else if matches!(
        role,
        "check box" | "check menu item" | "radio button" | "radio menu item" | "switch"
    ) {
        states.push("unchecked".into());
    }
    for (flag, name) in [
        (3, "busy"),
        (5, "collapsed"),
        (10, "expanded"),
        (12, "focused"),
        (23, "selected"),
    ] {
        if state & (1 << flag) != 0 {
            states.push(name.into());
        }
    }
    states
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_visible_control_states_and_omits_sensitive_subtrees() {
        let visible = VISIBLE | SHOWING;
        assert!(admit_subtree(visible, "push button"));
        assert!(!admit_subtree(VISIBLE, "push button"));
        assert!(!admit_subtree(visible | EDITABLE, "paragraph"));
        assert!(!admit_subtree(visible, "password text"));
        assert!(!admit_subtree(visible, "terminal"));
        assert_eq!(element_states(visible, "push button"), ["disabled"]);
        assert_eq!(
            element_states(visible | ENABLED | SENSITIVE | (1 << 4), "check box"),
            ["checked"]
        );
        assert_eq!(
            clip_label("Save\n changes").0.as_deref(),
            Some("Save changes")
        );
        assert!(clip_label(&"界".repeat(121)).1);
    }

    #[test]
    fn bounds_are_window_relative_and_reject_outside_or_invalid_rectangles() {
        assert_eq!(
            checked_bounds([10, 20, 30, 40], [50, 80]),
            Some([10, 20, 30, 40])
        );
        assert_eq!(checked_bounds([10, 20, 50, 40], [50, 80]), None);
        assert_eq!(checked_bounds([-1, 20, 30, 40], [50, 80]), None);
        assert_eq!(checked_bounds([10, 20, i32::MAX, 40], [50, 80]), None);
    }
}
