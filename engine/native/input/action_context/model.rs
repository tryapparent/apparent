use serde::{Deserialize, Serialize};

use super::ApparentBundle;

#[path = "pin_window.rs"]
mod pin_window;
pub use pin_window::{PinWindow, PinWindowElement};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionKind {
    Pointer,
    Stroke,
    Key,
    Scroll,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionContext {
    pub kind: ActionKind,
    pub t: u64,
    pub window: ActionWindow,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin_window: Option<PinWindow>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionWindow {
    pub id: String,
    pub app: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

impl ApparentBundle {
    pub fn has_action_window_observations(&self) -> bool {
        self.action_context.iter().any(|row| row.pin_window.is_none())
    }

    pub fn window_observed_near_action(&self, kind: ActionKind, t: u64) -> Option<&ActionWindow> {
        let mut matching = self
            .action_context
            .iter()
            .filter(|row| row.pin_window.is_none() && row.kind == kind && row.t == t);
        let window = &matching.next()?.window;
        matching.next().is_none().then_some(window)
    }
}
