use super::super::{
    AXUIElementCreateSystemWide, AXUIElementSetMessagingTimeout, Owned,
    browser::is_notification_surface, element_at, pid_of,
};
use super::{RawWindow, Request};

pub(super) fn window_at<'a>(
    raw: &'a [RawWindow],
    request: &Request,
    own: i32,
    direct_owner: impl FnOnce() -> Option<i32>,
) -> Option<&'a RawWindow> {
    let mut windows = raw.iter().filter(|window| {
        let [x, y, w, h] = window.bounds;
        window.pid != own
            && window.pid as u32 != request.note_pid
            && window.alpha > 0.01
            && request.x >= x
            && request.y >= y
            && request.x < x + w
            && request.y < y + h
    });
    let mut window = windows.next()?;
    if is_notification_surface(window) {
        let owner = direct_owner()?;
        window = windows.find(|candidate| !is_notification_surface(candidate))?;
        if window.pid != owner {
            return None;
        }
    }
    (window.layer == 0 && !crate::capture::ui_process::owns(window.pid)).then_some(window)
}

pub(super) fn system_hit_owner(request: &Request) -> Option<i32> {
    let system = Owned(unsafe { AXUIElementCreateSystemWide() });
    if system.0.is_null() {
        return None;
    }
    unsafe { AXUIElementSetMessagingTimeout(system.0, 0.035) };
    pid_of(element_at(system.0, request.x, request.y)?.0)
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
            window_at(&raw, &request, 1, || unreachable!()).map(|window| window.pid),
            Some(3)
        );
        assert!(
            window_at(
                &[window(4, 2), window(3, 0)],
                &request,
                1,
                || unreachable!()
            )
            .is_none()
        );

        let mut notification = window(4, 21);
        notification.owner = "Notification Center".into();
        let over_app = [notification.clone(), window(3, 0), window(5, 0)];
        assert_eq!(
            window_at(&over_app, &request, 1, || Some(3)),
            Some(&over_app[1])
        );
        for owner in [None, Some(4), Some(5)] {
            assert!(window_at(&over_app, &request, 1, || owner).is_none());
        }

        let foreign_overlay = [notification, window(5, 24), window(3, 0)];
        assert!(window_at(&foreign_overlay, &request, 1, || Some(3)).is_none());
    }
}
