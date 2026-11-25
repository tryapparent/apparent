use super::*;
#[path = "browser_tests.rs"]
mod browser;
use crate::shared::windows::WindowEntry;

fn stroke(t0: u64, x: f32, y: f32) -> Stroke {
    let p = |v: f32| (v * SCALE as f32) as i32;
    Stroke {
        color: None,
        t0,
        t1: t0 + 400,
        fw: 1000,
        fh: 1000,
        on: None,
        pin: None,
        laser: false,
        pts: vec![p(x), p(y), 0, p(x + 0.05), p(y), 200, p(x + 0.1), p(y), 400],
    }
}

fn words(list: &[(u64, &str)]) -> Vec<WordTiming> {
    list.iter()
        .map(|&(t0, text)| WordTiming {
            t0,
            t1: t0 + 250,
            text: text.into(),
        })
        .collect()
}

#[test]
fn multiline_notes_keep_the_next_speech_and_event_outside_their_text() {
    let mut b = bundle(
        words(&[(5000, "Before"), (6500, "After."), (7500, "Later.")]),
        vec![keyframe(1, 5000, KeyframeReason::SceneChange, "Before After. Later.")],
    );
    b.events = vec![
        InteractionEvent::Note { t: 6000, pin: 1, x: 0.5, y: 0.5,
            text: "First line\nSecond line".into() },
        InteractionEvent::Click { t: 7000, x: 0.5, y: 0.5, button: None,
            role: Some("button".into()), label: Some("Save".into()) },
    ];
    let texts = keyframe_texts(&b).unwrap();
    let text = &texts[0];
    assert_eq!(text.head, "");
    assert_eq!(text.lines, [
        "0:05 Said: “Before”",
        "0:06 Typed note · pin 1:\n    First line\n    Second line",
        "0:06 Said: “After.”",
        "0:07 Action: clicked button “Save”",
        "0:07 Said: “Later.”",
    ]);
}

fn keyframe(index: usize, t: u64, reason: KeyframeReason, said: &str) -> Keyframe {
    Keyframe {
        index,
        t,
        display_time: None,
        reason,
        file: format!("frames/frame-{index:02}.png"),
        event: "scene changed".into(),
        said: (!said.is_empty()).then(|| said.into()),
        mark_id: None,
        cursor: None,
    }
}

fn bundle(words: Vec<WordTiming>, keyframes: Vec<Keyframe>) -> ApparentBundle {
    ApparentBundle {
        version: 1,
        id: "t".into(),
        created_at_ms: 0,
        duration_ms: 20_000,
        target: TargetInfo {
            mode: CaptureMode::Display,
            app: None,
            bundle_id: None,
            window_title: None,
            window_id: None,
            display_id: 1,
            frame: TargetFrame {
                x: 0.0,
                y: 0.0,
                width: 1000.0,
                height: 1000.0,
                scale: 1.0,
            },
        },
        transcript: TranscriptData {
            source: "test".into(),
            words,
            ..Default::default()
        },
        note: None,
        strokes: vec![],
        marks: vec![],
        events: vec![],
        action_context: vec![],
        interaction_telemetry: None,
        video_ink: None,
        keyframes,
        contact_sheet: "contact-sheet.png".into(),
        video: None,
        video_offset_ms: 0,
        audio: None,
        source: None,
        device: None,
        context: Default::default(),
        context_changes: vec![],
        screens: vec![],
        windows: vec![],
        cursor: vec![],
        autocrop: None,
        destination: None,
        image_quality_warning: None,
    }
}

#[test]
fn compact_handoff_groups_exact_windows_across_routine_scene_changes() {
    let mut b = bundle(Vec::new(), vec![
        keyframe(1, 2000, KeyframeReason::SceneChange, ""),
        keyframe(2, 3500, KeyframeReason::Mark, ""),
        keyframe(3, 5000, KeyframeReason::SceneChange, ""),
    ]);
    b.strokes = vec![stroke(3500, 0.1, 0.1)];
    b.marks = crate::capture::engine::sketch::marks_of(&b.strokes);
    b.marks[0].shape = Shape::Circle;
    b.marks[0].on = Some("“Date”, “Date”, “Date”".into());
    b.keyframes[1].mark_id = Some(b.marks[0].id.clone());
    let page = ActionWindow {
        id: "firefox-window".into(),
        app: "Firefox".into(),
        title: Some("Board — Mozilla Firefox".into()),
    };
    let other = ActionWindow { title: Some("Other tab — Mozilla Firefox".into()), ..page.clone() };
    b.action_context = vec![
        ActionContext { pin_window: None, kind: ActionKind::Stroke, t: 3500, window: page.clone() },
        ActionContext { pin_window: None, kind: ActionKind::Pointer, t: 5500, window: page.clone() },
        ActionContext { pin_window: None, kind: ActionKind::Pointer, t: 6200, window: other },
        ActionContext { pin_window: None, kind: ActionKind::Pointer, t: 8000, window: page },
    ];
    b.events = [5500, 6200, 7000, 8000].map(|t| InteractionEvent::Click {
        t, x: 0.5, y: 0.5, role: None, label: None, button: None,
    }).to_vec();

    let compact = compact_keyframe_texts(&b).unwrap();
    assert!(compact.iter().all(|frame| frame.head.is_empty()));
    let lines = compact.into_iter().flat_map(|frame| frame.lines).collect::<Vec<_>>();
    assert_eq!(lines, [
        "0:03 Circled “Date” ×3 near Board",
        "0:05 clicked",
        "0:06 clicked near Other tab",
        "0:07 clicked",
        "0:08 clicked near Board",
    ]);
    let detailed = keyframe_texts(&b).unwrap();
    assert_eq!(detailed[0].head, "scene changed");
    assert!(detailed[1].lines[0].contains("“Date”, “Date”, “Date” · Nearby window: Firefox — Board — Mozilla Firefox"));
    assert!(detailed[2].lines[0].contains(" · Nearby window: Firefox — Board — Mozilla Firefox"));
}

