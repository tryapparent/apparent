use super::{attribute, element_attribute, pid_of, string_attribute, AxElement, Hit, Owned, Target, LOOKUP_BUDGET};
use core_foundation::base::{CFType, TCFType};
use core_foundation::string::CFString;
use std::collections::HashMap;
use std::time::Instant;

#[cfg(target_os = "macos")]
pub(super) fn window_at(
    raw: &[crate::shared::windows::RawWindow],
    x: f64,
    y: f64,
    own: i32,
    direct_browser_hit: bool,
) -> Option<&crate::shared::windows::RawWindow> {
    raw.iter().find(|window| {
        let [left, top, width, height] = window.bounds;
        window.pid != own
            && window.alpha > 0.01
            && x >= left
            && x <= left + width
            && y >= top
            && y <= top + height
            && !(window.owner == "Dock" && window.layer == 20)
            && !(window.owner == "Window Server" && window.layer == 2_147_483_630)
            && !(direct_browser_hit && window.owner == "Notification Center" && window.layer == 21)
    })
}

#[cfg(target_os = "macos")]
pub(super) fn is_browser(owner: i32) -> bool {
    use objc2_app_kit::NSRunningApplication;

    NSRunningApplication::runningApplicationWithProcessIdentifier(owner)
        .and_then(|app| app.bundleIdentifier())
        .is_some_and(|id| {
            matches!(
                id.to_string().as_str(),
                "com.google.Chrome" | "org.chromium.Chromium" | "org.mozilla.firefox"
            )
        })
}

#[cfg(target_os = "macos")]
pub(super) fn browser_page(element: AxElement, owner: i32, started: Instant) -> Option<String> {
    use core_foundation::url::CFURL;

    let mut parent = None;
    let mut page = None;
    for _ in 0..20 {
        let node = parent.as_ref().map_or(element, |node: &Owned| node.0);
        if started.elapsed() >= LOOKUP_BUDGET || pid_of(node) != Some(owner) {
            return None;
        }
        match string_attribute(node, "AXRole")?.as_str() {
            "AXWindow" => return page,
            "AXWebArea" => {
                if let Some(value) = attribute(node, "AXURL") {
                    let value = unsafe { CFType::wrap_under_get_rule(value.0) };
                    let raw = value.downcast::<CFURL>().map(|url| url.get_string().to_string())
                        .or_else(|| value.downcast::<CFString>().map(|s| s.to_string()));
                    if let Some(raw) = raw.filter(|url| crate::shared::routing::parse_url(url).is_some()) {
                        page = Some(raw);
                    }
                }
            }
            _ => {}
        }
        parent = Some(element_attribute(node, "AXParent")?);
    }
    None
}

pub fn apply(
    hits: &HashMap<Target, Hit>,
    events: &mut Vec<crate::shared::model::InteractionEvent>,
    strokes: &mut [crate::shared::model::Stroke],
) {
    use crate::shared::model::InteractionEvent;
    let mut pages = Vec::new();
    for event in events.iter_mut() {
        match event {
            InteractionEvent::Click { t, label, role, .. } => {
                if let Some(hit) = hits.get(&Target::Pointer(*t)) {
                    *role = Some(hit.role.clone());
                    *label = hit.label_text().or(label.take());
                    pages.extend(page_event(*t, hit.browser_page.as_ref()));
                }
            }
            InteractionEvent::Drag { t, label, .. } => {
                if let Some(hit) = hits.get(&Target::Pointer(*t)) {
                    if let Some(text) = hit.on_text() {
                        *label = Some(text);
                    }
                    pages.extend(page_event(*t, hit.browser_page.as_ref()));
                }
            }
            _ => {}
        }
    }
    for stroke in strokes.iter_mut().filter(|s| !s.laser) {
        if let Some(hit) = hits.get(&Target::Stroke(stroke.t0)) {
            if stroke.on.is_none() {
                stroke.on = hit.mark_text();
            }
            let page = hit.browser_page.as_ref();
            let start = hits.get(&Target::StrokeStart(stroke.t0))
                .and_then(|hit| hit.browser_page.as_ref());
            if super::super::admit_browser_page(page.is_some(), true, page == start) {
                pages.extend(page_event(stroke.t0, page));
            }
        }
    }
    events.extend(pages);
}

fn page_event(t: u64, page: Option<&(u32, String)>) -> Option<crate::shared::model::InteractionEvent> {
    let url = crate::shared::routing::browser_page_url(&page?.1)?;
    Some(crate::shared::model::InteractionEvent::AppEvent { t, label: format!("{}{url}", crate::shared::routing::BROWSER_PAGE_EVENT_PREFIX) })
}
