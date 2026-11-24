use super::*;
use crate::shared::model::*;

#[test]
fn labels_are_one_short_line_and_name_the_element() {
    assert_eq!(clip("  New\n  Tab "), Some("New Tab".into()));
    assert_eq!(clip("   "), None);
    let long = "x".repeat(200);
    let clipped = clip(&long).unwrap();
    assert_eq!(clipped.chars().count(), MAX_CHARS);
    assert!(clipped.ends_with('…'));

    let hit = Hit {
        mark_role: true,
        role: "button".into(),
        label: Some("New Tab".into()),
        identifier: Some("tab-new".into()),
        document: Some("main.rs".into()),
    };
    assert_eq!(
        hit.label_text().as_deref(),
        Some("“New Tab” #tab-new in main.rs")
    );
    assert_eq!(
        hit.on_text().as_deref(),
        Some("button “New Tab” #tab-new in main.rs")
    );
    let bare = Hit {
        role: "group".into(),
        ..Hit::default()
    };
    assert_eq!(bare.label_text(), None);
    assert_eq!(bare.on_text(), None, "a role alone names nothing");
    assert_eq!(
        document_name("file:///Users/k/My%20Notes.md").as_deref(),
        Some("My Notes.md")
    );
}

#[test]
fn icon_only_button_uses_its_accessible_name_and_document_alone_is_unidentified() {
    let next = Hit {
        mark_role: true,
        role: "button".into(),
        label: Some("Next".into()),
        ..Hit::default()
    };
    let unnamed = Hit {
        document: Some("Library".into()),
        label: None,
        ..next.clone()
    };
    assert_eq!(next.mark_text().as_deref(), Some("button “Next”"));
    assert_eq!(unnamed.mark_text(), None);
}

#[test]
fn typed_values_are_never_read() {
    assert!(is_input("AXTextField", "AXSecureTextField"));
    assert!(is_input("AXSecureTextField", ""));
    assert!(is_input("AXTextArea", ""));
    assert!(!is_input("AXStaticText", ""));
    assert!(!is_input("AXButton", ""));
}

#[cfg(target_os = "macos")]
#[test]
fn a_cell_uses_only_one_direct_owned_static_text_name() {
    assert_eq!(
        cell_child_label([
            ("AXImage", None, true),
            ("AXStaticText", Some("Desktop"), true)
        ]),
        Some("Desktop".into())
    );
    assert_eq!(
        cell_child_label([("AXStaticText", Some("Private"), false)]),
        None
    );
    assert_eq!(
        cell_child_label([("AXTextField", Some("typed secret"), true)]),
        None
    );
    assert_eq!(
        cell_child_label([
            ("AXStaticText", Some("One"), true),
            ("AXStaticText", Some("Two"), true)
        ]),
        None
    );
}

#[cfg(target_os = "macos")]
#[test]
fn overlay_fallback_requires_the_front_window_owner() {
    let window = |pid, x| crate::shared::windows::RawWindow {
        id: pid as u32,
        pid,
        owner: String::new(),
        title: String::new(),
        bounds: [x, 0.0, 100.0, 100.0],
        layer: 0,
        alpha: 1.0,
    };
    assert_eq!(
        window_owner_at(&[window(7, 0.0), window(8, 0.0)], 50.0, 50.0, 9),
        Some(7)
    );
    assert_eq!(
        window_owner_at(&[window(9, 0.0), window(7, 0.0)], 50.0, 50.0, 9),
        Some(7)
    );
    assert_eq!(window_owner_at(&[window(7, 200.0)], 50.0, 50.0, 9), None);
    let mut dock = window(6, 0.0);
    dock.owner = "Dock".into();
    dock.layer = 20;
    assert_eq!(
        window_owner_at(&[dock, window(7, 0.0)], 50.0, 50.0, 9),
        Some(7)
    );
    let mut cursor = window(6, 0.0);
    cursor.owner = "Window Server".into();
    cursor.layer = 2_147_483_630;
    assert_eq!(
        window_owner_at(&[cursor, window(7, 0.0)], 50.0, 50.0, 9),
        Some(7)
    );
    let mut menu_bar = window(6, 0.0);
    menu_bar.owner = "Window Server".into();
    menu_bar.layer = 24;
    assert_eq!(
        window_owner_at(&[menu_bar, window(7, 0.0)], 50.0, 50.0, 9),
        Some(6)
    );
}

#[test]
fn results_land_on_the_click_or_stroke_they_were_for() {
    let mut hits = HashMap::new();
    hits.insert(
        Target::Pointer(100),
        Hit {
            role: "button".into(),
            label: Some("Area".into()),
            ..Hit::default()
        },
    );
    hits.insert(
        Target::Stroke(500),
        Hit {
            role: "tab".into(),
            label: Some("Window".into()),
            mark_role: true,
            ..Hit::default()
        },
    );
    let mut events = vec![
        InteractionEvent::Click {
            t: 100,
            x: 0.1,
            y: 0.1,
            button: None,
            label: None,
            role: None,
        },
        InteractionEvent::Click {
            t: 200,
            x: 0.1,
            y: 0.1,
            button: None,
            label: None,
            role: None,
        },
    ];
    let stroke = |t0| Stroke {
        color: None,
        t0,
        t1: t0 + 10,
        fw: 100,
        fh: 100,
        on: None,
        pin: None,
        laser: false,
        pts: vec![0, 0, 0],
    };
    let mut strokes = vec![stroke(500), stroke(600)];
    apply(&hits, &mut events, &mut strokes);
    assert!(
        matches!(&events[0], InteractionEvent::Click { label: Some(l), role: Some(r), .. } if l == "“Area”" && r == "button")
    );
    assert!(matches!(
        &events[1],
        InteractionEvent::Click {
            label: None,
            role: None,
            ..
        }
    ));
    assert_eq!(strokes[0].on.as_deref(), Some("tab “Window”"));
    assert_eq!(strokes[1].on, None);
}

#[test]
fn the_prober_keeps_only_this_captures_results() {
    fn fake(x: f64, _y: f64) -> Option<Hit> {
        (x > 0.0).then(|| Hit {
            role: "button".into(),
            label: Some(format!("{x}")),
            ..Hit::default()
        })
    }
    let prober = Prober::start(fake);
    prober.begin();
    prober.probe(Target::Pointer(1), 5.0, 0.0);
    prober.probe(Target::Pointer(2), -1.0, 0.0);
    let hits = prober.finish();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[&Target::Pointer(1)].label.as_deref(), Some("5"));
    prober.begin();
    assert!(prober.finish().is_empty());
}

#[test]
fn underlines_are_probed_just_above() {
    let frame = TargetFrame {
        x: 100.0,
        y: 50.0,
        width: 1000.0,
        height: 1000.0,
        scale: 2.0,
    };
    let flat = Stroke {
        color: None,
        t0: 0,
        t1: 10,
        fw: 1000,
        fh: 1000,
        on: None,
        pin: None,
        laser: false,
        pts: vec![1000, 5000, 0, 3000, 5050, 5],
    };
    let (x, y) = stroke_probe_point(&flat, frame).unwrap();
    assert!(
        (x - 300.0).abs() < 0.5 && (y - 542.0).abs() < 0.5,
        "{x} {y}"
    );
    let circle = Stroke {
        color: None,
        pts: vec![1000, 1000, 0, 3000, 3000, 5],
        ..flat
    };
    let (x, y) = stroke_probe_point(&circle, frame).unwrap();
    assert!(
        (x - 300.0).abs() < 0.5 && (y - 250.0).abs() < 0.5,
        "{x} {y}"
    );
}
