#[derive(Default)]
struct DesktopFrog {
    name: Option<String>,
    takeoff: Option<[f64; 3]>,
    checked: Option<std::time::Instant>,
    equipped: Vec<&'static str>,
    achievement: Option<crate::capture::desktop::frog_wardrobe::Achievement>,
    host: Option<crate::capture::desktop::settings::onboarding::DesktopFrogHost>,
}

impl gpui::Global for DesktopFrog {}

pub(in crate::capture::desktop) fn supported() -> bool {
    #[cfg(target_os = "macos")]
    { true }
    #[cfg(target_os = "linux")]
    {
        use crate::capture::desktop::linux;
        (!linux::wayland_session() || (linux::hyprland() && linux::hyprland::managed_note_windows()))
            && linux::x11::x().is_some()
    }
}

pub(in crate::capture::desktop) fn land_desktop_frog(cx: &mut gpui::App, takeoff: [f64; 3]) {
    let frog = cx.default_global::<DesktopFrog>();
    frog.takeoff = Some(takeoff);
    frog.checked = frog.host.take().map(|_| std::time::Instant::now());
}

pub(in crate::capture::desktop) fn poll_desktop_frog(
    cx: &mut gpui::App,
    unavailable: bool,
    shortcut: impl FnOnce() -> String,
) -> bool {
    use crate::capture::desktop::settings::onboarding::{DesktopFrogHost, frog_policy};
    let frog = cx.default_global::<DesktopFrog>();
    let refresh = frog
        .checked
        .is_none_or(|time| time.elapsed().as_millis() >= 1500);
    if refresh {
        frog.checked = Some(std::time::Instant::now());
        use crate::capture::desktop::frog_wardrobe;
        let config = crate::shared::handoff::read_preferences(&crate::shared::handoff::default_config_path()).ok();
        let name = config.as_ref().filter(|_| supported())
            .and_then(frog_wardrobe::frog_name).map(str::to_owned);
        if let Some(config) = &config {
            (frog.equipped, frog.achievement) = frog_wardrobe::projection(config);
        }
        if frog.name != name {
            frog.name = name;
            if frog.host.take().is_some() {
                return false;
            }
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
    match host.tick(visible, &shortcut(), &frog.equipped, frog.achievement) {
        Some(start) => start,
        None => {
            frog.host = None;
            false
        }
    }
}

#[cfg(target_os = "linux")]
pub(in crate::capture::desktop) fn hide_for_capture(cx: &mut gpui::App, shortcut: &str) {
    let frog = cx.default_global::<DesktopFrog>();
    if let Some(host) = frog.host.as_mut()
        && host.project(false, shortcut, &frog.equipped, frog.achievement).is_none()
    {
        frog.host = None;
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
    let shortcut = || telemetry.shortcut.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner).label.clone();
    if poll_desktop_frog(cx, unavailable, shortcut) {
        loop_coord.update(cx, |coord, cx| {
            if !coord.capture_busy() && coord.onboarding.is_none()
                && !super::super::shutdown::requested()
            {
                coord.record_screen_now(cx);
            }
        });
        let busy = loop_coord.read(cx).capture_busy();
        let frog = cx.default_global::<DesktopFrog>();
        if let Some(host) = frog.host.as_mut() {
            if host.project(!busy, &shortcut(), &frog.equipped, frog.achievement).is_none() || !host.settle_record_request() {
                frog.host = None;
            }
        }
    }
}
