use super::{
    AXUIElementCreateApplication, AXUIElementGetTypeID, AXUIElementSetMessagingTimeout, AxElement,
    CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex, Owned, attribute, element_at,
    element_attribute, pid_of, string_attribute,
};
use crate::shared::model::{ActionContext, ActionKind, ActionWindow, PinWindow, PinWindowElement};
use crate::shared::windows::{RawWindow, raw_windows};
use core_foundation::base::{CFEqual, CFGetTypeID, CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use std::ffi::c_void;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const LIMIT: usize = 12;
const NODES: usize = 128;
const BYTES: usize = 24_000;
const FRESH: Duration = Duration::from_millis(150);
const BUDGET: Duration = Duration::from_millis(240);
const DRAIN: Duration = Duration::from_millis(250);

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCopyAttributeValues(
        element: AxElement,
        attribute: CFStringRef,
        index: isize,
        maximum: isize,
        values: *mut CFTypeRef,
    ) -> i32;
    fn AXValueGetTypeID() -> usize;
    fn AXValueGetValue(value: CFTypeRef, kind: u32, out: *mut c_void) -> u8;
}

struct Request {
    pin: u32,
    t: u64,
    release: u64,
    x: f64,
    y: f64,
    note_pid: u32,
    at: Instant,
}

struct Session {
    requests: flume::Sender<Request>,
    results: flume::Receiver<ActionContext>,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);

pub fn begin(enabled: bool) {
    let mut session = SESSION
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    *session = None;
    if !enabled {
        return;
    }
    let (requests, queue) = flume::bounded::<Request>(2);
    let (output, results) = flume::bounded(LIMIT);
    if std::thread::Builder::new()
        .name("apparent-ax-pins".into())
        .spawn(move || {
            let mut remaining = LIMIT;
            for request in queue {
                let result = objc2::rc::autoreleasepool(|_| observe(request));
                if let Some(row) = result
                    && output.try_send(row).is_ok()
                {
                    remaining -= 1;
                    if remaining == 0 {
                        break;
                    }
                }
            }
        })
        .is_ok()
    {
        *session = Some(Session { requests, results });
    }
}

pub fn pin(pin: u32, t: u64, release: u64, x: f64, y: f64, note_pid: u32) {
    if let Ok(session) = SESSION.try_lock()
        && let Some(session) = session.as_ref()
    {
        let _ = session.requests.try_send(Request {
            pin,
            t,
            release,
            x,
            y,
            note_pid,
            at: Instant::now(),
        });
    }
}

pub fn finish() -> Vec<ActionContext> {
    let session = SESSION
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take();
    let Some(Session { requests, results }) = session else {
        return Vec::new();
    };
    drop(requests);
    let deadline = Instant::now() + DRAIN;
    std::iter::from_fn(|| results.recv_deadline(deadline).ok()).collect()
}

fn window_at<'a>(raw: &'a [RawWindow], request: &Request, own: i32) -> Option<&'a RawWindow> {
    let windows = raw.iter().find(|window| {
        let [x, y, w, h] = window.bounds;
        window.pid != own
            && window.pid as u32 != request.note_pid
            && window.alpha > 0.01
            && request.x >= x
            && request.y >= y
            && request.x < x + w
            && request.y < y + h
    })?;
    (windows.layer == 0 && !crate::capture::ui_process::owns(windows.pid)).then_some(windows)
}

