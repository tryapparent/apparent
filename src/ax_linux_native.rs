//! XEmbed bridge and guarded AT-SPI traversal for Linux nearby labels.
//! The X property is source-valued, mutable same-user data, not authentication.
use crate::model::TargetFrame;
use std::collections::HashSet;
use std::time::{Duration, Instant};
use x11rb::connection::Connection as _;
use x11rb::protocol::shape::ConnectionExt as _;
use x11rb::protocol::xproto::{
    ChangeWindowAttributesAux, ConnectionExt as _, EventMask, MapState, WindowClass,
};
use x11rb::rust_connection::RustConnection;
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::OwnedObjectPath;

#[path = "ax_linux_x11.rs"]
pub(super) mod x11;
type NativeConnection = RustConnection<x11::DeadlineStream>;

type Result<T> = std::result::Result<T, &'static str>;
type Ref = (String, OwnedObjectPath);
const ACCESSIBLE: &str = "org.a11y.atspi.Accessible";
const BUDGET: Duration = Duration::from_millis(350);
const CALL_TIMEOUT: Duration = Duration::from_millis(50);
// AT-SPI enums (at-spi2-core atspi/atspi-constants.h).
const LABEL: u32 = 29;
const FILLER: u32 = 20;
const PASSWORD: u32 = 40;
const EDITABLE: u32 = 7;
const SHOWING: u32 = 25;
const VISIBLE: u32 = 30;

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}
impl Rect {
    fn valid(self) -> bool {
        [self.x, self.y, self.w, self.h]
            .iter()
            .all(|x| x.is_finite())
            && self.w > 0.
            && self.h > 0.
    }
    fn contains(self, x: f64, y: f64) -> bool {
        self.valid() && x >= self.x && y >= self.y && x < self.x + self.w && y < self.y + self.h
    }
    fn encloses(self, b: Self) -> bool {
        self.valid()
            && b.valid()
            && b.x >= self.x
            && b.y >= self.y
            && b.x + b.w <= self.x + self.w
            && b.y + b.h <= self.y + self.h
    }
    fn intersects(self, b: Self) -> bool {
        self.x < b.x + b.w && b.x < self.x + self.w && self.y < b.y + b.h && b.y < self.y + self.h
    }
    fn distance(self, x: f64, y: f64) -> f64 {
        (self.x - x)
            .max(0.)
            .max(x - self.x - self.w)
            .hypot((self.y - y).max(0.).max(y - self.y - self.h))
    }
    fn intersection(self, b: Self) -> Self {
        let x = self.x.max(b.x);
        let y = self.y.max(b.y);
        Self {
            x,
            y,
            w: (self.x + self.w).min(b.x + b.w) - x,
            h: (self.y + self.h).min(b.y + b.h) - y,
        }
    }
}
fn parse_bridge(bytes: &[u8]) -> Result<Ref> {
    let text = std::str::from_utf8(bytes).map_err(|_| "bridge-format")?;
    if !text.starts_with(':') || text.contains('\0') || text.len() > 512 {
        return Err("bridge-format");
    }
    let split = text[1..].find(':').ok_or("bridge-format")? + 1;
    let (bus, path) = text.split_at(split);
    zbus::names::UniqueName::try_from(bus).map_err(|_| "bridge-format")?;
    let path = OwnedObjectPath::try_from(&path[1..]).map_err(|_| "bridge-format")?;
    Ok((bus.into(), path))
}

