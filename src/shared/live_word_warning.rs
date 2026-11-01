//! Cross-platform policy for a live *no recognized words yet* warning.
//! Recognition and microphone health are separate sources of evidence.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum State {
    #[default]
    Waiting,
    NoWords,
    Unavailable,
}

#[derive(Default)]
pub struct LiveWordWarning {
    active_without_words_ms: u64,
    recognized_words: bool,
    state: State,
}

impl LiveWordWarning {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn completed(&mut self, audio_ms: u64, has_activity: bool, words: bool) {
        if self.state == State::Unavailable {
            return;
        }
        if words {
            self.active_without_words_ms = 0;
            self.recognized_words = true;
            self.state = State::Waiting;
        } else if has_activity && !self.recognized_words {
            self.active_without_words_ms = self.active_without_words_ms.saturating_add(audio_ms);
            if self.active_without_words_ms >= 12_000 {
                self.state = State::NoWords;
            }
        }
    }

    pub fn unavailable(&mut self) {
        self.state = State::Unavailable;
    }

    pub fn state(&self) -> State {
        self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_completed_active_audio_without_words_warns_and_words_clear_it() {
        let mut warning = LiveWordWarning::new();
        assert_eq!(warning.state(), State::Waiting);
        warning.completed(6_000, false, false);
        assert_eq!(warning.state(), State::Waiting);
        warning.completed(6_000, true, false);
        assert_eq!(warning.state(), State::Waiting);
        warning.completed(12_000, true, false);
        assert_eq!(warning.state(), State::NoWords);
        warning.completed(18_000, true, true);
        assert_eq!(warning.state(), State::Waiting);
    }

    #[test]
    fn model_failure_is_not_a_no_words_result() {
        let mut warning = LiveWordWarning::new();
        warning.unavailable();
        warning.completed(12_000, true, false);
        assert_eq!(warning.state(), State::Unavailable);
    }

    #[test]
    fn later_noise_does_not_claim_no_words_yet_after_words_were_recognized() {
        let mut warning = LiveWordWarning::new();
        warning.completed(6_000, true, true);
        warning.completed(24_000, true, false);
        assert_eq!(warning.state(), State::Waiting);
    }
}
