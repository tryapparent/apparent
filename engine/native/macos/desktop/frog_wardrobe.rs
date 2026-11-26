use crate::shared::handoff::{self, ConfigPublicationUncertain};
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::Path};

include!(concat!(env!("OUT_DIR"), "/frog-wardrobe.rs"));

pub(crate) const PREFERENCE: &str = "labs.frogWardrobe";
const KEY: &str = "frogWardrobe";
const COUNT_STATES: usize = THRESHOLDS[2] + 1;

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Item {
    Sunglasses,
    LilyPad,
    UnicornHorn,
}

impl Item {
    const ALL: [Self; 3] = [Self::Sunglasses, Self::LilyPad, Self::UnicornHorn];

    fn id(self) -> &'static str {
        ["sunglasses", "lily-pad", "unicorn-horn"][self as usize]
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Action {
    Claim,
    Equip,
    Remove,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    item: Item,
    action: Action,
}

pub(crate) fn frog_name(config: &Value) -> Option<&str> {
    let onboarding = &config["onboarding"];
    if onboarding["frogAdopted"] != true
        || handoff::preference_value(config, "labs.desktopFrog").and_then(|value| value.as_bool())
            != Some(true)
    {
        return None;
    }
    onboarding["frogName"].as_str()
}

fn enabled(config: &Value) -> bool {
    frog_name(config).is_some()
        && handoff::preference_value(config, PREFERENCE).and_then(|value| value.as_bool())
            == Some(true)
}

fn receipts(store: &Value) -> Result<BTreeSet<String>> {
    let Some(value) = store.get("receipts") else {
        return Ok(BTreeSet::new());
    };
    let ids = value.as_array().context("Invalid wardrobe receipts")?;
    ensure!(ids.len() <= THRESHOLDS[2], "Too many wardrobe receipts");
    ids.iter()
        .map(|id| {
            id.as_str()
                .map(str::to_owned)
                .context("Invalid wardrobe receipt")
        })
        .collect()
}

fn state(store: &Value, item: Item) -> usize {
    match store["items"][item.id()].as_u64() {
        Some(1) => 1,
        Some(2) => 2,
        _ => 0,
    }
}

fn store(config: &Value) -> &Value {
    &config["onboarding"][KEY]
}

pub(crate) fn facts(config: &Value) -> Value {
    if !cfg!(target_os = "macos") || frog_name(config).is_none() {
        return Value::Null;
    }
    let saved = enabled(config);
    let store = store(config);
    let Ok(ids) = receipts(store) else {
        return json!({"enabled": saved, "error": true});
    };
    let count = ids.len();
    let items = Item::ALL.map(|item| {
        let item_state = state(store, item);
        let index = (item as usize * COUNT_STATES + count) * 3 + item_state;
        let action = ["", "claim", "equip", "remove"][(ACTIONS[index] - b'0') as usize];
        json!({"id": item.id(), "threshold": THRESHOLDS[item as usize], "action": action})
    });
    json!({"enabled": saved, "count": count, "items": items})
}

pub(crate) fn equipped(config: &Value) -> Vec<&'static str> {
    let store = store(config);
    if !enabled(config) {
        return Vec::new();
    }
    let Ok(ids) = receipts(store) else {
        return Vec::new();
    };
    Item::ALL
        .into_iter()
        .filter(|item| ids.len() >= THRESHOLDS[*item as usize] && state(store, *item) == 2)
        .map(Item::id)
        .collect()
}

pub(crate) fn change(path: &Path, request: Request) -> Result<()> {
    handoff::update_onboarding_progress_in(path, KEY, enabled, |store| {
        let count = receipts(store)?.len();
        let item = request.item;
        let old = state(store, item);
        let index =
            ((item as usize * COUNT_STATES + count) * 3 + old) * 3 + request.action as usize;
        let next = CHANGES[index] - b'0';
        ensure!(next != 0, "Wardrobe action unavailable");
        store
            .as_object_mut()
            .context("Invalid wardrobe")?
            .entry("items")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .context("Invalid wardrobe items")?
            .insert(item.id().into(), json!(next));
        Ok(())
    })
}

fn credit(path: &Path, id: &str) -> Result<()> {
    #[derive(Debug)]
    struct Skip;
    impl std::fmt::Display for Skip {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("Wardrobe credit already applied or unavailable")
        }
    }
    impl std::error::Error for Skip {}
    let result = handoff::update_onboarding_progress_in(path, KEY, enabled, |store| {
        let mut ids = receipts(store)?;
        let index = (6 + usize::from(ids.contains(id))) * COUNT_STATES + ids.len();
        if CREDIT[index] == b'0' {
            return Err(Skip.into());
        }
        ids.insert(id.to_owned());
        store
            .as_object_mut()
            .context("Invalid wardrobe")?
            .insert("receipts".into(), json!(ids));
        Ok(())
    });
    match result {
        Err(error) if error.is::<Skip>() => Ok(()),
        other => other,
    }
}

