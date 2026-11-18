use crate::permission_facts::{Grants, Permission, Status};

include!(concat!(env!("OUT_DIR"), "/recording_permissions.rs"));

#[cfg(target_os = "macos")]
const REQUIREMENTS: [&[Permission]; 2] = MACOS;
#[cfg(not(target_os = "macos"))]
const REQUIREMENTS: [&[Permission]; 2] = LINUX;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Admission {
    Ready,
    Checking,
    Blocked(Vec<Permission>),
}

pub(crate) fn requires(permission: Permission, microphone: bool) -> bool {
    REQUIREMENTS[usize::from(microphone)].contains(&permission)
}

pub(crate) fn check(grants: Option<&Grants>, microphone: bool) -> Admission {
    check_required(grants, REQUIREMENTS[usize::from(microphone)])
}

fn check_required(grants: Option<&Grants>, required: &[Permission]) -> Admission {
    if required.is_empty() {
        return Admission::Ready;
    }
    let Some(grants) = grants else {
        return Admission::Checking;
    };
    let blocked: Vec<_> = required
        .iter()
        .copied()
        .filter(|permission| {
            grants.status(*permission) != Status::Unavailable && !grants.usable(*permission)
        })
        .collect();
    if !blocked.is_empty() {
        Admission::Blocked(blocked)
    } else if required
        .iter()
        .any(|permission| grants.status(*permission) == Status::Unavailable)
    {
        Admission::Checking
    } else {
        Admission::Ready
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_recording_requires_current_usable_grants_and_honors_the_microphone_setting() {
        let [silent, narrated] = MACOS;
        let mut grants = Grants::unavailable();
        assert_eq!(check_required(None, silent), Admission::Checking);
        assert_eq!(check_required(Some(&grants), silent), Admission::Checking);

        for permission in [Permission::ScreenRecording, Permission::Accessibility] {
            grants.statuses.insert(permission, Status::Granted);
        }
        grants
            .statuses
            .insert(Permission::Microphone, Status::Denied);
        assert_eq!(check_required(Some(&grants), silent), Admission::Ready);
        assert_eq!(
            check_required(Some(&grants), narrated),
            Admission::Blocked(vec![Permission::Microphone])
        );

        grants.screen_needs_relaunch = true;
        assert_eq!(
            check_required(Some(&grants), silent),
            Admission::Blocked(vec![Permission::ScreenRecording])
        );
        grants.screen_needs_relaunch = false;
        grants
            .statuses
            .insert(Permission::ScreenRecording, Status::Denied);
        assert_eq!(
            check_required(Some(&grants), silent),
            Admission::Blocked(vec![Permission::ScreenRecording])
        );
        grants
            .statuses
            .insert(Permission::ScreenRecording, Status::Granted);
        assert_eq!(check_required(Some(&grants), silent), Admission::Ready);
    }

    #[test]
    fn linux_recording_defers_screen_authorization_to_the_capture_and_allows_missing_input_access()
    {
        let [silent, narrated] = LINUX;
        let mut grants = Grants::default();
        grants
            .statuses
            .insert(Permission::Accessibility, Status::Denied);
        assert_eq!(check_required(None, silent), Admission::Ready);
        assert_eq!(check_required(Some(&grants), narrated), Admission::Ready);
    }
}
