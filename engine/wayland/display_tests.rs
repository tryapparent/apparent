use super::*;

#[test]
fn portal_source_must_match_the_requested_capture_scope() {
    use ashpd::desktop::screencast::SourceType;
    assert!(validate_source_type(false, Some(SourceType::Monitor)).is_ok());
    assert!(validate_source_type(false, Some(SourceType::Window)).is_err());
    assert!(validate_source_type(true, Some(SourceType::Monitor)).is_err());
    assert!(validate_source_type(true, Some(SourceType::Window)).is_ok());
    assert!(validate_source_type(false, Some(SourceType::Virtual)).is_err());

    assert!(validate_source_type(false, None).is_ok());
}

#[test]
fn restore_tokens_are_scoped_to_the_selected_output() {
    assert_eq!(screencast_key(Some("Virtual-1"), 2), "screencast:Virtual-1");
    assert_eq!(
        screencast_key(Some("HEADLESS-1"), 2),
        "screencast:HEADLESS-1"
    );
    assert_eq!(screencast_key(Some("Virtual-1"), 1), "screencast");
    assert_eq!(screencast_key(None, 2), "screencast-window");
}

#[test]
fn portal_output_is_checked_by_name_even_when_positions_overlap() {
    assert!(selected_output_matches("HEADLESS-1", Some("HEADLESS-1")));
    assert!(!selected_output_matches("HEADLESS-1", Some("Virtual-1")));
    assert!(!selected_output_matches("HEADLESS-1", None));
}

#[test]
fn picker_uses_only_a_uniquely_identified_display() {
    let monitor = |handle, name: &str| Monitor {
        handle,
        name: name.into(),
        outputs: 1,
        rect: [0.0, 0.0, 1920.0, 1080.0],
        work: [0.0, 0.0, 1920.0, 1080.0],
        scale: 1.0,
        primary: handle == 1,
    };
    let monitors = [monitor(1, "eDP-1"), monitor(2, "DP-1")];
    assert_eq!(
        picked_monitor(&monitors, Some("DP-1"), true)
            .unwrap()
            .handle,
        2
    );
    assert!(picked_monitor(&monitors, None, true).is_none());
    assert!(picked_monitor(&monitors, Some("DP-1"), false).is_none());
    assert!(picked_monitor(&monitors[..1], Some("DP-1"), true).is_none());
    assert_eq!(
        picked_monitor(&monitors[..1], None, false).unwrap().handle,
        1
    );
    let duplicate = [monitor(3, "DP-1"), monitor(4, "DP-1")];
    assert!(picked_monitor(&duplicate, Some("DP-1"), true).is_none());
}

#[test]
fn multi_output_portal_admission_requires_a_validated_identity_contract() {
    for mode in [CaptureMode::Display, CaptureMode::Region] {
        assert!(!portal_request_supported(mode, 2, false));
        assert!(portal_request_supported(mode, 1, false));
        assert!(portal_request_supported(mode, 2, true));

        assert!(!portal_output_verified(mode, 2, false, "Virtual-1", None));

        assert!(!portal_output_verified(
            mode,
            2,
            false,
            "Virtual-1",
            Some("Virtual-1")
        ));
        assert!(portal_output_verified(
            mode,
            2,
            true,
            "Virtual-1",
            Some("Virtual-1")
        ));
        assert!(!portal_output_verified(
            mode,
            2,
            true,
            "Virtual-1",
            Some("Virtual-2")
        ));
        assert!(!portal_output_verified(mode, 2, true, "Virtual-1", None));
        assert!(portal_output_verified(mode, 1, false, "Virtual-1", None));
    }
}

#[test]
fn a_reordered_display_id_cannot_capture_a_different_output() {
    let chosen = [1280.0, 0.0, 1920.0, 1080.0];
    assert!(target_fits_output(CaptureMode::Display, chosen, chosen));
    assert!(!target_fits_output(
        CaptureMode::Display,
        chosen,
        [0.0, 0.0, 1280.0, 800.0]
    ));
    assert!(target_fits_output(
        CaptureMode::Region,
        [1480.0, 120.0, 300.0, 240.0],
        chosen
    ));
    assert!(!target_fits_output(
        CaptureMode::Region,
        [1480.0, 120.0, 300.0, 240.0],
        [0.0, 0.0, 1280.0, 800.0]
    ));
}

#[test]
fn region_selection_keeps_its_output_after_monitors_reorder_or_overlap() {
    let monitor = |handle, name: &str| Monitor {
        handle,
        name: name.into(),
        outputs: 1,
        rect: [0.0, 0.0, 1920.0, 1080.0],
        work: [0.0, 0.0, 1920.0, 1080.0],
        scale: 1.0,
        primary: false,
    };
    let selected = monitor(100, "HEADLESS-1");
    let other = monitor(101, "Virtual-1");
    let id = super::monitor_id(&selected);
    let reordered = [other, selected];
    assert_eq!(selected_monitor(&reordered, id).unwrap().name, "HEADLESS-1");
    assert!(selected_monitor(&reordered, 102).is_none());

    assert!(target_fits_output(
        CaptureMode::Region,
        [20.0, 20.0, 100.0, 100.0],
        reordered[0].rect
    ));
}

