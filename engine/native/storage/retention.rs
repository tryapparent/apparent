use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::shared::handoff::preference_value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    #[serde(default = "default_media_days")]
    pub media_days: Option<u32>,
    #[serde(default = "default_bundle_days")]
    pub bundle_days: Option<u32>,
}

fn default_media_days() -> Option<u32> {
    Some(7)
}

fn default_bundle_days() -> Option<u32> {
    Some(30)
}

pub(crate) const MEDIA_DAYS: &str = "storage.mediaDays";
pub(crate) const BUNDLE_DAYS: &str = "storage.bundleDays";

impl Default for Policy {
    fn default() -> Self {
        Self { media_days: Some(7), bundle_days: Some(30) }
    }
}

impl Policy {
    pub fn load() -> Self {
        Self::load_from(&crate::shared::handoff::default_config_path())
    }

    pub fn load_from(path: &Path) -> Self {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .map(|config| Self::from_config(&config))
            .unwrap_or_default()
    }

    pub(crate) fn from_config(config: &serde_json::Value) -> Self {
        let [media_days, bundle_days] = Self::saved_fields(config);
        let days = |value: Option<serde_json::Value>, default| {
            value.map_or(default, |value| {
                value.as_u64().and_then(|days| u32::try_from(days).ok())
            })
        };
        Self {
            media_days: days(media_days, default_media_days()),
            bundle_days: days(bundle_days, default_bundle_days()),
        }
    }

    pub(crate) fn saved_fields(config: &serde_json::Value) -> [Option<serde_json::Value>; 2] {
        let has_canonical = ["mediaDays", "bundleDays"]
            .iter()
            .any(|key| config["storage"].get(*key).is_some());
        if !has_canonical && config.get("retention").is_some_and(|legacy| {
            serde_json::from_value::<Self>(legacy.clone()).is_err()
        }) {
            return [None, None];
        }
        [MEDIA_DAYS, BUNDLE_DAYS].map(|id| preference_value(config, id))
    }
}
