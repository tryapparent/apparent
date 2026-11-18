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