fn observe(request: Request) -> Option<ActionContext> {
    if request.at.elapsed() > FRESH {
        return None;
    }
    let own = std::process::id() as i32;
    let raw = raw_windows();
    let window = window_at(&raw, &request, own)?;
    let app = Owned(unsafe { AXUIElementCreateApplication(window.pid) });
    if app.0.is_null() {
        return None;
    }
    unsafe { AXUIElementSetMessagingTimeout(app.0, 0.035) };
    let mut element = element_at(app.0, request.x, request.y)?;
    let deadline = request.at + FRESH + BUDGET;
    let mut document = None;
    let mut root = None;
    for _ in 0..32 {
        if Instant::now() >= deadline || pid_of(element.0) != Some(window.pid) {
            return None;
        }
        match string_attribute(element.0, "AXRole")?.as_str() {
            "AXWindow" => {
                root = Some(element);
                break;
            }
            "AXWebArea" => {
                let parent = element_attribute(element.0, "AXParent")?;
                document = Some(element);
                element = parent;
            }
            _ => element = element_attribute(element.0, "AXParent")?,
        }
    }
    let root = root?;
    let geometry = rect(root.0)?;
    if !geometry
        .iter()
        .zip(window.bounds)
        .all(|(observed, expected)| (observed - expected).abs() <= 2.0)
        || (!window.title.is_empty()
            && string_attribute(root.0, "AXTitle").as_deref() != Some(window.title.as_str()))
        || request.at.elapsed() > FRESH
    {
        return None;
    }

    let sampled_after_ms = request
        .release
        .saturating_sub(request.t)
        .saturating_add(request.at.elapsed().as_millis() as u64);
    let mut tree = Tree {
        pid: window.pid,
        geometry,
        deadline,
        visited: 0,
        bytes: 2,
        elements: Vec::new(),
        truncated: false,
        skip: None,
    };
    if let Some(document) = &document {
        tree.visit(document.0, None, 0);
        tree.skip = Some(document.0);
    }
    tree.visit(root.0, None, 0);
    if tree.elements.is_empty()
        || Instant::now() >= deadline + Duration::from_millis(100)
        || window_at(&raw_windows(), &request, own) != Some(window)
        || rect(root.0) != Some(geometry)
    {
        return None;
    }
    Some(ActionContext {
        kind: ActionKind::Stroke,
        t: request.t,
        window: ActionWindow {
            id: format!("macos:{}:{}", window.pid, window.id),
            app: window.owner.clone(),
            title: (!window.title.is_empty()).then(|| window.title.clone()),
        },
        pin_window: Some(PinWindow {
            pin: request.pin,
            sampled_after_ms,
            truncated: tree.truncated,
            elements: tree.elements,
        }),
    })
}

fn rect(element: AxElement) -> Option<[f64; 4]> {
    fn pair(element: AxElement, attribute_name: &'static str, kind: u32) -> Option<[f64; 2]> {
        let value = attribute(element, attribute_name)?;
        if unsafe { CFGetTypeID(value.0) != AXValueGetTypeID() } {
            return None;
        }
        let mut pair = [0.0_f64; 2];
        (unsafe { AXValueGetValue(value.0, kind, pair.as_mut_ptr().cast()) != 0 }
            && pair.iter().all(|value| value.is_finite()))
        .then_some(pair)
    }
    let [x, y] = pair(element, "AXPosition", 1)?;
    let [w, h] = pair(element, "AXSize", 2)?;
    (w > 0.0 && h > 0.0).then_some([x, y, w, h])
}

fn relative([x, y, w, h]: [f64; 4], [left, top, width, height]: [f64; 4]) -> Option<[i32; 4]> {
    let [x, y] = [x - left, y - top];
    (x >= 0.0 && y >= 0.0 && x + w <= width && y + h <= height && w >= 1.0 && h >= 1.0)
        .then(|| [x, y, w, h].map(|value| value.round() as i32))
}

fn flag(element: AxElement, name: &'static str) -> Option<bool> {
    let value = attribute(element, name)?;
    let value = unsafe { CFType::wrap_under_get_rule(value.0) };
    value.downcast::<CFBoolean>().map(bool::from)
}

fn role_name(role: &str) -> Option<&'static str> {
    Some(match role {
        "AXButton" => "button",
        "AXCheckBox" => "check box",
        "AXRadioButton" => "radio button",
        "AXStaticText" => "static",
        "AXHeading" => "heading",
        "AXLink" => "link",
        "AXMenuItem" => "menu item",
        "AXTab" => "tab",
        "AXSlider" => "slider",
        "AXImage" => "image",
        "AXProgressIndicator" => "progress bar",
        "AXDisclosureTriangle" => "disclosure triangle",
        "AXPopUpButton" => "pop-up button",
        _ => return None,
    })
}

fn sensitive(role: &str) -> bool {
    super::is_input(role, "") || matches!(role, "AXTerminal" | "AXSecureTextField")
}

struct Tree {
    pid: i32,
    geometry: [f64; 4],
    deadline: Instant,
    visited: usize,
    bytes: usize,
    elements: Vec<PinWindowElement>,
    truncated: bool,
    skip: Option<AxElement>,
}

impl Tree {
    fn exhausted(&self) -> bool {
        Instant::now() >= self.deadline || self.visited >= NODES || self.bytes >= BYTES
    }