#[test]
fn portal_rejects_a_layout_change_while_the_sharing_dialog_is_open() {
    let selected = Monitor {
        handle: 100,
        name: "Virtual-1".into(),
        outputs: 1,
        rect: [0.0, 0.0, 1280.0, 800.0],
        work: [0.0, 0.0, 1280.0, 800.0],
        scale: 1.0,
        primary: true,
    };
    let mut moved = selected.clone();
    moved.rect[0] = 1280.0;
    let mut replaced = selected.clone();
    replaced.handle = 101;
    let mut mirrored = selected.clone();
    mirrored.outputs = 2;
    assert!(output_still_selected(&selected, &[selected.clone()], 1));
    assert!(!output_still_selected(
        &selected,
        &[selected.clone(), moved.clone()],
        1
    ));
    assert!(!output_still_selected(&selected, &[selected.clone()], 2));
    assert!(!output_still_selected(&selected, &[moved], 1));
    assert!(!output_still_selected(&selected, &[replaced], 1));
    assert!(!output_still_selected(&selected, &[mirrored], 1));
}

#[test]
fn a_region_on_another_output_cannot_crop_outside_the_portal_stream() {
    assert_eq!(
        portal_crop(
            CaptureMode::Region,
            [2040.0, 80.0, 420.0, 320.0],
            Some([0.0, 0.0, 1920.0, 1080.0])
        ),
        None,
        "an off-stream crop yields an empty frame and a PipeWire not-negotiated error"
    );
}

#[test]
fn a_region_is_trimmed_to_the_selected_stream_in_both_axes() {
    assert_eq!(
        portal_crop(
            CaptureMode::Region,
            [2080.0, 600.0, 400.0, 300.0],
            Some([1920.0, 0.0, 320.0, 720.0])
        ),
        Some([160, 600, 160, 120])
    );
}

#[test]
fn second_display_region_uses_the_selected_streams_origin() {
    assert_eq!(
        portal_crop(
            CaptureMode::Region,
            [2070.0, 110.0, 400.0, 250.0],
            Some([1920.0, 0.0, 1280.0, 720.0])
        ),
        Some([150, 110, 400, 250])
    );
    assert_eq!(
        portal_crop(CaptureMode::Region, [2070.0, 110.0, 400.0, 250.0], None),
        None,
        "unknown stream position must not silently record a whole display"
    );
}

#[test]
fn single_output_region_without_portal_position_requires_guarded_pixels() {
    let output = Monitor {
        handle: 100,
        name: "Virtual-1".into(),
        outputs: 1,
        rect: [0.0, 0.0, 1280.0, 800.0],
        work: [0.0, 0.0, 1280.0, 800.0],
        scale: 1.0,
        primary: true,
    };
    assert_eq!(
        region_crop(
            [410.0, 240.0, 420.0, 260.0],
            Some(&output),
            1,
            false,
            None,
            true
        ),
        Some(Crop {
            rect: [410, 240, 420, 260],
            source_size: Some([1280, 800])
        }),
        "KDE's explicitly shared sole monitor can crop only with exact incoming pixel bounds"
    );
}

#[test]
fn missing_position_never_guesses_an_ambiguous_or_unvalidated_output() {
    let output = Monitor {
        handle: 100,
        name: "Virtual-1".into(),
        outputs: 1,
        rect: [0.0, 0.0, 1280.0, 800.0],
        work: [0.0, 0.0, 1280.0, 800.0],
        scale: 1.0,
        primary: true,
    };
    let rect = [410.0, 240.0, 420.0, 260.0];
    assert_eq!(region_crop(rect, Some(&output), 2, false, None, true), None);
    assert_eq!(
        region_crop(rect, Some(&output), 1, false, None, false),
        None
    );
    assert_eq!(region_crop(rect, None, 1, false, None, true), None);
    for (handle, name, outputs) in [
        (0, "", 0),
        (100, "", 1),
        (100, "Virtual", 0),
        (100, "Mirrored", 2),
    ] {
        let mut unknown = output.clone();
        unknown.handle = handle;
        unknown.name = name.into();
        unknown.outputs = outputs;
        assert_eq!(
            region_crop(rect, Some(&unknown), 1, false, None, true),
            None
        );
    }
    for invalid in [
        [1400.0, 0.0, 10.0, 10.0],
        [0.0, 0.0, f64::NAN, 10.0],
        [1.0, 1.0, 0.5, 0.5],
    ] {
        assert_eq!(
            region_crop(invalid, Some(&output), 1, false, None, true),
            None
        );
    }

    assert_eq!(
        region_crop(
            rect,
            Some(&output),
            1,
            false,
            Some([1920.0, 0.0, 1280.0, 800.0]),
            true
        ),
        None
    );

    let pixels = Some(Crop {
        rect: [410, 240, 420, 260],
        source_size: None,
    });
    assert_eq!(
        region_crop(rect, Some(&output), 1, false, Some(output.rect), false),
        pixels
    );
    assert_eq!(
        region_crop(
            rect,
            Some(&output),
            2,
            true,
            Some([1920.0, 0.0, 1280.0, 800.0]),
            true
        ),
        pixels
    );
}
