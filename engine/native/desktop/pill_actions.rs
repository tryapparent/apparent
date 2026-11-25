impl View {
    pub fn consume(
        &mut self,
        mut command: Command,
        timely: bool,
        generation: u64,
    ) -> Option<PillAction> {
        if let Some(capture) = command.startup_capture.as_ref() {
            if !timely
                || capture != &Session::capture_key(generation)
                || self.phase != "recording"
                || command.action != "cancel"
                || command.target.is_some()
                || command.revision > self.revision
            {
                return None;
            }
            command.revision = self.revision;
        }
        if command.revision != self.revision {
            return None;
        }
        let action = timely.then(|| self.admit(command)).flatten();
        self.revision += 1;
        self.notice = action
            .is_none()
            .then(|| "Control request expired or changed. Try again.".into());
        action
    }
}

#[cfg(test)]
#[test]
fn electron_pill_startup_cancel_stays_bound_to_capture_when_first_frame_changes_revision() {
    let mut live = View {
        revision: 8,
        presentation: Presentation {
            phase: "recording".into(),
            actions: vec![Control {
                id: "cancel".into(),
                label: "Cancel".into(),
                enabled: true,
                primary: false,
                selected: false,
            }],
            ..Default::default()
        },
        ..Default::default()
    };
    let startup = |generation, action: &str| Command {
        revision: 7,
        action: action.into(),
        target: None,
        startup_capture: Some(Session::capture_key(generation)),
    };
    assert!(live.consume(startup(15, "cancel"), true, 16).is_none());
    assert!(live.consume(startup(16, "cancel"), false, 16).is_none());
    assert!(live.consume(startup(16, "finish"), true, 16).is_none());
    assert_eq!(live.revision, 8);
    assert!(matches!(
        live.consume(startup(16, "cancel"), true, 16),
        Some(PillAction::Cancel)
    ));
    assert_eq!(live.revision, 9);
    live.presentation.phase = "processing".into();
    assert!(live.consume(startup(16, "cancel"), true, 16).is_none());
}
