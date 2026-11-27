#[path = "../../../engine/accessibility/macos_pin.rs"]
pub(crate) mod pin_window;

#[cfg(target_os = "macos")]
use core_foundation::base::{CFType, CFTypeRef, TCFType};
#[cfg(target_os = "macos")]
use core_foundation::string::{CFString, CFStringRef};
#[path = "../../../engine/accessibility/macos_browser.rs"]
mod browser;
pub use browser::apply;
#[cfg(target_os = "macos")]
use browser::window_at;

use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::ffi::c_void;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
type AxElement = *const c_void;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateSystemWide() -> AxElement;
    fn AXUIElementCreateApplication(pid: i32) -> AxElement;
    fn AXUIElementCopyElementAtPosition(
        element: AxElement,
        x: f32,
        y: f32,
        out: *mut AxElement,
    ) -> i32;
    fn AXUIElementCopyAttributeValue(
        element: AxElement,
        attribute: CFStringRef,
        out: *mut CFTypeRef,
    ) -> i32;
    fn AXUIElementSetMessagingTimeout(element: AxElement, seconds: f32) -> i32;
    fn AXUIElementGetPid(element: AxElement, pid: *mut i32) -> i32;
    fn AXUIElementGetTypeID() -> usize;
    fn CFArrayGetTypeID() -> usize;
    fn CFArrayGetCount(array: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFTypeRef, index: isize) -> CFTypeRef;
}

/// Longest label, identifier or file name kept.
const MAX_CHARS: usize = 60;

/// Each Accessibility message to an app gives up after this.
#[cfg(target_os = "macos")]
const MESSAGE_TIMEOUT_S: f32 = 0.1;

/// A lookup stops reading more attributes after this, whatever it has by then.
const LOOKUP_BUDGET: Duration = Duration::from_millis(250);

/// How long finishing a capture waits for lookups still running.
const DRAIN_WAIT: Duration = Duration::from_millis(400);

const MARK_IDENTITY: [bool; 4] = include!("../../../record/media/src/assembly/target/mark-identity.json");

/// The element under a point.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Hit {
    mark_role: bool,
    /// Human role, as the app describes it (`button`, `text field`, `tab`).
    pub role: String,
    pub label: Option<String>,
    pub identifier: Option<String>,
    /// The file name of the document the element's window shows (`AXDocument`).
    pub document: Option<String>,
    browser_page: Option<(u32, String)>,
}

impl Hit {
    /// `“New Tab” #tab-new in main.rs`: what `Click.label` holds (the role goes in `Click.role`).
    pub fn label_text(&self) -> Option<String> {
        let mut parts = Vec::new();
        if let Some(label) = &self.label {
            parts.push(format!("“{label}”"));
        }
        if let Some(id) = &self.identifier {
            parts.push(format!("#{id}"));
        }
        if let Some(doc) = &self.document {
            parts.push(format!("in {doc}"));
        }
        (!parts.is_empty()).then(|| parts.join(" "))
    }

    /// `button “Area” #area`: what `Stroke.on` holds. `None` when the element has nothing to name
    /// it by but its role.
    pub fn on_text(&self) -> Option<String> {
        self.label_text()
            .map(|text| format!("{} {text}", self.role))
    }

    fn mark_text(&self) -> Option<String> {
        let has_identity = self.label.is_some() || self.identifier.is_some();
        let flags = usize::from(self.mark_role) | usize::from(has_identity) << 1;
        MARK_IDENTITY[flags].then(|| self.on_text()).flatten()
    }
}

/// One line, at most `MAX_CHARS`.
pub fn clip(raw: &str) -> Option<String> {
    let compact = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return None;
    }
    Some(if compact.chars().count() <= MAX_CHARS {
        compact
    } else {
        let cut: String = compact.chars().take(MAX_CHARS - 1).collect();
        format!("{}…", cut.trim_end())
    })
}

/// Roles whose value is what the user typed; their value is never read.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_input(role: &str, subrole: &str) -> bool {
    subrole == "AXSecureTextField"
        || matches!(
            role,
            "AXSecureTextField" | "AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField"
        )
}

