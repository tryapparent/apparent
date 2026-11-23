#[derive(Default)]
struct DesktopFrog {
    name: Option<String>,
    takeoff: Option<[f64; 3]>,
    checked: Option<std::time::Instant>,
    host: Option<crate::capture::desktop::settings::onboarding::DesktopFrogHost>,
}

impl gpui::Global for DesktopFrog {}

pub(in crate::capture::desktop) fn land_desktop_frog(cx: &mut gpui::App, takeoff: [f64; 3]) {
    let frog = cx.default_global::<DesktopFrog>();
    frog.takeoff = Some(takeoff);
    frog.checked = None;
    frog.host = None;
}

pub(in crate::capture::desktop) fn poll_desktop_frog(
    cx: &mut gpui::App,
    unavailable: bool,
    shortcut: impl FnOnce() -> String,
) -> bool {
    use crate::capture::desktop::settings::onboarding::{DesktopFrogHost, Progress, frog_policy};
    let frog = cx.default_global::<DesktopFrog>();
    let refresh = frog
        .checked
        .is_none_or(|time| time.elapsed().as_millis() >= 1500);
    if refresh {
        frog.checked = Some(std::time::Instant::now());
        let name = if crate::shared::handoff::experiment("desktopFrog") {
            let saved = Progress::load();
            saved.frog_name.filter(|_| saved.frog_adopted)
        } else {
            None
        };
        if frog.name != name {
            frog.host = None;
            frog.name = name;
        }
    }
    let visible =
        frog_policy::VISIBLE[usize::from(frog.name.is_some()) * 2 + usize::from(unavailable)];
    if let (true, None, Some(name)) = (visible, frog.host.as_ref(), &frog.name)
        && refresh
    {
        frog.host = DesktopFrogHost::open(name, frog.takeoff.take()).ok();
    }
    let Some(host) = frog.host.as_mut() else {
        return false;
    };
    match host.tick(visible, &shortcut()) {
        Some(start) => start,
        None => {
            frog.host = None;
            false
        }
    }
}

pub(super) fn poll_for(
    cx: &mut gpui::App,
    loop_coord: &gpui::Entity<crate::capture::desktop::ApparentCoordinator>,
) {
    let coord = loop_coord.read(cx);
    let unavailable =
        coord.capture_busy() || coord.onboarding.is_some() || super::super::shutdown::requested();
    let telemetry = coord.telemetry.clone();
    if poll_desktop_frog(cx, unavailable, || {
        telemetry
            .shortcut
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .label
            .clone()
    }) {
        loop_coord.update(cx, |coord, cx| coord.record_or_finish(cx));
    }
}
