pub(crate) mod connect;
mod agents;
pub(crate) use agents::persist_t3_connection;
mod labs;
pub(crate) mod onboarding;
pub(crate) mod onboarding_window;
pub(crate) mod settings;
pub(in crate::capture::desktop) mod presentation;
#[cfg(target_os = "linux")]
mod storage;
pub(crate) mod settings_window;
pub(crate) mod shortcut;

pub(crate) use settings::*;

pub(crate) mod practice;

fn save_launch_at_login(
    path: &std::path::Path,
    on: bool,
    set: impl FnOnce(bool) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    let key = "launchAtLogin";
    let previous = std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|config| config.get(key).cloned())
        .unwrap_or(serde_json::Value::Null);
    crate::shared::handoff::set_config_value_in(path, key, on.into())?;
    if let Err(error) = set(on) {
        if let Err(rollback) = crate::shared::handoff::set_config_value_in(path, key, previous) {
            crate::capture::engine::runtime::apparent_log(format!("Restoring {key} failed: {rollback:#}"));
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) fn apply_quit_login_preference(on: bool) -> anyhow::Result<()> {
    let current = login_item();
    anyhow::ensure!(option_env!("APPARENT_PREVIEW_BUILD").is_none() && current != LoginItem::Unavailable,
        "Startup settings unavailable");
    let registered = matches!(current, LoginItem::On | LoginItem::NeedsApproval);
    save_launch_at_login(&crate::shared::handoff::default_config_path(), on, |wanted| {
        if wanted == registered { Ok(()) } else { set_login_item(wanted) }
    })?;
    if on && login_item() == LoginItem::NeedsApproval {
        settings::open_startup_settings_for_quit();
    }
    Ok(())
}

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub checking: bool,
    pub result: Option<UpdateResult>,
    #[cfg(target_os = "linux")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) progress: Option<crate::capture::desktop::linux::update::UpdateProgress>,
    #[cfg(target_os = "linux")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) failure: Option<UpdateFailure>,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateFailure {
    Busy,
    RateLimited,
    Download,
    Verification,
    Installation,
    Restart,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateResult {
    Available,
    Current,
    Failed,
}

impl UpdateResult {
    pub fn label(self) -> &'static str {
        match self {
            Self::Available => "Update available",
            Self::Current => "No update available",
            Self::Failed => "Update check failed",
        }
    }
}

impl UpdateCheck {
    #[cfg(target_os = "linux")]
    pub(super) fn finish(&mut self, result: Result<&'static str, (String, Option<UpdateFailure>)>) {
        use crate::capture::desktop::linux::update::UpdateProgress;
        self.checking = false;
        let progress = self.progress.take();
        self.result = Some(match result {
            Ok("installed; restart Apparent to use it") | Ok("already installed; restart Apparent to use it") =>
                UpdateResult::Available,
            Ok("up to date") => UpdateResult::Current,
            Ok(other) => {
                crate::capture::engine::runtime::apparent_log(format!("Unexpected update check result: {other}"));
                use crate::capture::desktop::workflow::error_reporting::{self, updates::{Stage, Trigger}};
                let error = error_reporting::updates::failure(Stage::UnexpectedResult, anyhow::anyhow!("unexpected updater response"));
                error_reporting::report_update(&error, Trigger::User);
                UpdateResult::Failed
            }
            Err((error, failure)) => {
                crate::capture::engine::runtime::apparent_log(format!("Could not check for updates: {error}"));
                self.failure = failure.or(match progress {
                    Some(UpdateProgress::Downloading { .. }) => Some(UpdateFailure::Download),
                    Some(UpdateProgress::Verifying) => Some(UpdateFailure::Verification),
                    Some(UpdateProgress::Installing) => Some(UpdateFailure::Installation),
                    None => None,
                });
                UpdateResult::Failed
            }
        });
    }
}

#[cfg(target_os = "linux")]
fn update_failure(error: &anyhow::Error) -> Option<UpdateFailure> {
    use crate::capture::desktop::workflow::error_reporting::updates;
    if updates::is_lock_contention(error) {
        Some(UpdateFailure::Busy)
    } else if updates::is_rate_limited(error) {
        Some(UpdateFailure::RateLimited)
    } else {
        None
    }
}
