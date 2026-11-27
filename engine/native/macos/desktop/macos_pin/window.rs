use super::super::{
    AXUIElementCreateSystemWide, AXUIElementSetMessagingTimeout, AxElement, Owned, element_at,
    element_attribute, pid_of,
};
use super::Request;
use crate::shared::windows::RawWindow;
use core_foundation::base::CFEqual;

pub(super) fn window_at<'a>(
    raw: &'a [RawWindow],
    request: &Request,
    own: i32,
    notification_surface: impl FnOnce(&RawWindow) -> bool,
) -> Option<(&'a RawWindow, bool)> {
    let mut covering = raw.iter().filter(|window| {
        let [x, y, w, h] = window.bounds;
        window.pid != own
            && window.pid as u32 != request.note_pid
            && window.alpha > 0.01
            && request.x >= x
            && request.y >= y
            && request.x < x + w
            && request.y < y + h
    });
    let first = covering.next()?;
    let verify_system_hit = first.layer == 21 && notification_surface(first);
    let window = if verify_system_hit {
        covering.next()?
    } else {
        first
    };
    (window.layer == 0 && !crate::capture::ui_process::owns(window.pid))
        .then_some((window, verify_system_hit))
}

pub(super) fn notification_surface(window: &RawWindow) -> bool {
    use core_graphics::display::CGDisplay;
    use objc2_app_kit::NSRunningApplication;

    let trusted_owner = NSRunningApplication::runningApplicationWithProcessIdentifier(window.pid)
        .and_then(|app| app.bundleURL())
        .and_then(|url| url.path())
        .is_some_and(|path| {
            path.to_string() == "/System/Library/CoreServices/NotificationCenter.app"
        });
    trusted_owner
        && CGDisplay::active_displays().is_ok_and(|displays| {
            displays.into_iter().any(|id| {
                let bounds = CGDisplay::new(id).bounds();
                window.bounds
                    == [
                        bounds.origin.x,
                        bounds.origin.y,
                        bounds.size.width,
                        bounds.size.height,
                    ]
            })
        })
}

pub(super) fn system_hits_window(request: &Request, root: AxElement, pid: i32) -> bool {
    let system = Owned(unsafe { AXUIElementCreateSystemWide() });
    if system.0.is_null() {
        return false;
    }
    unsafe { AXUIElementSetMessagingTimeout(system.0, 0.035) };
    element_at(system.0, request.x, request.y)
        .filter(|hit| pid_of(hit.0) == Some(pid))
        .and_then(|hit| element_attribute(hit.0, "AXWindow"))
        .is_some_and(|window| unsafe { CFEqual(window.0, root) != 0 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

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
            dock: None,
            at: Instant::now(),
        };
        let raw = [window(1, 2), window(2, 2), window(3, 0)];
        assert_eq!(
            window_at(&raw, &request, 1, |_| false).map(|(window, verify)| (window.pid, verify)),
            Some((3, false))
        );
        assert!(window_at(&[window(4, 2), window(3, 0)], &request, 1, |_| true).is_none());
        let overlay = [window(4, 21), window(3, 0)];
        assert!(window_at(&overlay, &request, 1, |_| false).is_none());
        assert_eq!(
            window_at(&overlay, &request, 1, |window| window.pid == 4)
                .map(|(window, verify)| (window.pid, verify)),
            Some((3, true))
        );
        assert!(
            window_at(
                &[window(4, 21), window(5, 2), window(3, 0)],
                &request,
                1,
                |_| true
            )
            .is_none()
        );
    }
}
