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

impl Controller {
    pub fn native_view(&mut self) -> Option<Option<View>> {
        let facts = self.facts();
        if self.native_facts.as_ref() == Some(&facts)
            && self.native_retry.is_none_or(|until| std::time::Instant::now() < until) {
            return None;
        }
        let view = serde_json::to_value(&facts).ok()
            .and_then(|facts| apparent_connect_client::Client::account_presentation(facts).ok())
            .and_then(|view| serde_json::from_value(view).ok());
        self.native_retry = view.is_none().then(|| std::time::Instant::now() + std::time::Duration::from_secs(5));
        self.native_facts = Some(facts);
        Some(Some(view.unwrap_or_else(|| self.emergency_view())))
    }

    pub(super) fn emergency_view(&self) -> View {
        let mut buttons = Vec::new();
        let mut add = |command, title: &str| buttons.push(Button { command, title: title.into(), enabled: !self.closed && !self.disabling() });
        if let Some(logout) = self.confirmation {
            add(Command::Cancel, "Keep current settings");
            add(if logout { Command::Disconnect } else { Command::Disable },
                if logout { "Disconnect" } else { "Turn off uploads" });
        } else {
            add(Command::RequestDisable, "Turn off uploads");
            add(Command::RequestDisconnect, "Disconnect this computer");
        }
        let (headline, detail) = match self.confirmation {
            Some(true) => ("Disconnect this computer?", "Unfinished uploads stop. Already uploaded captures remain."),
            Some(false) => ("Turn uploads off?", "Unfinished uploads stop. This computer stays signed in."),
            None => ("Connection settings unavailable.", "You can still stop uploads or disconnect this computer."),
        };
        let presentation = Presentation {
            headline: headline.into(), detail: detail.into(), buttons: buttons.clone(),
            tone: if self.confirmation.is_some() { Tone::Warning } else { Tone::Failure },
            ..Default::default()
        };
        View {
            reusable_upload_grant: false, encryption: None, phase: String::new(), local_ready: false,
            title: "Apparent Connect".into(), status: headline.into(), detail: detail.into(),
            server: None, verification_uri: None, user_code: None, buttons, note: String::new(), presentation,
        }
    }

}

pub(in crate::capture::desktop::settings) fn sync_native(
    controller: &mut Option<Controller>, enabled: bool,
    events: &Arc<dyn Fn(crate::capture::desktop::settings::settings::Event) + Send + Sync>,
) {
    if !enabled || !crate::shared::handoff::experiment(CONNECT_SETTINGS) {
        *controller = None;
    } else if controller.is_none() {
        *controller = Some(native_connect(events, &crate::shared::handoff::default_config_path()));
    }
}

fn native_connect(
    events: &Arc<dyn Fn(crate::capture::desktop::settings::settings::Event) + Send + Sync>,
    config: &std::path::Path,
) -> Controller {
    let events = events.clone();
    Controller::open(crate::connect::hosted::settings_backend(config),
        Arc::new(move |event| events(crate::capture::desktop::settings::settings::Event::Connect(event))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_presenter_uses_only_safety_controls() {
        let (mut controller, _, _, _, _, _) = super::super::tests::fixture();
        let fallback = controller.emergency_view();
        assert!(fallback.buttons.iter().all(|button|
            matches!(button.command, Command::RequestDisable | Command::RequestDisconnect)));
        assert_eq!(fallback.buttons.len(), 2);
        controller.command(Command::RequestDisconnect);
        let confirmation = controller.emergency_view();
        assert_eq!(confirmation.presentation.tone, Tone::Warning);
        assert_eq!(confirmation.buttons.iter().map(|b| b.command).collect::<Vec<_>>(),
            vec![Command::Cancel, Command::Disconnect]);
    }
}
