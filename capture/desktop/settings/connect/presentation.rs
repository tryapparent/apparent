//! Typed presentation shared by native Settings and Electron. No renderer infers
//! authorization or semantic status from English strings.
use super::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tone { #[default] Neutral, Success, Progress, Warning, Failure }
impl Tone {
    pub fn color(self) -> u32 { match self {
        Self::Neutral => 0x020102, Self::Success => 0x146b43,
        Self::Progress => 0x7a58c7, Self::Warning => 0xffbe2e, Self::Failure => 0xb42318,
    } }
    pub fn symbol(self) -> &'static str { match self {
        Self::Neutral => "", Self::Success => "✓", Self::Progress => "◷",
        Self::Warning => "!", Self::Failure => "×",
    } }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presentation {
    pub tone: Tone,
    pub headline: String,
    pub detail: String,
    pub note: String,
    pub artwork: bool,
    pub compact: bool,
    pub account_menu: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_initial: Option<String>,
    pub buttons: Vec<Button>,
    pub menu_actions: Vec<Command>,
    pub shared_links_url: Option<String>,
}
