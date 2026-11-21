use crate::capture::engine::runtime::recording::recorder::selection;
use crate::permission_facts::{Grants, Permission, Status};
use crate::shared::handoff::Config;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

include!(concat!(env!("OUT_DIR"), "/recording_permissions.rs"));

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ScreenSelection {
    Unavailable,
    Picker,
    FullDisplay,
}

pub(crate) fn screen_selection(supported: bool, saved: Option<bool>) -> ScreenSelection {
    let saved = match saved {
        None => 0,
        Some(true) => 1,
        Some(false) => 2,
    };
    SCREEN_SELECTION[usize::from(supported) * 3 + saved]
}

pub(crate) fn save_picker(skip: bool) -> bool {
    SAVE_PICKER[usize::from(skip)]
}

#[derive(Clone, Copy)]
pub(crate) enum ScreenAuthorization {
    ExistingGrant,
    SessionSelection,
}

impl ScreenAuthorization {
    pub(crate) const CURRENT: Self = if cfg!(target_os = "macos") {
        Self::ExistingGrant
    } else {
        Self::SessionSelection
    };

    pub(crate) fn for_screen_recording(use_picker: bool) -> Self {
        if use_picker {
            Self::SessionSelection
        } else {
            Self::CURRENT
        }
    }

    fn requirements(self, microphone: bool) -> &'static [Permission] {
        #[cfg(target_os = "macos")]
        let modes = match self {
            Self::ExistingGrant => MACOS,
            Self::SessionSelection => MACOS_PICKER,
        };
        #[cfg(not(target_os = "macos"))]
        let modes = match self {
            Self::ExistingGrant | Self::SessionSelection => LINUX,
        };
        modes[usize::from(microphone)]
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Admission {
    Ready,
    Checking,
    Blocked(Vec<Permission>),
}

pub(crate) fn check(grants: Option<&Grants>, microphone: bool) -> Admission {
    check_for(grants, microphone, ScreenAuthorization::CURRENT)
}

pub(crate) fn check_recording_start(grants: Option<&Grants>, microphone: bool) -> Admission {
    check_for(
        grants,
        microphone,
        ScreenAuthorization::for_screen_recording(selection::requested()),
    )
}

pub(crate) fn requires(
    permission: Permission,
    microphone: bool,
    config: &crate::shared::handoff::Config,
) -> bool {
    ScreenAuthorization::for_screen_recording(selection::enabled_in(config))
        .requirements(microphone)
        .contains(&permission)
}

pub(crate) fn screen_relaunch(grants: Option<&Grants>, config: &Config) -> bool {
    grants.is_some_and(|g| g.granted(Permission::ScreenRecording) && g.screen_needs_relaunch)
        && !selection::enabled_in(config)
}

pub(crate) fn check_for(
    grants: Option<&Grants>,
    microphone: bool,
    authorization: ScreenAuthorization,
) -> Admission {
    check_required(grants, authorization.requirements(microphone))
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
    fn macos_picker_admission_requires_accessibility_and_any_requested_microphone() {
        let [silent, narrated] = MACOS_PICKER;
        let mut grants = Grants::unavailable();
        grants
            .statuses
            .insert(Permission::ScreenRecording, Status::Denied);
        grants
            .statuses
            .insert(Permission::Accessibility, Status::Denied);
        grants
            .statuses
            .insert(Permission::Microphone, Status::Denied);
        assert_eq!(
            check_required(Some(&grants), silent),
            Admission::Blocked(vec![Permission::Accessibility])
        );
        grants
            .statuses
            .insert(Permission::Accessibility, Status::Granted);
        assert_eq!(check_required(Some(&grants), silent), Admission::Ready);
        assert_eq!(
            check_required(Some(&grants), narrated),
            Admission::Blocked(vec![Permission::Microphone])
        );
        grants
            .statuses
            .insert(Permission::Microphone, Status::Granted);
        assert_eq!(check_required(Some(&grants), narrated), Admission::Ready);
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Repair {
    None,
    Request,
    OpenSettings,
    CopyInput,
}

pub(crate) fn repair(
    status: Status,
    requested: bool,
    open_directly: bool,
    copy_input: bool,
) -> Repair {
    let observed = match status {
        Status::NotDetermined => 0,
        Status::Denied => 1,
        Status::Granted => 2,
        Status::Unavailable => 3,
    };
    let index = observed
        | (usize::from(requested) << 2)
        | (usize::from(open_directly) << 3)
        | (usize::from(copy_input) << 4);
    REPAIR[index]
}

#[derive(Clone, Copy, Deserialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum PermissionIntent {
    Recheck,
    ScreenSelection { skip: bool },
    Repair {
        permission: Permission,
        repair: RepairIntent,
    },
    Reopen,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RepairIntent {
    Request,
    OpenSettings,
    CopyInput,
}

impl RepairIntent {
    pub(crate) fn matches(self, repair: Repair) -> bool {
        matches!(
            (self, repair),
            (Self::Request, Repair::Request)
                | (Self::OpenSettings, Repair::OpenSettings)
                | (Self::CopyInput, Repair::CopyInput)
        )
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Platform {
    Macos,
    Wayland,
    X11,
}

impl Platform {
    fn rows(self) -> impl Iterator<Item = Permission> {
        use Permission::*;
        let mask = ROWS[self as usize];
        [
            ScreenRecording,
            Microphone,
            Accessibility,
            Camera,
            SpeechRecognition,
        ]
        .into_iter()
        .enumerate()
        .filter_map(move |(index, permission)| (mask & (1 << index) != 0).then_some(permission))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Row {
    pub(crate) permission: Permission,
    pub(crate) status: Status,
    pub(crate) required: bool,
    pub(crate) relaunch: bool,
    pub(crate) requested: bool,
    pub(crate) repair: Repair,
}

pub(crate) fn project_rows<'a>(
    platform: Platform,
    grants: Option<&'a Grants>,
    requested: &'a BTreeSet<Permission>,
    microphone: bool,
    config: &'a Config,
    legacy: bool,
) -> impl Iterator<Item = Row> + 'a {
    let grants = grants.filter(|grants| legacy || grants.is_current());
    platform
        .rows()
        .filter(move |permission| permission.asked(grants))
        .map(move |permission| {
            let status = grants.map_or(
                if legacy {
                    Status::NotDetermined
                } else {
                    Status::Unavailable
                },
                |grants| grants.status(permission),
            );
            let relaunch = permission == Permission::ScreenRecording && screen_relaunch(grants, config);
            let copy_input =
                matches!(platform, Platform::Wayland) && permission == Permission::Accessibility;
            let repair = if matches!(platform, Platform::Macos) || copy_input {
                repair(status, requested.contains(&permission), false, copy_input)
            } else {
                Repair::None
            };
            Row {
                permission,
                status,
                required: requires(permission, microphone, config),
                relaunch,
                requested: requested.contains(&permission),
                repair,
            }
        })
}