pub(crate) fn credit_saved(id: &str) {
    if id.is_empty() {
        return;
    }
    let path = handoff::default_config_path();
    let Ok(config) = handoff::read_preferences(&path) else {
        return;
    };
    if !enabled(&config) || receipts(store(&config)).is_ok_and(|ids| ids.len() == THRESHOLDS[2]) {
        return;
    }
    if let Err(error) = credit(&path, id) {
        if error.is::<ConfigPublicationUncertain>()
            && handoff::read_preferences(&path)
                .ok()
                .and_then(|config| receipts(store(&config)).ok())
                .is_some_and(|ids| ids.contains(id))
        {
            return;
        }
        if credit(&path, id).is_err() {
            crate::capture::engine::runtime::apparent_log("Could not save frog wardrobe progress");
        }
    }
}

pub(in crate::capture::desktop) fn response(
    path: &Path,
    request: u32,
    enabled: Option<bool>,
    setting: Option<&str>,
    intent: Request,
) -> Value {
    use crate::capture::desktop::settings::labs;
    let facts = if cfg!(target_os = "macos")
        && enabled.is_none()
        && setting.is_none()
        && change(path, intent).is_ok()
    {
        labs::facts(path)
    } else {
        json!({"error":"config_write_failed"})
    };
    json!({"type":"labs-result","request":request,"facts":facts})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wardrobe_counts_distinct_receipts_and_retains_claims_when_removed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"secret":"preserve","labs":{"desktopFrog":true,"frogWardrobe":true},"onboarding":{"frogAdopted":true,"frogName":"Pip","seen":true,"frogWardrobe":{"extra":1}}}"#).unwrap();
        let read = || handoff::read_preferences(&path).unwrap();
        let item = Item::Sunglasses;
        let act = |action| change(&path, Request { item, action });
        for n in 0..9 {
            credit(&path, &format!("receipt-{n}")).unwrap();
        }
        assert!(act(Action::Claim).is_err());
        assert!(act(Action::Equip).is_err());
        credit(&path, "receipt-9").unwrap();
        credit(&path, "receipt-9").unwrap();
        assert_eq!(receipts(store(&read())).unwrap().len(), 10);
        act(Action::Claim).unwrap();
        assert!(equipped(&read()).is_empty());
        act(Action::Equip).unwrap();
        assert_eq!(equipped(&read()), ["sunglasses"]);
        handoff::write_preference(&path, PREFERENCE, Some(json!(false))).unwrap();
        assert!(credit(&path, "paused").is_err());
        assert!(act(Action::Remove).is_err());
        assert!(equipped(&read()).is_empty());
        handoff::write_preference(&path, PREFERENCE, Some(json!(true))).unwrap();
        assert_eq!(equipped(&read()), ["sunglasses"]);
        act(Action::Remove).unwrap();
        assert!(equipped(&read()).is_empty());
        assert!(act(Action::Claim).is_err());
        assert!(act(Action::Equip).is_ok());
        for n in 10..35 {
            credit(&path, &format!("receipt-{n}")).unwrap();
        }
        let after = read();
        assert_eq!(receipts(store(&after)).unwrap().len(), 30);
        assert_eq!(after["secret"], "preserve");
        assert_eq!(after["onboarding"]["seen"], true);
        assert_eq!(store(&after)["extra"], 1);
    }

    #[test]
    fn wardrobe_credits_and_other_profile_edits_use_the_same_lock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"labs":{"desktopFrog":true,"frogWardrobe":true},"onboarding":{"frogAdopted":true,"frogName":"Pip"}}"#).unwrap();
        let first_write = std::sync::Barrier::new(3);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                first_write.wait();
                for n in 0..15 {
                    credit(&path, &format!("a-{n}")).unwrap();
                }
            });
            scope.spawn(|| {
                first_write.wait();
                for n in 0..15 {
                    credit(&path, &format!("b-{n}")).unwrap();
                }
            });
            scope.spawn(|| {
                first_write.wait();
                handoff::set_config_value_in(&path, "unrelated", json!("kept")).unwrap();
            });
        });
        let saved = handoff::read_preferences(&path).unwrap();
        assert_eq!(receipts(store(&saved)).unwrap().len(), 30);
        assert_eq!(saved["unrelated"], "kept");
    }
}
