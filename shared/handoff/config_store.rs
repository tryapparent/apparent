//! Serialized JSON config storage shared by CLI and GUI writers.
use anyhow::Result;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(crate) struct ConfigPublicationUncertain;

impl std::fmt::Display for ConfigPublicationUncertain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Config was published but durability was not confirmed")
    }
}

impl std::error::Error for ConfigPublicationUncertain {}

pub fn default_config_path() -> PathBuf {
    std::env::var_os("APPARENT_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".config/apparent/config.json")
        })
}

/// Sets one top-level key in `path` (`null` removes it), keeping the rest (and its `0600` mode,
/// since it holds the ingest token).
pub fn set_config_value_in(path: &Path, key: &str, value: serde_json::Value) -> Result<()> {
    update_config_in(path, |config| {
        if value.is_null() {
            config.as_object_mut().unwrap().remove(key);
        } else {
            config[key] = value;
        }
        Ok(())
    })
}

// One sidecar inode for every CLI/GUI writer, never the replaced config inode.
// Hosted operations take queue.lock first; this transaction never acquires a
// queue lock or performs network work. Keep nested edits inside this closure.
pub(crate) fn update_config_in(
    path: &Path,
    edit: impl FnOnce(&mut serde_json::Value) -> Result<()>,
) -> Result<()> {
    update_config_checked_in(path, None, edit)
}

/// Connect's background authorization writes must recheck cancellation after
/// acquiring the shared writer lock. Other settings keep their existing wait policy.
pub(crate) fn update_config_allowed_in(
    path: &Path,
    allowed: &dyn Fn() -> bool,
    edit: impl FnOnce(&mut serde_json::Value) -> Result<()>,
) -> Result<()> {
    update_config_checked_in(path, Some(allowed), edit)
}

mod actor;

fn update_config_checked_in(
    path: &Path,
    allowed: Option<&dyn Fn() -> bool>,
    edit: impl FnOnce(&mut serde_json::Value) -> Result<()>,
) -> Result<()> {
    actor::update(path, allowed, edit)
}

#[cfg(test)]
thread_local! {
    static CONFIG_WRITE_HOOK: std::cell::RefCell<Option<Box<dyn FnMut(&str, &Path)>>> =
        const { std::cell::RefCell::new(None) };
    static CONFIG_DIRECTORY_SYNC_FAILURE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
pub(crate) fn set_config_directory_sync_failure(fail: bool) {
    CONFIG_DIRECTORY_SYNC_FAILURE.with(|failure| failure.set(fail));
}

#[cfg(test)]
pub(crate) fn set_config_write_hook(hook: Option<Box<dyn FnMut(&str, &Path)>>) {
    CONFIG_WRITE_HOOK.with(|slot| *slot.borrow_mut() = hook);
}

#[cfg(test)]
fn config_write_hook(point: &str, path: &Path) {
    CONFIG_WRITE_HOOK.with(|slot| {
        if let Ok(mut slot) = slot.try_borrow_mut()
            && let Some(hook) = slot.as_mut()
        {
            hook(point, path);
        }
    });
}