    fn visit(&mut self, element: AxElement, mut parent: Option<usize>, depth: usize) {
        if self.exhausted() || depth > 24 {
            self.truncated = true;
            return;
        }
        if element.is_null()
            || unsafe { CFGetTypeID(element) != AXUIElementGetTypeID() }
            || pid_of(element) != Some(self.pid)
            || self
                .skip
                .is_some_and(|skip| unsafe { CFEqual(element, skip) != 0 })
        {
            return;
        }
        self.visited += 1;
        let Some(role) = string_attribute(element, "AXRole") else {
            return;
        };
        if sensitive(&role)
            || flag(element, "AXHidden") == Some(true)
            || flag(element, "AXEditable") == Some(true)
        {
            return;
        }
        if let Some(kind) = role_name(&role) {
            let name = ["AXTitle", "AXDescription"]
                .into_iter()
                .find_map(|key| string_attribute(element, key))
                .or_else(|| {
                    (role == "AXStaticText")
                        .then(|| string_attribute(element, "AXValue"))
                        .flatten()
                })
                .and_then(|value| {
                    self.truncated |= value.chars().nth(super::MAX_CHARS).is_some();
                    super::clip(&value)
                });
            let mut states = Vec::new();
            if flag(element, "AXEnabled") == Some(false) {
                states.push("disabled".into());
            }
            if matches!(role.as_str(), "AXCheckBox" | "AXRadioButton")
                && let Some(value) = attribute(element, "AXValue")
            {
                let value = unsafe { CFType::wrap_under_get_rule(value.0) };
                if let Some(state) = value
                    .downcast::<CFNumber>()
                    .and_then(|n| n.to_i32())
                    .or_else(|| {
                        value
                            .downcast::<CFBoolean>()
                            .map(|state| i32::from(bool::from(state)))
                    })
                    .and_then(|n| match n {
                        0 => Some("unchecked"),
                        1 => Some("checked"),
                        2 => Some("mixed"),
                        _ => None,
                    })
                {
                    states.push(state.into());
                }
            }
            for (key, state) in [
                ("AXFocused", "focused"),
                ("AXSelected", "selected"),
                ("AXExpanded", "expanded"),
            ] {
                if self.exhausted() {
                    break;
                }
                if flag(element, key) == Some(true) {
                    states.push(state.into())
                }
            }
            let window_bounds = (!self.exhausted())
                .then(|| rect(element))
                .flatten()
                .and_then(|bounds| relative(bounds, self.geometry));
            if name.is_some() || !states.is_empty() || window_bounds.is_some() {
                let node = PinWindowElement {
                    role: kind.into(),
                    name,
                    parent,
                    states,
                    window_bounds,
                };
                if let Ok(bytes) = serde_json::to_vec(&node) {
                    self.bytes += bytes.len() + 1;
                    if self.bytes <= BYTES {
                        parent = Some(self.elements.len());
                        self.elements.push(node);
                    } else {
                        self.truncated = true;
                    }
                }
            }
        }
        if self.exhausted() {
            self.truncated = true;
            return;
        }
        let key = CFString::from_static_string("AXChildren");
        let mut values = std::ptr::null();
        let status = unsafe {
            AXUIElementCopyAttributeValues(
                element,
                key.as_concrete_TypeRef(),
                0,
                NODES as isize + 1,
                &raw mut values,
            )
        };
        if status == 0 && !values.is_null() {
            let children = Owned(values);
            if unsafe { CFGetTypeID(children.0) != CFArrayGetTypeID() } {
                return;
            }
            let count = unsafe { CFArrayGetCount(children.0) };
            for index in 0..count.min(NODES as isize) {
                if self.exhausted() {
                    self.truncated = true;
                    break;
                }
                self.visit(
                    unsafe { CFArrayGetValueAtIndex(children.0, index) },
                    parent,
                    depth + 1,
                );
            }
            self.truncated |= count > NODES as isize;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_resolves_past_only_its_own_editor() {
        let window = |pid, layer| RawWindow {
            pid,
            layer,
            id: pid as u32,
            owner: String::new(),
            title: String::new(),
            alpha: 1.0,
            bounds: [0.0, 0.0, 100.0, 100.0],
        };
        let request = Request {
            pin: 1,
            t: 0,
            release: 0,
            x: 10.0,
            y: 20.0,
            note_pid: 2,
            at: Instant::now(),
        };
        let raw = [window(1, 2), window(2, 2), window(3, 0)];
        assert_eq!(
            window_at(&raw, &request, 1).map(|window| window.pid),
            Some(3)
        );
        assert!(window_at(&[window(4, 2), window(3, 0)], &request, 1).is_none());
    }

    #[test]
    fn pin_bounds_are_window_relative_and_reject_outside_geometry() {
        let outer = [-100.0, 20.0, 400.0, 300.0];
        assert_eq!(
            relative([-90.0, 30.0, 30.0, 50.0], outer),
            Some([10, 10, 30, 50])
        );
        assert_eq!(relative([-101.0, 30.0, 30.0, 50.0], outer), None);
        assert_eq!(relative([200.0, 30.0, 110.0, 50.0], outer), None);
        assert!(sensitive("AXSecureTextField"));
        assert!(sensitive("AXTextArea"));
    }
}
