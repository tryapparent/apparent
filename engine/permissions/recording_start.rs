impl ApparentCoordinator {
    fn ready_to_record(&mut self, session_selected: bool) -> bool {
        self.recording_start_admission(session_selected).is_ok()
    }

    fn recording_start_admission(&mut self, session_selected: bool) -> Result<(), crate::permission_admission::Admission> {
        use crate::permission_admission::{Admission, ScreenAuthorization, check_for};
        if self.lab { return Ok(()); }
        let microphone = crate::capture::engine::runtime::audio::mic::enabled();
        self.admitted_microphone = None;
        let admission = check_for(self.current_grants(), microphone, ScreenAuthorization::for_screen_recording(session_selected));
        match &admission {
            Admission::Ready => {
                self.admitted_microphone = Some(microphone);
                return Ok(());
            }
            Admission::Checking => {
                let message = "Checking recording permissions. Try recording again in a moment.";
                apparent_log(message);
                if let Ok(mut status) = CAPTURE_STATUS.lock() {
                    *status = Some(message.into());
                }
            }
            Admission::Blocked(missing) => self.gate.defer(missing.clone()),
        }
        Err(admission)
    }
}
