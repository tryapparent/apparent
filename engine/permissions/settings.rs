use crate::capture::engine::runtime::recording::recorder::selection;
use crate::permission_admission::{Row, project_rows};
use crate::permission_facts::{Grants, Permission, Status};

pub(crate) use crate::permission_admission::PermissionIntent;
use crate::shared::handoff::{Config, load_config_from, write_preference};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::Path;
use std::time::{Duration, Instant};

#[derive(Default)]
pub(crate) struct PermissionsPresenter {
    pending: Option<(u32, PermissionIntent, Instant)>,
    reopen: Option<u32>,
    effects: crate::permission_native::Effects,
}

pub(crate) enum Outcome {
    Reply(u32, Option<&'static str>),
    Reopen,
}

impl PermissionsPresenter {
    pub(crate) fn take_reopen_request(&mut self) -> Option<u32> {
        self.reopen.take()
    }

    pub(crate) fn waiting(&self) -> bool {
        self.pending.is_some()
    }

    pub(crate) fn begin(
        &mut self,
        request: u32,
        intent: PermissionIntent,
        config_path: &Path,
    ) -> Option<Outcome> {
        if self.waiting() {
            return Some(Outcome::Reply(request, Some("busy")));
        }
        if let PermissionIntent::ScreenSelection { skip } = intent {
            return Some(Outcome::Reply(
                request,
                save_screen_selection(config_path, skip),
            ));
        }
        self.pending = Some((request, intent, Instant::now()));
        None
    }

    pub(crate) fn expire(&mut self) -> Option<u32> {
        let (request, _, since) = self.pending?;
        if since.elapsed() < Duration::from_secs(3) {
            return None;
        }
        self.pending = None;
        Some(request)
    }

    pub(crate) fn observe(
        &mut self,
        grants: &Grants,
        requested: &mut BTreeSet<Permission>,
        config_path: &Path,
    ) -> Option<Outcome> {
        if let Some(request) = self.expire() {
            return Some(Outcome::Reply(request, Some("unavailable")));
        }
        if !grants.is_current() {
            return None;
        }
        self.effects.observe(grants);
        let (request, intent, since) = self.pending?;
        if grants.observed_at? < since {
            return None;
        }
        if matches!(intent, PermissionIntent::Recheck) {
            self.pending = None;
            return Some(Outcome::Reply(request, None));
        }
        let config = load_config_from(config_path);
        let selected = rows(Some(grants), requested, &config, false).find(|row| match intent {
            PermissionIntent::Reopen => row.relaunch,
            PermissionIntent::Repair { permission, repair } => {
                row.permission == permission && repair.matches(row.repair)
            }
            PermissionIntent::Recheck | PermissionIntent::ScreenSelection { .. } => false,
        });
        if let Some(request) = self.expire() {
            return Some(Outcome::Reply(request, Some("unavailable")));
        }
        if !grants.is_current() {
            return None;
        }
        self.pending = None;
        let Some(row) = selected else {
            return Some(Outcome::Reply(request, Some("changed")));
        };
        if matches!(intent, PermissionIntent::Reopen) {
            self.reopen = Some(request);
            return Some(Outcome::Reopen);
        }
        let error = match self.effects.perform(row.permission, row.repair) {
            Ok(()) => {
                requested.insert(row.permission);
                None
            }
            Err(error) => {
                crate::capture::engine::runtime::apparent_log(format!("Permissions: {error:#}"));
                Some("failed")
            }
        };
        Some(Outcome::Reply(request, error))
    }
}

use crate::permission_native::platform;
pub(crate) use crate::permission_native::restart;

fn save_screen_selection(config_path: &Path, skip: bool) -> Option<&'static str> {
    if !selection::supported() {
        return Some("unavailable");
    }
    write_preference(config_path, selection::PREFERENCE, Some(skip.into()))
        .err()
        .map(|_| "failed")
}

pub(crate) fn screen_relaunch(grants: Option<&Grants>, path: &Path) -> bool {
    crate::permission_admission::screen_relaunch(grants, &load_config_from(path))
}

pub(crate) fn legacy_repair(
    permission: Permission,
    status: Status,
    requested: &mut BTreeSet<Permission>,
) -> crate::permission_admission::Repair {
    use crate::permission_admission::{Repair, repair};
    let repair = repair(status, requested.contains(&permission), false, false);
    if matches!(repair, Repair::Request | Repair::OpenSettings) {
        requested.insert(permission);
    }
    repair
}

