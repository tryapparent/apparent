pub(super) struct RecordingView {
    pub(super) microphone: MicrophoneView,
    pub(super) transcriber: TranscriberView,
    pub(super) lower_playback: bool,
    pub(super) playback_level: u8,
}

impl Panel {
    fn recording_view(
        &self,
        path: &Path,
        config: &crate::shared::handoff::Config,
    ) -> RecordingView {
        let hex = crate::shared::hex::cached_status();
        let engine = config
            .transcriber
            .as_deref()
            .and_then(
                crate::capture::engine::runtime::audio::transcription::transcribe::Engine::parse,
            )
            .unwrap_or_default();
        let menu = crate::capture::engine::runtime::audio::transcription::transcribe::menu_state(
            engine,
            hex.as_ref(),
            config.hex_model.as_deref(),
        );
        let command = crate::capture::engine::runtime::audio::transcription::command_transcriber::Program::load_from(path)
            .ok()
            .map(|program| program.name());
        RecordingView {
            microphone: super::microphone_view(
                crate::capture::engine::runtime::audio::mic::choice_in(path).as_ref(),
                self.inputs.as_ref(),
                self.status(Permission::Microphone) == Status::Granted,
            ),
            lower_playback: config.lower_playback.unwrap_or(false),
            playback_level: config.recording_volume(),
            transcriber: TranscriberView {
                engine: match engine {
                    crate::capture::engine::runtime::audio::transcription::transcribe::Engine::Command if command.is_some() => "command",
                    _ if menu.hex_checked => "hex",
                    _ => "apple",
                },
                hex_title: menu.hex_title,
                hex_enabled: menu.hex_enabled,
                language: crate::shared::handoff::hex_language_from(config),
                apple_locale: crate::shared::handoff::apple_locale_from(config)
                    .unwrap_or_else(|| "auto".into()),
                models: menu
                    .models
                    .into_iter()
                    .map(|(id, title, chosen)| ModelView { id, title, chosen })
                    .collect(),
                command,
            },
        }
    }
}

#[cfg(test)]
mod recording_projection_tests {
    use super::*;
    use std::sync::{Arc, atomic::AtomicBool};

    struct BlockedLogin<'a>(&'a Path);

    impl Host for BlockedLogin<'_> {
        fn shortcuts(&self) -> Shortcuts {
            Shortcuts::default()
        }

        fn set_shortcuts(&mut self, _: &Shortcuts) -> Result<(), ShortcutKind> {
            unreachable!()
        }

        fn pause_shortcuts(&mut self, _: bool) {
            unreachable!()
        }

        fn config_path(&self) -> PathBuf {
            self.0.to_path_buf()
        }

        fn login_status(&self) -> LoginItem {
            panic!("launch-at-login status is blocked")
        }

        fn set_login_item(&mut self, _: bool) -> anyhow::Result<()> {
            unreachable!()
        }

        fn command_line(&self) -> crate::composition::command_line::Places {
            unreachable!()
        }
    }

    #[test]
    fn recording_settings_sync_does_not_read_login_item_status() {
        let scratch = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        let config = scratch.join("absent.json");
        let host = BlockedLogin(&config);
        let mut session = Session {
            generation: 0,
            pane: Some(Pane::Recording),
            panel: Panel::default(),
            transport: None,
            polling: Arc::new(AtomicBool::new(false)),
            events: Arc::new(|_| {}),
            last_view: String::new(),
            permissions: Default::default(),
            meter_visible: false,
            meter_serial: 0,
            meter: None,
            _microphones: crate::capture::engine::runtime::audio::mic::Watch::start(|| {}),
        };

        session.sync(&host);
        let message: serde_json::Value = serde_json::from_str(&session.last_view).unwrap();
        assert_eq!(message["type"], "recording-state");
        assert_eq!(message["state"]["microphone"]["selected"], "default");
        assert!(message["state"]["login"].is_null());
    }
}