/// Roles that are usually a piece of a control (its text or icon), so the control names it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_part(role: &str) -> bool {
    matches!(role, "AXStaticText" | "AXImage" | "AXGroup" | "AXUnknown")
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_control(role: &str) -> bool {
    matches!(
        role,
        "AXButton"
            | "AXLink"
            | "AXMenuItem"
            | "AXMenuBarItem"
            | "AXCheckBox"
            | "AXRadioButton"
            | "AXTab"
            | "AXPopUpButton"
            | "AXMenuButton"
            | "AXDisclosureTriangle"
            | "AXCell"
            | "AXRow"
            | "AXSlider"
    )
}

#[cfg(target_os = "macos")]
fn cell_child_label<'a>(
    children: impl IntoIterator<Item = (&'a str, Option<&'a str>, bool)>,
) -> Option<String> {
    let mut names = children
        .into_iter()
        .filter(|(role, _, owned)| *role == "AXStaticText" && *owned)
        .filter_map(|(_, value, _)| value.and_then(clip));
    let name = names.next()?;
    names.next().is_none().then_some(name)
}

/// Owns a CoreFoundation value returned under the create rule.
#[cfg(target_os = "macos")]
struct Owned(CFTypeRef);

#[cfg(target_os = "macos")]
impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { core_foundation::base::CFRelease(self.0) };
        }
    }
}

#[cfg(target_os = "macos")]
fn attribute(element: AxElement, name: &'static str) -> Option<Owned> {
    let key = CFString::from_static_string(name);
    let mut out: CFTypeRef = std::ptr::null();
    let status =
        unsafe { AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &raw mut out) };
    (status == 0 && !out.is_null()).then_some(Owned(out))
}

#[cfg(target_os = "macos")]
fn string_attribute(element: AxElement, name: &'static str) -> Option<String> {
    let value = attribute(element, name)?;
    let value = unsafe { CFType::wrap_under_get_rule(value.0) };
    value
        .downcast::<CFString>()
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
}

#[cfg(target_os = "macos")]
fn element_attribute(element: AxElement, name: &'static str) -> Option<Owned> {
    let value = attribute(element, name)?;
    let is_element =
        unsafe { core_foundation::base::CFGetTypeID(value.0) } == unsafe { AXUIElementGetTypeID() };
    is_element.then_some(value)
}

#[cfg(target_os = "macos")]
fn pid_of(element: AxElement) -> Option<i32> {
    let mut pid = 0;
    (unsafe { AXUIElementGetPid(element, &raw mut pid) } == 0).then_some(pid)
}

#[cfg(target_os = "macos")]
fn element_at(root: AxElement, x: f64, y: f64) -> Option<Owned> {
    let mut out: AxElement = std::ptr::null();
    let status =
        unsafe { AXUIElementCopyElementAtPosition(root, x as f32, y as f32, &raw mut out) };
    (status == 0 && !out.is_null()).then_some(Owned(out))
}

/// Finder's sidebar cell has no label itself; its direct static text child carries AXValue.
/// Do not search siblings or read the values of input controls.
#[cfg(target_os = "macos")]
fn cell_name(element: AxElement, owner: i32, started: Instant) -> Option<String> {
    let children = attribute(element, "AXChildren")?;
    if unsafe { core_foundation::base::CFGetTypeID(children.0) } != unsafe { CFArrayGetTypeID() } {
        return None;
    }
    let count = unsafe { CFArrayGetCount(children.0) };
    if !(0..=8).contains(&count) {
        return None;
    }
    let mut candidates = Vec::new();
    for i in 0..count {
        if started.elapsed() > LOOKUP_BUDGET {
            return None;
        }
        let child = unsafe { CFArrayGetValueAtIndex(children.0, i) };
        if child.is_null()
            || unsafe { core_foundation::base::CFGetTypeID(child) }
                != unsafe { AXUIElementGetTypeID() }
        {
            return None;
        }
        let owned = pid_of(child) == Some(owner);
        let role = string_attribute(child, "AXRole").unwrap_or_default();
        let value = if owned && role == "AXStaticText" {
            string_attribute(child, "AXValue")
        } else {
            None
        };
        candidates.push((role, value, owned));
    }
    cell_child_label(
        candidates
            .iter()
            .map(|(role, value, owned)| (role.as_str(), value.as_deref(), *owned)),
    )
}

