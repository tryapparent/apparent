use super::*;
use crate::shared::routing::BROWSER_PAGE_EVENT_PREFIX;

#[test]
fn unmatched_browser_page_urls_keep_each_time_in_the_compact_handoff() {
    let mut bundle = bundle(
        Vec::new(),
        vec![keyframe(1, 1000, KeyframeReason::SceneChange, "")],
    );
    bundle.events = [
        (2000, "https://example.com/first"),
        (3000, "https://example.com/first"),
        (4000, "https://example.com/second"),
    ]
    .map(|(t, url)| InteractionEvent::AppEvent {
        t,
        label: format!("{BROWSER_PAGE_EVENT_PREFIX}{url}"),
    })
    .to_vec();

    let frames = compact_keyframe_texts(&bundle).unwrap();
    assert_eq!(
        frames[0].lines,
        [
            "0:02 browser page https://example.com/first",
            "0:03 browser page https://example.com/first",
            "0:04 browser page https://example.com/second",
        ]
    );
}

fn page_observation(t: u64, url: &str) -> InteractionEvent {
    InteractionEvent::AppEvent {
        t,
        label: format!("{BROWSER_PAGE_EVENT_PREFIX}{url}"),
    }
}

fn click_at(t: u64) -> InteractionEvent {
    InteractionEvent::Click {
        t,
        x: 0.5,
        y: 0.5,
        button: None,
        label: None,
        role: None,
    }
}

#[test]
fn compact_browser_handoff_groups_verified_clicks_and_keeps_unverified_actions_separate() {
    let mut b = bundle(
        Vec::new(),
        vec![
            keyframe(1, 1000, KeyframeReason::SceneChange, ""),
            keyframe(2, 3000, KeyframeReason::SceneChange, ""),
        ],
    );
    let first = "https://example.com/first";
    let second = "https://example.com/second";
    b.events = vec![
        click_at(2000),
        page_observation(2000, first),
        click_at(2500),
        page_observation(2500, first),
        click_at(3000),
        page_observation(3000, first),
        click_at(4000),
        click_at(5000),
        page_observation(5000, first),
        click_at(6000),
        page_observation(6000, second),
    ];
    let flat = |frames: Vec<FrameText>| {
        frames
            .into_iter()
            .flat_map(|frame| frame.lines)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        flat(compact_keyframe_texts(&b).unwrap()),
        [
            first,
            "  0:02, 0:02, 0:03 clicked",
            "0:04 clicked",
            "0:05 clicked · https://example.com/first",
            "0:06 clicked · https://example.com/second",
        ]
    );
    let detailed = flat(keyframe_texts(&b).unwrap());
    assert!(detailed.contains(&"0:05 Action: browser page https://example.com/first".into()));
}

#[test]
fn compact_mark_page_requires_every_stroke_to_resolve_to_the_same_url() {
    let mut b = bundle(
        Vec::new(),
        vec![keyframe(1, 3500, KeyframeReason::Mark, "")],
    );
    b.strokes = vec![stroke(1500, 0.1, 0.1), stroke(3000, 0.3, 0.3)];
    b.marks = crate::capture::engine::sketch::marks_of(&b.strokes);
    b.marks.truncate(1);
    b.marks[0].shape = Shape::Circle;
    b.marks[0].strokes = vec![0, 1];
    b.marks[0].on = Some("“dog”".into());
    b.keyframes[0].mark_id = Some(b.marks[0].id.clone());
    let search = "https://example.com/";
    let window = ActionWindow {
        id: "window".into(),
        app: "Firefox".into(),
        title: Some("dog — Mozilla Firefox".into()),
    };
    b.action_context = [1500, 3000]
        .map(|t| ActionContext {
            pin_window: None,
            kind: ActionKind::Stroke,
            t,
            window: window.clone(),
        })
        .to_vec();
    b.events = vec![
        page_observation(1500, search),
        page_observation(3000, search),
    ];
    assert_eq!(
        compact_keyframe_texts(&b).unwrap()[0].lines,
        ["0:01 Circled “dog” (2 strokes) · https://example.com/ · Nearby: Firefox · dog",]
    );

    b.events[1] = page_observation(3000, "https://example.com/other");
    assert_eq!(
        compact_keyframe_texts(&b).unwrap()[0].lines,
        [
            "Nearby: Firefox · dog",
            "  0:01 Circled “dog” (2 strokes)",
            "0:01 browser page https://example.com/",
            "0:03 browser page https://example.com/other",
        ]
    );
    b.events.pop();
    assert_eq!(compact_keyframe_texts(&b).unwrap()[0].lines.len(), 3);

    b.events.push(click_at(1500));
    assert!(
        compact_keyframe_texts(&b).unwrap()[0]
            .lines
            .iter()
            .any(|line| line == "0:01 browser page https://example.com/")
    );
}
