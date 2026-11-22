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
