use super::*;
use crate::shared::model::SCALE;

fn circle(time: u64) -> Stroke {
    let pts = (0..=40)
        .flat_map(|i| {
            let angle = std::f32::consts::TAU * i as f32 / 40.0;
            let unit = SCALE as f32;
            [
                ((0.5 + 0.2 * angle.cos()) * unit) as i32,
                ((0.5 + 0.2 * angle.sin()) * unit) as i32,
                i * 3,
            ]
        })
        .collect();
    Stroke {
        color: None,
        t0: time,
        t1: time + 120,
        fw: 640,
        fh: 480,
        on: None,
        pin: None,
        laser: false,
        pts,
    }
}

#[test]
fn before_ink_pixels_follow_the_circle_and_native_labels_win() {
    let session = Session::start(|frame, points| {
        assert!(points.len() > 30);
        assert!(frame.width < 300 && frame.height < 240 && frame.rgba[0] == 80);
        Some("“Post”".to_owned())
    })
    .unwrap();
    let mut stroke = circle(500);
    session.sample(RgbaFrame::new(480, 640, 480, vec![80; 640 * 480 * 4]));
    session.begin_mark(500);
    session.sample(RgbaFrame::new(540, 640, 480, vec![0; 640 * 480 * 4]));
    session.end_mark(&stroke);
    let deadline = Instant::now() + Duration::from_secs(3);
    while session.labels.is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(!session.labels.is_empty());
    session.apply(std::slice::from_mut(&mut stroke));
    assert_eq!(
        sketch::marks_of(&[stroke.clone()])[0].on.as_deref(),
        Some("“Post”")
    );
    let (queue, _) = flume::bounded(1);
    let (sender, labels) = flume::bounded(3);
    let session = Session {
        samples: Mutex::default(),
        queue,
        labels,
    };
    stroke.on = Some("button “Post”".into());
    sender.send((0, 500, "wrong".into())).unwrap();
    session.apply(std::slice::from_mut(&mut stroke));
    assert_eq!(stroke.on.as_deref(), Some("button “Post”"));
    stroke.on = None;
    sender.send((0, 500, "withdrawn".into())).unwrap();
    session.clear_samples();
    session.apply(std::slice::from_mut(&mut stroke));
    assert!(stroke.on.is_none());
}

#[test]
fn legacy_stroke_and_unavailable_recognizer_keep_the_unidentified_mark() {
    let encoded = serde_json::to_value(circle(500)).unwrap();
    assert!(encoded.get("on").is_none());
    let stroke: Stroke = serde_json::from_value(encoded).unwrap();
    let frame = Arc::new(RgbaFrame::new(480, 640, 480, vec![0; 640 * 480 * 4]));
    let job = Job {
        generation: 0,
        frame,
        stroke: stroke.clone(),
    };
    assert_eq!(recognize(&job, |_, _| None), None);
    let mark = sketch::marks_of(&[stroke]).pop().unwrap();
    assert_eq!(mark.on, None);
    assert_eq!(mark.t0, 500);
    assert_eq!(mark.shape, Shape::Circle);
    assert!(mark.box_norm[0] < mark.box_norm[2]);
}

#[test]
fn quick_completed_circles_keep_their_own_labels_and_regions() {
    let (queue, _) = flume::bounded(1);
    let (sender, labels) = flume::bounded(3);
    let session = Session { samples: Mutex::default(), queue, labels };
    let mut strokes = [circle(1500), circle(2600), circle(3700)];
    for (stroke, center) in strokes.iter_mut().zip([2000, 5000, 8000]) {
        for point in stroke.pts.chunks_exact_mut(3) {
            point[0] = center + (point[0] - 5000) / 2;
        }
    }
    for (stroke, label) in strokes.iter().zip(["image “dog”", "image “cat”", "image “dog”"]) {
        sender.send((0, stroke.t0, label.into())).unwrap();
    }
    session.apply(&mut strokes);
    let marks = sketch::marks_of(&strokes);
    assert_eq!(marks.len(), 3);
    for (i, (mark, label)) in marks.iter().zip(["image “dog”", "image “cat”", "image “dog”"]).enumerate() {
        assert_eq!(mark.shape, Shape::Circle);
        assert_eq!(mark.strokes, [i]);
        assert_eq!(mark.t0, strokes[i].t0);
        assert_eq!(mark.on.as_deref(), Some(label));
    }
    assert!(marks.windows(2).all(|pair| pair[0].box_norm[2] < pair[1].box_norm[0]));
}