/// The topmost element at a global top-left point, looking past Apparent's own windows. Blocking;
/// call it off the main thread.
#[cfg(target_os = "macos")]
pub fn hit_test(x: f64, y: f64) -> Option<Hit> {
    let started = Instant::now();
    let own = std::process::id() as i32;
    let system = Owned(unsafe { AXUIElementCreateSystemWide() });
    unsafe { AXUIElementSetMessagingTimeout(system.0, MESSAGE_TIMEOUT_S) };
    let mut element = element_at(system.0, x, y)?;
    let system_owner = pid_of(element.0)?;
    let direct_browser_hit = system_owner != own && browser::is_browser(system_owner);
    let raw = objc2::rc::autoreleasepool(|_| crate::shared::windows::raw_windows());
    let front_window = window_at(&raw, x, y, own, direct_browser_hit);
    if system_owner == own {
        let pid = front_window?.pid;
        let app = Owned(unsafe { AXUIElementCreateApplication(pid) });
        unsafe { AXUIElementSetMessagingTimeout(app.0, MESSAGE_TIMEOUT_S) };
        element = element_at(app.0, x, y)?;
        if pid_of(element.0) != Some(pid) {
            return None;
        }
    } else if front_window.is_some_and(|window| window.pid != system_owner) {
        return None;
    }
    let over = || started.elapsed() > LOOKUP_BUDGET;

    let mut role = string_attribute(element.0, "AXRole").unwrap_or_default();
    // A button's text or icon names the button.
    if is_part(&role) {
        let mut parent = element_attribute(element.0, "AXParent");
        for _ in 0..2 {
            let Some(candidate) = parent.take() else {
                break;
            };
            if over() {
                break;
            }
            let parent_role = string_attribute(candidate.0, "AXRole").unwrap_or_default();
            if is_control(&parent_role) {
                element = candidate;
                role = parent_role;
                break;
            }
            parent = element_attribute(candidate.0, "AXParent");
        }
    }
    let subrole = string_attribute(element.0, "AXSubrole").unwrap_or_default();
    let input = is_input(&role, &subrole);
    let owner = pid_of(element.0)?;
    let browser_owner = if owner == system_owner {
        direct_browser_hit
    } else {
        browser::is_browser(owner)
    };
    let role_description = string_attribute(element.0, "AXRoleDescription")
        .or_else(|| role.strip_prefix("AX").map(str::to_lowercase))
        .unwrap_or_default();
    let mut hit = Hit {
        role: clip(&role_description).unwrap_or_else(|| "element".into()),
        mark_role: is_control(&role)
            || input
            || matches!(
                role.as_str(),
                "AXStaticText" | "AXHeading" | "AXImage" | "AXListItem"
            ),
        ..Hit::default()
    };
    for name in ["AXTitle", "AXDescription", "AXValue", "AXPlaceholderValue"] {
        if over() || hit.label.is_some() {
            break;
        }
        if name == "AXValue" && input {
            continue;
        }
        hit.label = string_attribute(element.0, name).and_then(|s| clip(&s));
        if role == "AXGroup" && matches!(name, "AXTitle" | "AXDescription") && hit.label.is_some() {
            hit.mark_role = true;
        }
    }
    if hit.label.is_none() && role == "AXCell" && !over() {
        hit.label = cell_name(element.0, owner, started);
    }
    if !over() {
        hit.identifier = string_attribute(element.0, "AXIdentifier")
            .or_else(|| string_attribute(element.0, "AXDOMIdentifier"))
            .and_then(|s| clip(&s));
    }
    if !browser_owner
        && !over()
        && let Some(window) = element_attribute(element.0, "AXWindow")
        && pid_of(window.0) == Some(owner)
    {
        hit.document = string_attribute(window.0, "AXDocument")
            .and_then(|url| document_name(&url))
            .and_then(|s| clip(&s));
    }
    hit.browser_page = front_window
        .filter(|window| browser_owner && window.layer == 0 && window.pid == owner)
        .and_then(|window| {
            let url = browser::browser_page(element.0, window.pid, started)?;
            let after = objc2::rc::autoreleasepool(|_| crate::shared::windows::raw_windows());
            let current = window_at(&after, x, y, own, direct_browser_hit);
            current.is_some_and(|current| current.id == window.id && current.pid == window.pid)
                .then_some((window.id, url))
        });
    Some(hit)
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn document_name(url: &str) -> Option<String> {
    let path = url.strip_prefix("file://").unwrap_or(url);
    let name = path.strip_prefix('/')?.trim_end_matches('/').rsplit('/').next()?;
    (!name.is_empty()).then(|| percent_decode(name))
}

pub(crate) fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Some(byte) = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
        {
            out.push(byte);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// What a lookup was for, so its result can be put on the right click or stroke at finish.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Target {
    /// The click or drag that began at this capture time.
    Pointer(u64),
    /// The stroke that began at this capture time.
    Stroke(u64),
    StrokeStart(u64),
}

type Job = (u64, Target, f64, f64, Instant);

/// Runs lookups for one capture at a time on a background thread and keeps their results until
/// the capture finishes.
pub struct Prober {
    jobs: flume::Sender<Job>,
    session: Arc<AtomicU64>,
    pending: Arc<AtomicUsize>,
    hits: Arc<Mutex<HashMap<Target, Hit>>>,
}

impl Prober {
    pub fn shared() -> &'static Prober {
        static PROBER: OnceLock<Prober> = OnceLock::new();
        PROBER.get_or_init(|| Prober::start(hit_test))
    }

    fn start(lookup: fn(f64, f64) -> Option<Hit>) -> Self {
        let (jobs, queue) = flume::unbounded::<Job>();
        let session = Arc::new(AtomicU64::new(0));
        let pending = Arc::new(AtomicUsize::new(0));
        let hits = Arc::new(Mutex::new(HashMap::new()));
        let (worker_session, worker_pending, worker_hits) = (
            Arc::clone(&session),
            Arc::clone(&pending),
            Arc::clone(&hits),
        );
        let _ = std::thread::Builder::new()
            .name("apparent-ax".into())
            .spawn(move || {
                for (job_session, target, x, y, queued_at) in queue {
                    if job_session == worker_session.load(Ordering::Acquire)
                        && let Some(mut hit) = lookup(x, y)
                    {
                        if queued_at.elapsed() > LOOKUP_BUDGET {
                            hit.browser_page = None;
                        }
                        let mut hits = worker_hits.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                        if job_session == worker_session.load(Ordering::Acquire) {
                            hits.insert(target, hit);
                        }
                    }
                    worker_pending.fetch_sub(1, Ordering::AcqRel);
                }
            });
        Self {
            jobs,
            session,
            pending,
            hits,
        }
    }

    /// Forgets the last capture's results; lookups still queued for it are skipped.
    pub fn begin(&self) {
        self.session.fetch_add(1, Ordering::AcqRel);
        self.hits
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }

    /// Looks up the element at a global top-left point for `target`, in the background.
    pub fn probe(&self, target: Target, x: f64, y: f64) {
        self.pending.fetch_add(1, Ordering::AcqRel);
        if self
            .jobs
            .send((self.session.load(Ordering::Acquire), target, x, y, Instant::now()))
            .is_err()
        {
            self.pending.fetch_sub(1, Ordering::AcqRel);
        }
    }

    /// Waits briefly for running lookups, then takes this capture's results.
    pub fn finish(&self) -> HashMap<Target, Hit> {
        let deadline = Instant::now() + DRAIN_WAIT;
        while self.pending.load(Ordering::Acquire) > 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        std::mem::take(
            &mut *self
                .hits
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
    }
}

/// Where to look for what a stroke marks: the middle of its box, or just above a flat stroke
/// (an underline sits under the thing it marks). Global top-left points.
pub fn stroke_probe_point(
    stroke: &crate::shared::model::Stroke,
    frame: crate::shared::model::TargetFrame,
) -> Option<(f64, f64)> {
    let points = stroke.normalized_points();
    if points.is_empty() {
        return None;
    }
    let [x0, y0, x1, y1] = crate::capture::engine::sketch::bounds(&points);
    let (w, h) = (
        f64::from(x1 - x0) * frame.width,
        f64::from(y1 - y0) * frame.height,
    );
    let cx = frame.x + f64::from(x0 + x1) / 2.0 * frame.width;
    let top = frame.y + f64::from(y0) * frame.height;
    if h < 24.0 && w > 3.0 * h {
        Some((cx, top - 8.0))
    } else {
        Some((cx, top + h / 2.0))
    }
}

#[cfg(test)]
#[path = "../../../engine/accessibility/macos_tests.rs"]
mod tests;
