#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecordingView {
    pub microphone: MicrophoneView,
    pub transcriber: TranscriberView,
    pub lower_playback: bool,
    pub playback_level: u8,
}

impl Panel {
    fn recording_view(&self, path: &Path) -> RecordingView {
        let config = crate::shared::handoff::load_config_from(path);
        let hex = crate::shared::hex::cached_status();
        let engine = config
            .transcriber
            .as_deref()
            .and_then(crate::capture::engine::runtime::audio::transcription::transcribe::Engine::parse)
            .unwrap_or_default();
        let menu = crate::capture::engine::runtime::audio::transcription::transcribe::menu_state(engine, hex.as_ref(), config.hex_model.as_deref());
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
                language: crate::shared::handoff::hex_language_from(&config),
                apple_locale: crate::shared::handoff::apple_locale_from(&config)
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