#[test]
fn nearby_windows_do_not_claim_input_time_identity_and_require_stroke_agreement() {
    let mut b = bundle(
        Vec::new(),
        vec![keyframe(1, 6000, KeyframeReason::Mark, "Try this.")],
    );
    b.strokes = vec![stroke(1000, 0.1, 0.1), stroke(1800, 0.3, 0.1)];
    b.marks = crate::capture::engine::sketch::marks_of(&b.strokes);
    b.marks.truncate(1);
    b.marks[0].shape = Shape::Circle;
    b.marks[0].strokes = vec![0, 1];
    b.marks[0].on = Some("button “Next”".into());
    b.keyframes[0].mark_id = Some(b.marks[0].id.clone());
    let window = ActionWindow {
        id: "one".into(),
        app: "Firefox".into(),
        title: Some("Quick picks".into()),
    };
    b.action_context = vec![
        ActionContext { pin_window: None, kind: ActionKind::Stroke, t: 1000, window: window.clone() },
        ActionContext { pin_window: None, kind: ActionKind::Stroke, t: 1800, window: window.clone() },
        ActionContext { pin_window: None, kind: ActionKind::Pointer, t: 3000, window: ActionWindow {
            title: Some("Page after a tab switch".into()), ..window
        } },
    ];
    b.events = [3000, 4000].map(|t| InteractionEvent::Click {
        t, x: 0.5, y: 0.5, role: None, label: None, button: None,
    }).to_vec();
    let lines = &keyframe_texts(&b).unwrap()[0].lines;
    assert_eq!(lines.as_slice(), [
        "0:01 Circled: button “Next” (2 strokes) · Nearby window: Firefox — Quick picks",
        "0:03 Action: clicked · Nearby window: Firefox — Page after a tab switch",
        "0:04 Action: clicked · Window: unknown",
        "0:06 Said: “Try this.”",
    ]);
    let summary = crate::capture::engine::sketch::summary_markdown_with(
        &b, std::path::Path::new("."), true,
    );
    assert!(summary.contains("Exact action windows are unknown."));
    assert!(!summary.contains("clicked · Window: Firefox"));
    b.action_context[1].window.title = Some("Listen again".into());
    assert_eq!(
        keyframe_texts(&b).unwrap()[0].lines[0],
        "0:01 Circled: button “Next” (2 strokes) · Window: unknown",
    );
}

#[test]
fn marks_sharing_a_frame_are_numbered_and_take_the_speech_drawn_over() {
    let said =
        "These should stay put. Maybe this hover part can move. And drop these dividers.";
    let mut b = bundle(
        words(&[
            (1_000, "These"),
            (1_300, "should"),
            (1_600, "stay"),
            (1_900, "put."),
            (4_000, "Maybe"),
            (4_300, "this"),
            (4_600, "hover"),
            (4_900, "part"),
            (5_200, "can"),
            (5_500, "move."),
            (8_000, "And"),
            (8_300, "drop"),
            (8_600, "these"),
            (8_900, "dividers."),
        ]),
        vec![keyframe(1, 9_500, KeyframeReason::Mark, said)],
    );
    b.strokes = vec![
        stroke(1_200, 0.1, 0.2),
        stroke(4_700, 0.4, 0.5),
        stroke(8_400, 0.6, 0.1),
    ];
    b.marks = crate::capture::engine::sketch::marks_of(&b.strokes);
    b.marks[0].shape = Shape::Circle;
    for mark in &mut b.marks {
        mark.frame = Some("frames/frame-01.png".into());
    }
    b.keyframes[0].mark_id = Some(b.marks[0].id.clone());
    let text = &keyframe_texts(&b).unwrap()[0];
    assert_eq!(text.head, "");
    assert_eq!(text.lines.len(), 6, "{text:?}");
    assert_eq!(text.lines[0], "0:01 Circled: ① target unidentified");
    assert_eq!(text.lines[1], "0:01 Said: “These should stay put.”");
    assert!(text.lines[2].starts_with("0:04 Mark: ② "));
    assert_eq!(text.lines[3], "0:04 Said: “Maybe this hover part can move.”");
    assert!(text.lines[4].starts_with("0:08 Mark: ③ "));
    assert_eq!(text.lines[5], "0:08 Said: “And drop these dividers.”");
}