pub struct Snapshot {
    conn: NativeConnection,
    wrapper: Ref,
    viewport: Rect,
    frame: Rect,
    blockers: Vec<Rect>,
    x: f64,
    y: f64,
    at: Instant,
}
struct Grab<'a>(&'a NativeConnection);
impl Drop for Grab<'_> {
    fn drop(&mut self) {
        let _ = self.0.ungrab_server();
        let _ = self.0.flush();
    }
}
impl Snapshot {
    pub fn take(
        x: f64,
        y: f64,
        frame: TargetFrame,
        excluded: &[u32],
        passthrough: &[u32],
    ) -> Result<Self> {
        if crate::linux::wayland_session() {
            return Err("wayland-native-occlusion-unavailable");
        }
        let frame = Rect {
            x: frame.x,
            y: frame.y,
            w: frame.width,
            h: frame.height,
        };
        if !frame.contains(x, y) {
            return Err("outside-capture");
        }
        let at = Instant::now();
        let (conn, screen) = x11::connect(at + Duration::from_millis(75))?;
        let root = conn.setup().roots[screen].root;
        let atom = conn
            .intern_atom(false, b"_XEMBED_AT_SPI_PATH")
            .map_err(|_| "x11-query")?
            .reply()
            .map_err(|_| "x11-query")?
            .atom;
        conn.grab_server()
            .map_err(|_| "x11-query")?
            .check()
            .map_err(|_| "x11-query")?;
        let guard = Grab(&conn);
        let mut window = root;
        let mut viewport = frame;
        let mut blockers = Vec::new();
        let mut bridge = None;
        let mut queries = 0;
        for depth in 0..16 {
            if at.elapsed() > Duration::from_millis(75) {
                return Err("native-budget");
            }
            // Watch every ancestor for reparent, replacement, restacking and newly mapped blockers.
            conn.change_window_attributes(
                window,
                &ChangeWindowAttributesAux::new().event_mask(
                    EventMask::STRUCTURE_NOTIFY
                        | EventMask::SUBSTRUCTURE_NOTIFY
                        | EventMask::PROPERTY_CHANGE,
                ),
            )
            .map_err(|_| "x11-query")?
            .check()
            .map_err(|_| "x11-query")?;
            if window != root {
                conn.shape_select_input(window, true)
                    .map_err(|_| "shape-unavailable")?
                    .check()
                    .map_err(|_| "shape-unavailable")?;
                let shape = conn
                    .shape_query_extents(window)
                    .map_err(|_| "shape-unavailable")?
                    .reply()
                    .map_err(|_| "shape-unavailable")?;
                if shape.bounding_shaped {
                    return Err("nonrectangular-native-path");
                }
            }
            if excluded.contains(&window) && !passthrough.contains(&window) {
                return Err("excluded-window");
            }
            if window != root {
                let property = conn
                    .get_property(false, window, atom, atom, 0, 129)
                    .map_err(|_| "x11-query")?
                    .reply()
                    .map_err(|_| "x11-query")?;
                if property.type_ != 0 {
                    if property.type_ != atom || property.format != 8 || property.bytes_after != 0 {
                        return Err("bridge-format");
                    }
                    // More than one bridge in a native path is not this narrow contract.
                    if bridge.is_some() {
                        return Err("ambiguous-bridge");
                    }
                    bridge = Some((parse_bridge(&property.value)?, viewport));
                }
            }
            let children = conn
                .query_tree(window)
                .map_err(|_| "x11-query")?
                .reply()
                .map_err(|_| "x11-query")?
                .children;
            if children.len() > 128 {
                return Err("native-tree-limit");
            }
            let mut next = None;
            for child in children.into_iter().rev() {
                queries += 1;
                if queries > 256 || at.elapsed() > Duration::from_millis(75) {
                    return Err("native-budget");
                }
                if passthrough.contains(&child) {
                    continue;
                }
                let attrs = conn
                    .get_window_attributes(child)
                    .map_err(|_| "x11-query")?
                    .reply()
                    .map_err(|_| "x11-query")?;
                if attrs.map_state != MapState::VIEWABLE || attrs.class == WindowClass::INPUT_ONLY {
                    continue;
                }
                let geo = conn
                    .get_geometry(child)
                    .map_err(|_| "x11-query")?
                    .reply()
                    .map_err(|_| "x11-query")?;
                let pos = conn
                    .translate_coordinates(child, root, 0, 0)
                    .map_err(|_| "x11-query")?
                    .reply()
                    .map_err(|_| "x11-query")?;
                let border = f64::from(geo.border_width);
                let rect = Rect {
                    x: f64::from(pos.dst_x) - border,
                    y: f64::from(pos.dst_y) - border,
                    w: f64::from(geo.width) + 2. * border,
                    h: f64::from(geo.height) + 2. * border,
                };
                if bridge.is_some() {
                    // No native/accessibility join exists for an InputOutput child of the plug.
                    // Keep all such children as visual blockers, including those below the point.
                    if rect.contains(x, y) {
                        return Err("native-child-at-point");
                    }
                    blockers.push(rect);
                    continue;
                }
                if rect.contains(x, y) {
                    next = Some((child, rect));
                    break;
                }
                // Bounds are conservative visual blockers; input shape is deliberately never read.
                blockers.push(rect);
            }
            match next {
                Some((child, rect)) => {
                    window = child;
                    viewport = viewport.intersection(rect);
                }
                None => break,
            }
            if depth == 15 {
                return Err("native-depth-limit");
            }
        }
        let (wrapper, plug_viewport) = bridge.ok_or("no-xembed-accessibility-bridge")?;
        // Only the explicit bridge root receives native bounds; child nodes supply their own.
        viewport = viewport.intersection(plug_viewport);
        drop(guard);
        conn.get_input_focus()
            .map_err(|_| "x11-query")?
            .reply()
            .map_err(|_| "x11-query")?;
        if conn.poll_for_event().map_err(|_| "x11-query")?.is_some() {
            return Err("native-changed");
        }
        if at.elapsed() >= Duration::from_millis(75) {
            return Err("native-budget");
        }
        // Acquisition (including ungrab/barrier) was bounded at 75 ms. All
        // later event barriers share the original event's total 350 ms budget.
        conn.stream().set_deadline(at + BUDGET);
        Ok(Self {
            conn,
            wrapper,
            viewport,
            frame,
            blockers,
            x,
            y,
            at,
        })
    }
    pub(super) fn unchanged(&self) -> Result<()> {
        if self.at.elapsed() >= BUDGET {
            return Err("lookup-budget");
        }
        // Round-trip barrier flushes structure/property events before inspecting this dedicated queue.
        self.conn
            .get_input_focus()
            .map_err(|_| "x11-query")?
            .reply()
            .map_err(|_| "x11-query")?;
        if self
            .conn
            .poll_for_event()
            .map_err(|_| "x11-query")?
            .is_some()
        {
            Err("native-changed")
        } else if self.at.elapsed() >= BUDGET {
            Err("lookup-budget")
        } else {
            Ok(())
        }
    }
    fn visible_rect(&self, rect: Rect) -> bool {
        visible_rect(self.frame, self.viewport, &self.blockers, rect)
    }
    pub fn lookup(&self, current: &(impl Fn() -> bool + ?Sized)) -> Result<String> {
        if !current() {
            return Err("cancelled");
        }
        self.unchanged()?;
        let session = zbus::blocking::connection::Builder::session()
            .map_err(|_| "accessibility-bus-unavailable")?
            .method_timeout(CALL_TIMEOUT)
            .build()
            .map_err(|_| "accessibility-bus-unavailable")?;
        let address: String = Proxy::new(&session, "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus")
            .map_err(|_| "accessibility-bus-unavailable")?
            .call("GetAddress", &())
            .map_err(|_| "accessibility-bus-unavailable")?;
        let bus = zbus::blocking::connection::Builder::address(address.as_str())
            .map_err(|_| "accessibility-bus-unavailable")?
            .method_timeout(CALL_TIMEOUT)
            .build()
            .map_err(|_| "accessibility-bus-unavailable")?;
        let mut tree = Tree {
            bus: &bus,
            calls: 0,
            at: self.at,
            current,
            wrapper: &self.wrapper,
            wrapper_rect: self.viewport,
        };
        let text = nearby(
            &mut tree,
            &self.wrapper,
            self.x,
            self.y,
            &|r| self.visible_rect(r),
            &|| self.unchanged(),
        )?;
        if !current() {
            return Err("cancelled");
        }
        self.unchanged()?;
        if self.at.elapsed() > BUDGET {
            return Err("lookup-budget");
        }
        Ok(text)
    }
}