pub(crate) fn reply(request: u32, error: Option<&str>) -> Value {
    json!({"type":"permission-result", "request":request, "error":error})
}

pub(crate) fn rows<'a>(
    grants: Option<&'a Grants>,
    requested: &'a BTreeSet<Permission>,
    config: &'a Config,
    legacy: bool,
) -> impl Iterator<Item = Row> + 'a {
    project_rows(
        platform(),
        grants,
        requested,
        config.microphone_enabled.unwrap_or(true),
        config,
        legacy,
    )
}

pub(crate) fn state(
    grants: Option<&Grants>,
    requested: &BTreeSet<Permission>,
    config_path: &Path,
) -> Value {
    let config = load_config_from(config_path);
    let rows: Vec<_> = rows(grants, requested, &config, false).collect();
    json!({
        "type": "permission-state",
        "state": {
            "platform": platform(),
            "rows": rows,
            "accessChecked": grants.is_some_and(Grants::is_current),
            "screenSelection": selection::preference(&config),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_selection_preserves_explicit_choices_and_defaults_to_the_picker() {
        use crate::permission_admission::{ScreenSelection, screen_selection};
        assert_eq!(screen_selection(true, None), ScreenSelection::Picker);
        assert_eq!(screen_selection(false, None), ScreenSelection::Unavailable);
        assert_eq!(
            screen_selection(true, Some(false)),
            ScreenSelection::Picker
        );
        assert_eq!(
            screen_selection(true, Some(true)),
            ScreenSelection::FullDisplay
        );
    }

    #[test]
    fn screen_selection_prefers_canonical_values_and_resets_to_policy_default() {
        use crate::permission_admission::{ScreenSelection, screen_selection};

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let stored = || {
            let config = load_config_from(&path);
            screen_selection(true, config.skip_screen_selection)
        };
        std::fs::write(&path, br#"{"experiments":{"chooseScreenEachTime":false,"other":true}}"#).unwrap();
        assert_eq!(stored(), ScreenSelection::FullDisplay);
        std::fs::write(&path, br#"{"experiments":{"chooseScreenEachTime":false,"other":true},"permissions":{"skipScreenSelection":false}}"#).unwrap();
        assert_eq!(stored(), ScreenSelection::Picker);
        let before = std::fs::read(&path).unwrap();
        assert!(write_preference(&path, selection::PREFERENCE, Some("false".into())).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        write_preference(&path, selection::PREFERENCE, None).unwrap();
        assert_eq!(stored(), screen_selection(true, None));
        let saved = crate::shared::handoff::read_preferences(&path).unwrap();
        assert_eq!(saved["experiments"]["other"], true);
        assert!(saved["experiments"].get("chooseScreenEachTime").is_none());
        assert!(saved["permissions"].get("skipScreenSelection").is_none());
    }

    #[test]
    fn recheck_requires_an_observation_started_after_the_request() {
        let mut presenter = PermissionsPresenter::default();
        let mut grants = Grants {
            observed_at: Some(Instant::now()),
            ..Grants::default()
        };
        let mut requested = BTreeSet::new();
        let path = Path::new("");
        assert!(
            presenter
                .begin(1, PermissionIntent::Recheck, path)
                .is_none()
        );
        assert!(presenter.observe(&grants, &mut requested, path).is_none());
        grants.observed_at = Some(Instant::now());
        assert!(matches!(
            presenter.observe(&grants, &mut requested, path),
            Some(Outcome::Reply(1, None))
        ));
    }

    #[test]
    fn a_late_observation_cannot_take_an_expired_action() {
        let mut presenter = PermissionsPresenter {
            pending: Some((
                1,
                PermissionIntent::Reopen,
                Instant::now() - Duration::from_secs(4),
            )),
            ..PermissionsPresenter::default()
        };
        let grants = Grants {
            observed_at: Some(Instant::now()),
            ..Grants::default()
        };
        assert!(matches!(
            presenter.observe(&grants, &mut BTreeSet::new(), Path::new("")),
            Some(Outcome::Reply(1, Some("unavailable")))
        ));
        assert!(!presenter.waiting());
    }
}