#[test]
fn marks_are_found_by_their_number_in_the_text_or_their_id() {
    let mut b = bundle(
        Vec::new(),
        vec![
            keyframe(1, 3_000, KeyframeReason::Mark, ""),
            keyframe(2, 9_000, KeyframeReason::Mark, ""),
            keyframe(3, 15_000, KeyframeReason::Mark, ""),
        ],
    );
    b.strokes = vec![
        stroke(1_000, 0.1, 0.2),
        stroke(3_000, 0.4, 0.5),
        stroke(7_000, 0.6, 0.1),
        stroke(9_000, 0.2, 0.8),
        stroke(14_000, 0.5, 0.5),
    ];
    b.marks = crate::capture::engine::sketch::marks_of(&b.strokes);
    assert_eq!(b.marks.len(), 5);
    for (mark, frame) in b.marks.iter_mut().zip([1, 1, 2, 2, 3]) {
        mark.frame = Some(format!("frames/frame-{frame:02}.png"));
    }
    for (k, first) in [(0, 0), (1, 2), (2, 4)] {
        b.keyframes[k].mark_id = Some(b.marks[first].id.clone());
    }
    let found = |q: &str, k: Option<usize>| find_mark(&b, q, k).map(|e| e.mark.t0);
    assert!(found("2", None).unwrap_err().contains("--frame"));
    assert_eq!(found("2", Some(2)), Ok(9_000));
    assert_eq!(found("②", Some(1)), Ok(3_000));
    assert_eq!(found("1", Some(3)), Ok(14_000));
    assert!(found("3", None).is_err());
    let id = b.marks[3].id.clone();
    assert_eq!(found(&id, None), Ok(9_000));
    let entry = find_mark(&b, "2", Some(2)).unwrap();
    assert!(entry.line().starts_with("#2 ✎② 0:09 "), "{}", entry.line());
    assert_eq!(entry.json()["keyframe"], 2);
}

#[test]
fn pin_window_excerpt_requires_an_exact_unique_pin_and_preserves_the_bundle() {
    let mut b = bundle(Vec::new(), vec![
        keyframe(1, 2000, KeyframeReason::SceneChange, ""),
        keyframe(2, 3500, KeyframeReason::Mark, ""),
    ]);
    let mut pin = stroke(3500, 0.1, 0.1);
    pin.pin = Some(2);
    pin.pts.truncate(3);
    b.strokes.push(pin);
    b.marks = crate::capture::engine::sketch::marks_of(&b.strokes);
    b.keyframes[1].mark_id = Some(b.marks[0].id.clone());
    b.action_context.push(ActionContext {
        kind: ActionKind::Stroke,
        t: 3500,
        window: ActionWindow {
            id: "hyprland:1:2".into(),
            app: "Fixture".into(),
            title: Some("Synthetic preferences".into()),
        },
        pin_window: Some(PinWindow {
            pin: 2,
            sampled_after_ms: 45,
            truncated: false,
            elements: vec![PinWindowElement {
                role: "push button".into(),
                name: Some("Save".into()),
                parent: None,
                states: vec!["disabled".into()],
                window_bounds: Some([10, 20, 30, 40]),
            }],
        }),
    });
    let serialized = serde_json::to_string(&b).unwrap();
    let mut reopened: ApparentBundle = serde_json::from_str(&serialized).unwrap();
    assert_eq!(reopened.action_context, b.action_context);
    assert!(!reopened.has_action_window_observations());
    for texts in [keyframe_texts(&reopened), compact_keyframe_texts(&reopened)] {
        let frames = texts.unwrap();
        assert!(frames[0].lines.iter().all(|line| !line.contains("window UI")));
        assert!(frames[1].lines.iter().any(|line| {
            line.starts_with("0:03 Pin 2 nearby window UI (app data):")
                && line.contains(r#""name":"Save","states":["disabled"]"#)
        }));
    }
    reopened.action_context.push(reopened.action_context[0].clone());
    assert!(keyframe_texts(&reopened).unwrap()[1].lines.iter().all(|line| !line.contains("window UI")));
    reopened.action_context.pop();
    reopened.action_context[0].t += 1;
    assert!(keyframe_texts(&reopened).unwrap()[1].lines.iter().all(|line| !line.contains("window UI")));
}
