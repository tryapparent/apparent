use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Permission {
    ScreenRecording,
    Microphone,
    InputMonitoring,
    Accessibility,
    Camera,
    SpeechRecognition,
}

impl Permission {
    pub fn draggable(self) -> bool {
        matches!(self, Self::ScreenRecording | Self::Accessibility)
    }

    pub(crate) fn asked(self, grants: Option<&Grants>) -> bool {
        self != Self::SpeechRecognition
            || grants.is_some_and(|grants| grants.statuses.contains_key(&self))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    #[default]
    NotDetermined,
    Denied,
    Granted,
    Unavailable,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Grants {
    pub statuses: BTreeMap<Permission, Status>,
    pub screen_needs_relaunch: bool,
    pub(crate) observed_at: Option<Instant>,
}

impl Grants {
    pub(crate) fn unavailable() -> Self {
        Self {
            statuses: [
                Permission::ScreenRecording,
                Permission::Microphone,
                Permission::Accessibility,
                Permission::Camera,
            ]
            .into_iter()
            .map(|permission| (permission, Status::Unavailable))
            .collect(),
            screen_needs_relaunch: false,
            observed_at: None,
        }
    }

    pub(crate) fn is_current(&self) -> bool {
        const MAX_AGE: Duration = Duration::from_secs(3);
        self.observed_at
            .is_some_and(|time| time.elapsed() < MAX_AGE)
    }

    pub(crate) fn same_permissions(&self, other: &Self) -> bool {
        self.statuses == other.statuses && self.screen_needs_relaunch == other.screen_needs_relaunch
    }

    pub fn status(&self, permission: Permission) -> Status {
        self.statuses.get(&permission).copied().unwrap_or_default()
    }

    pub fn granted(&self, permission: Permission) -> bool {
        self.status(permission) == Status::Granted
    }

    pub(crate) fn usable(&self, permission: Permission) -> bool {
        self.granted(permission)
            && !(permission == Permission::ScreenRecording && self.screen_needs_relaunch)
    }
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn reconcile_native_grants(
    mut statuses: BTreeMap<Permission, Status>,
    screen: bool,
    accessibility: bool,
) -> BTreeMap<Permission, Status> {
    statuses.insert(
        Permission::ScreenRecording,
        if screen {
            Status::Granted
        } else {
            Status::NotDetermined
        },
    );
    statuses.insert(
        Permission::Accessibility,
        if accessibility {
            Status::Granted
        } else {
            Status::NotDetermined
        },
    );
    statuses
}

pub(crate) fn observe(
    read_statuses: impl FnOnce() -> anyhow::Result<BTreeMap<Permission, Status>>,
    #[cfg(target_os = "macos")] read_screen_grant: impl FnOnce() -> anyhow::Result<bool>,
) -> Option<Grants> {
    use crate::capture::engine::runtime;
    let observed_at = Instant::now();
    let read = || {
        let statuses = read_statuses()?;
        #[cfg(target_os = "macos")]
        let statuses = reconcile_native_grants(
            statuses,
            read_screen_grant()?,
            runtime::accessibility_granted(),
        );
        let screen_granted = statuses.get(&Permission::ScreenRecording) == Some(&Status::Granted);
        let grants = Grants {
            statuses,
            screen_needs_relaunch: screen_granted && !runtime::screen_capture_usable(true),
            observed_at: Some(observed_at),
        };
        runtime::audio::transcription::speech_model::note_speech_permission(
            grants.granted(Permission::SpeechRecognition),
        );
        anyhow::Ok(grants)
    };
    read()
        .inspect_err(|error| runtime::apparent_log(format!("permissions: {error:#}")))
        .ok()
        .filter(Grants::is_current)
}