fn visible_rect(frame: Rect, viewport: Rect, blockers: &[Rect], rect: Rect) -> bool {
    frame.encloses(rect) && viewport.encloses(rect) && !blockers.iter().any(|b| b.intersects(rect))
}

#[derive(Clone)]
struct Meta {
    role: u32,
    states: Vec<u32>,
    parent: Ref,
    rect: Rect,
}
impl Meta {
    fn safe(&self) -> bool {
        !matches!(self.role, PASSWORD | 11 | 60 | 61 | 79)
            && !state(&self.states, EDITABLE)
            && state(&self.states, SHOWING)
            && state(&self.states, VISIBLE)
    }
}
fn state(states: &[u32], index: u32) -> bool {
    states
        .get((index / 32) as usize)
        .is_some_and(|s| s & (1 << (index % 32)) != 0)
}
trait AccessibleTree {
    fn meta(&mut self, node: &Ref) -> Result<Meta>;
    fn children(&mut self, node: &Ref) -> Result<Vec<Ref>>;
    fn name(&mut self, node: &Ref) -> Result<String>;
}
struct Tree<'a, F: ?Sized> {
    bus: &'a Connection,
    calls: usize,
    at: Instant,
    current: &'a F,
    wrapper: &'a Ref,
    wrapper_rect: Rect,
}
impl<F: Fn() -> bool + ?Sized> Tree<'_, F> {
    fn proxy<'a>(&'a mut self, node: &'a Ref, interface: &'static str) -> Result<Proxy<'a>> {
        self.calls += 1;
        if self.calls > 192 || self.at.elapsed() > BUDGET {
            return Err("lookup-budget");
        }
        if !(self.current)() {
            return Err("cancelled");
        }
        // No GetAll/property cache: it could fetch private Name before the policy gate.
        zbus::blocking::proxy::Builder::new(self.bus)
            .destination(node.0.as_str())
            .map_err(|_| "accessible-unavailable")?
            .path(node.1.as_str())
            .map_err(|_| "accessible-unavailable")?
            .interface(interface)
            .map_err(|_| "accessible-unavailable")?
            .cache_properties(zbus::proxy::CacheProperties::No)
            .build()
            .map_err(|_| "accessible-unavailable")
    }
}
impl<F: Fn() -> bool + ?Sized> AccessibleTree for Tree<'_, F> {
    fn meta(&mut self, node: &Ref) -> Result<Meta> {
        let role = self
            .proxy(node, ACCESSIBLE)?
            .call("GetRole", &())
            .map_err(|_| "accessible-unavailable")?;
        let states = self
            .proxy(node, ACCESSIBLE)?
            .call("GetState", &())
            .map_err(|_| "accessible-unavailable")?;
        let parent = self
            .proxy(node, ACCESSIBLE)?
            .get_property("Parent")
            .map_err(|_| "accessible-unavailable")?;
        // Geometry is not text. Read no Name/Description/Value/Text until all guards pass.
        let (x, y, w, h): (i32, i32, i32, i32) = if node == self.wrapper {
            // AtkPlug has an empty Component vtable. The property directly joins this root.
            return Ok(Meta {
                role,
                states,
                parent,
                rect: self.wrapper_rect,
            });
        } else {
            self.proxy(node, "org.a11y.atspi.Component")?
                .call("GetExtents", &(0u32,))
                .map_err(|_| "bounds-unavailable")?
        };
        Ok(Meta {
            role,
            states,
            parent,
            rect: Rect {
                x: x.into(),
                y: y.into(),
                w: w.into(),
                h: h.into(),
            },
        })
    }
    fn children(&mut self, node: &Ref) -> Result<Vec<Ref>> {
        let count: i32 = self
            .proxy(node, ACCESSIBLE)?
            .get_property("ChildCount")
            .map_err(|_| "accessible-unavailable")?;
        if !(0..=48).contains(&count) {
            return Err("tree-limit");
        }
        let mut children = Vec::new();
        // GetChildAtIndex bounds replies; no unbounded GetChildren allocation.
        for i in 0..count {
            children.push(
                self.proxy(node, ACCESSIBLE)?
                    .call("GetChildAtIndex", &(i,))
                    .map_err(|_| "accessible-unavailable")?,
            );
        }
        Ok(children)
    }
    fn name(&mut self, node: &Ref) -> Result<String> {
        self.proxy(node, ACCESSIBLE)?
            .get_property("Name")
            .map_err(|_| "accessible-unavailable")
    }
}
fn same_bus(node: &Ref, wrapper: &Ref) -> Result<()> {
    if node.0 != wrapper.0 {
        Err("foreign-accessible")
    } else {
        Ok(())
    }
}
// The property names an AtkPlug (FILLER), not an application or registry frame.
// Its parent may be the foreign embedding socket. Never leave the explicitly joined
// wrapper: all descendant paths must terminate at it before any content getter.
fn ancestors(tree: &mut impl AccessibleTree, wrapper: &Ref) -> Result<()> {
    let meta = tree.meta(wrapper)?;
    if meta.role != FILLER || !meta.safe() {
        return Err("private-or-hidden-wrapper");
    }
    Ok(())
}
fn nearby(
    tree: &mut impl AccessibleTree,
    wrapper: &Ref,
    x: f64,
    y: f64,
    visible: &impl Fn(Rect) -> bool,
    native: &impl Fn() -> Result<()>,
) -> Result<String> {
    native()?;
    ancestors(tree, wrapper)?;
    let mut pending = vec![(wrapper.clone(), None, 0)];
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    let mut parents = std::collections::HashMap::new();
    while let Some((node, parent, depth)) = pending.pop() {
        same_bus(&node, wrapper)?;
        if depth > 12 || seen.len() >= 48 || !seen.insert(node.clone()) {
            return Err("tree-limit");
        }
        let meta = tree.meta(&node)?;
        if parent.as_ref().is_some_and(|p| p != &meta.parent) {
            return Err("ancestry-changed");
        }
        parents.insert(node.clone(), meta.parent.clone());
        // A rejected branch is never traversed or named. Hidden/foreign data cannot leak via a parent.
        if !meta.safe() {
            if meta.rect.contains(x, y) {
                return Err("private-or-hidden-target");
            }
            continue;
        }
        if !visible(meta.rect) {
            continue;
        }
        native()?;
        let children = tree.children(&node)?;
        if meta.role == LABEL && children.is_empty() {
            candidates.push((meta.rect.distance(x, y), node.clone()));
        }
        // A composite label's Name could include an editable descendant's content.
        // Only leaf labels may supply content, even when the composite reports noneditable.
        for child in children {
            pending.push((child, Some(node.clone()), depth + 1));
        }
    }

    candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
    let Some((distance, node)) = candidates.first() else {
        return Err("no-visible-label");
    };
    if *distance > 48. {
        return Err("no-nearby-label");
    }
    if candidates
        .get(1)
        .is_some_and(|other| other.0 - distance < 4.)
    {
        return Err("ambiguous-label");
    }
    native()?;
    // Recheck the selected node's *entire* path before the sole content getter.
    let mut selected = node.clone();
    let mut complete = false;
    for _ in 0..16 {
        same_bus(&selected, wrapper)?;
        let meta = tree.meta(&selected)?;
        if parents.get(&selected) != Some(&meta.parent) {
            return Err("ancestry-changed");
        }
        if (selected == *node && meta.role != LABEL) || !meta.safe() || !visible(meta.rect) {
            return Err("selected-ancestry-changed");
        }
        if selected == *wrapper {
            complete = true;
            break;
        }
        selected = meta.parent;
    }
    if !complete {
        return Err("incomplete-ancestry");
    }
    ancestors(tree, wrapper)?;
    if !tree.children(node)?.is_empty() {
        return Err("selected-label-changed");
    }
    native()?;
    let name = tree.name(node)?;
    let compact = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return Err("empty-label");
    }
    let clipped: String = compact.chars().take(60).collect();
    Ok(format!("label “{clipped}”"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    struct Fake {
        nodes: HashMap<Ref, (Meta, Vec<Ref>, String)>,
        reads: Vec<Ref>,
    }
    impl AccessibleTree for Fake {
        fn meta(&mut self, n: &Ref) -> Result<Meta> {
            self.nodes.get(n).map(|v| v.0.clone()).ok_or("missing")
        }
        fn children(&mut self, n: &Ref) -> Result<Vec<Ref>> {
            Ok(self.nodes[n].1.clone())
        }
        fn name(&mut self, n: &Ref) -> Result<String> {
            self.reads.push(n.clone());
            Ok(self.nodes[n].2.clone())
        }
    }
    fn reference(path: &str) -> Ref {
        (
            ":1.42".into(),
            OwnedObjectPath::try_from(format!("/test/{path}")).unwrap(),
        )
    }
    fn fixture() -> (Fake, Ref, Ref) {
        let root = reference("wrapper");
        let app = reference("app");
        let label = reference("label");
        let states = vec![(1 << SHOWING) | (1 << VISIBLE)];
        let rect = Rect {
            x: 0.,
            y: 0.,
            w: 100.,
            h: 100.,
        };
        let node = |role, parent, rect| Meta {
            role,
            states: states.clone(),
            parent,
            rect,
        };
        let nodes = HashMap::from([
            (
                app.clone(),
                (
                    node(
                        75,
                        (
                            String::new(),
                            OwnedObjectPath::try_from("/org/a11y/atspi/null").unwrap(),
                        ),
                        rect,
                    ),
                    vec![],
                    String::new(),
                ),
            ),
            (
                root.clone(),
                (node(20, app, rect), vec![label.clone()], String::new()),
            ),
            (
                label.clone(),
                (
                    node(
                        LABEL,
                        root.clone(),
                        Rect {
                            x: 30.,
                            y: 20.,
                            w: 30.,
                            h: 10.,
                        },
                    ),
                    vec![],
                    "Friday".into(),
                ),
            ),
        ]);
        (
            Fake {
                nodes,
                reads: vec![],
            },
            root,
            label,
        )
    }
    #[test]
    fn bridge_is_typed_unterminated_xembed_reference_not_window_guess() {
        assert_eq!(
            parse_bridge(b":1.42:/test/wrapper").unwrap(),
            reference("wrapper")
        );
        for bytes in [
            b":1.42:/test/wrapper\0".as_slice(),
            b"app:/test/wrapper",
            b":1.42",
            b":1.42:not/a/path",
        ] {
            assert!(parse_bridge(bytes).is_err());
        }
    }
    #[test]
    fn nearest_visible_label_and_private_hidden_excluded_missing_ambiguity() {
        let (mut tree, root, label) = fixture();
        let farther = reference("farther");
        let mut farther_node = tree.nodes[&label].clone();
        farther_node.0.rect.y = 70.;
        farther_node.2 = "Not nearest".into();
        tree.nodes.insert(farther.clone(), farther_node);
        tree.nodes.get_mut(&root).unwrap().1.push(farther);
        assert_eq!(
            nearby(&mut tree, &root, 40., 35., &|_| true, &|| Ok(())).unwrap(),
            "label “Friday”"
        );
        for mode in 0..7 {
            let (mut tree, root, label) = fixture();
            match mode {
                0 => tree.nodes.get_mut(&label).unwrap().0.states[0] |= 1 << EDITABLE,
                1 => tree.nodes.get_mut(&label).unwrap().0.role = PASSWORD,
                2 => tree.nodes.get_mut(&label).unwrap().0.states[0] &= !(1 << SHOWING),
                3 => tree.nodes.get_mut(&root).unwrap().0.states[0] |= 1 << EDITABLE,
                5 => tree.nodes.get_mut(&label).unwrap().0.states[0] &= !(1 << VISIBLE),
                6 => {
                    let private = reference("private_child");
                    let mut child = tree.nodes[&label].clone();
                    child.0.role = PASSWORD;
                    child.0.parent = label.clone();
                    tree.nodes.insert(private.clone(), child);
                    tree.nodes.get_mut(&label).unwrap().1.push(private);
                }
                _ => {}
            }
            assert!(nearby(&mut tree, &root, 40., 35., &|_| mode != 4, &|| Ok(())).is_err());
            assert!(!tree.reads.contains(&label), "forbidden getter mode {mode}");
        }
        let (mut tree, root, label) = fixture();
        let foreign = (":1.99".into(), label.1.clone());
        tree.nodes.get_mut(&root).unwrap().1 = vec![foreign.clone()];
        assert!(nearby(&mut tree, &root, 40., 35., &|_| true, &|| Ok(())).is_err());
        assert!(!tree.reads.contains(&foreign));
        let (mut tree, root, label) = fixture();
        let second = reference("second");
        tree.nodes
            .insert(second.clone(), tree.nodes[&label].clone());
        tree.nodes.get_mut(&root).unwrap().1.push(second);
        assert_eq!(
            nearby(&mut tree, &root, 40., 35., &|_| true, &|| Ok(())),
            Err("ambiguous-label")
        );
        assert!(!tree.reads.contains(&label));
        let (mut tree, root, _) = fixture();
        tree.nodes.get_mut(&root).unwrap().1.clear();
        assert_eq!(
            nearby(&mut tree, &root, 40., 35., &|_| true, &|| Ok(())),
            Err("no-visible-label")
        );
    }
    #[test]
    fn reparented_or_newly_private_selected_path_never_reaches_name() {
        struct Changing {
            inner: Fake,
            label: Ref,
            root: Ref,
            label_reads: usize,
            changed: bool,
            reparent: bool,
        }
        impl AccessibleTree for Changing {
            fn meta(&mut self, n: &Ref) -> Result<Meta> {
                if n == &self.label {
                    self.label_reads += 1;
                    if self.label_reads == 2 {
                        self.changed = true;
                    }
                }
                let mut meta = self.inner.meta(n)?;
                if self.changed && n == &self.label && self.reparent {
                    meta.parent = reference("replacement_parent");
                }
                if self.changed && n == &self.root && !self.reparent {
                    meta.states[0] |= 1 << EDITABLE;
                }
                Ok(meta)
            }
            fn children(&mut self, n: &Ref) -> Result<Vec<Ref>> {
                self.inner.children(n)
            }
            fn name(&mut self, n: &Ref) -> Result<String> {
                self.inner.name(n)
            }
        }
        for reparent in [true, false] {
            let (inner, root, label) = fixture();
            let mut tree = Changing {
                inner,
                root: root.clone(),
                label,
                label_reads: 0,
                changed: false,
                reparent,
            };
            assert!(nearby(&mut tree, &root, 40., 35., &|_| true, &|| Ok(())).is_err());
            assert!(tree.inner.reads.is_empty());
        }
    }
    #[test]
    fn source_bounds_and_private_target_do_not_fall_through_to_a_public_sibling() {
        let (mut tree, root, _label) = fixture();
        let capture = Rect {
            x: 0.,
            y: 0.,
            w: 45.,
            h: 100.,
        };
        assert!(
            nearby(
                &mut tree,
                &root,
                40.,
                35.,
                &|r| capture.encloses(r),
                &|| Ok(())
            )
            .is_err()
        );
        assert!(tree.reads.is_empty());
        let (mut tree, root, label) = fixture();
        let input = reference("input");
        let mut input_node = tree.nodes[&label].clone();
        input_node.0.role = 79;
        input_node.0.rect.y = 30.;
        input_node.1 = vec![reference("typed_child_must_not_be_visited")];
        tree.nodes.insert(input.clone(), input_node);
        tree.nodes.get_mut(&root).unwrap().1.push(input);
        assert_eq!(
            nearby(&mut tree, &root, 40., 35., &|_| true, &|| Ok(())),
            Err("private-or-hidden-target")
        );
        assert!(tree.reads.is_empty());
    }
    #[test]
    fn blocker_rectangles_are_not_transparent_holes_and_labels_must_fit_capture() {
        let frame = Rect {
            x: 0.,
            y: 0.,
            w: 100.,
            h: 100.,
        };
        let label = Rect {
            x: 30.,
            y: 20.,
            w: 30.,
            h: 10.,
        };
        let blocker = Rect {
            x: 50.,
            y: 20.,
            w: 20.,
            h: 20.,
        };
        assert!(visible_rect(frame, frame, &[], label));
        // Excluded siblings remain visual blockers, not screenshot-like cutouts.
        assert!(!visible_rect(frame, frame, &[blocker], label));
        assert!(!visible_rect(Rect { w: 45., ..frame }, frame, &[], label));
        assert!(!visible_rect(frame, Rect { w: 45., ..frame }, &[], label));
        assert!(!visible_rect(frame, frame, &[], Rect { w: 0., ..label }));
    }
    #[test]
    fn native_invalidation_prevents_every_content_getter() {
        let (mut tree, root, _) = fixture();
        assert_eq!(
            nearby(&mut tree, &root, 40., 35., &|_| true, &|| Err(
                "native-changed"
            )),
            Err("native-changed")
        );
        assert!(tree.reads.is_empty());
        let outer = Rect {
            x: 0.,
            y: 0.,
            w: 100.,
            h: 100.,
        };
        assert!(!outer.encloses(Rect {
            x: 99.,
            y: 20.,
            w: 10.,
            h: 5.
        }));
        assert!(!outer.encloses(Rect {
            x: 0.,
            y: 0.,
            w: f64::NAN,
            h: 10.
        }));
    }
}
