use super::*;

fn synthetic_window(id: u32, owner: &str, bounds: Rect) -> RawWindow {
    RawWindow {
        id,
        pid: 23,
        owner: owner.into(),
        title: String::new(),
        bounds,
        layer: 0,
        alpha: 1.0,
    }
}

#[test]
fn partial_occlusion_is_unknown_and_passthrough_uses_window_under_ink() {
    let windows = [
        synthetic_window(1, "Ink overlay", [0.0, 0.0, 500.0, 500.0]),
        synthetic_window(2, "Apparent", [0.0, 0.0, 100.0, 200.0]),
        synthetic_window(3, "Firefox", [0.0, 0.0, 500.0, 500.0]),
    ];
    assert_eq!(
        window_at(&windows, [10.0, 10.0, 20.0, 20.0], &[1])
            .unwrap()
            .id,
        2
    );
    assert!(window_at(&windows, [90.0, 10.0, 40.0, 20.0], &[1]).is_none());
    assert_eq!(
        window_at(&windows, [110.0, 10.0, 20.0, 20.0], &[1])
            .unwrap()
            .id,
        3
    );
}

#[test]
fn unknown_title_preserves_observed_app_and_window() {
    let window = evidence("x11:23:4".into(), "Firefox", "\n").unwrap();
    assert_eq!(window.app, "Firefox");
    assert!(window.title.is_none());
    assert!(evidence("x11:23:4".into(), "", "").is_none());
}

#[test]
fn retained_evidence_requires_one_surviving_action_at_the_exact_time() {
    let (jobs, _) = flume::bounded(1);
    let (send, context) = flume::bounded(3);
    let collector = Collector {
        jobs,
        context,
        last_scroll: None, pin_windows: Vec::new(),
    };
    for t in [100, 200, 300] {
        send.send(ActionContext {
            pin_window: None,
            kind: ActionKind::Pointer,
            t,
            window: evidence("x11:23:4".into(), "Firefox", "Invoice").unwrap(),
        })
        .unwrap();
    }
    drop(send);
    let click = |t| InteractionEvent::Click {
        t,
        x: 0.2,
        y: 0.3,
        label: None,
        role: None,
        button: None,
    };
    let rows = collector.finish(&[click(100), click(200), click(200), click(301)], &[]);
    assert_eq!(rows.iter().map(|row| row.t).collect::<Vec<_>>(), vec![100]);
}

#[cfg(target_os = "linux")]
#[test]
#[ignore = "requires an isolated X11 test server with no window manager"]
fn x11_observes_tab_title_changes_in_the_same_window() {
    use crate::capture::desktop::linux::x11;
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::{
        AtomEnum, ConnectionExt as _, CreateWindowAux, PropMode, WindowClass,
    };
    use x11rb::wrapper::ConnectionExt as _;

    let x = x11::x().unwrap();
    let id = x.conn.generate_id().unwrap();
    x.conn
        .create_window(
            x11rb::COPY_DEPTH_FROM_PARENT,
            id,
            x.root,
            15,
            15,
            200,
            100,
            0,
            WindowClass::INPUT_OUTPUT,
            0,
            &CreateWindowAux::new(),
        )
        .unwrap()
        .check()
        .unwrap();
    x.conn
        .change_property32(
            PropMode::REPLACE,
            id,
            x.atom("_NET_WM_PID"),
            AtomEnum::CARDINAL,
            &[std::process::id()],
        )
        .unwrap()
        .check()
        .unwrap();
    x.conn
        .change_property8(
            PropMode::REPLACE,
            id,
            AtomEnum::WM_CLASS,
            AtomEnum::STRING,
            b"firefox\0Firefox\0",
        )
        .unwrap()
        .check()
        .unwrap();
    for property in [
        "_NET_CLIENT_LIST",
        "_NET_CLIENT_LIST_STACKING",
        "_NET_ACTIVE_WINDOW",
    ] {
        x.conn
            .change_property32(
                PropMode::REPLACE,
                x.root,
                x.atom(property),
                AtomEnum::WINDOW,
                &[id],
            )
            .unwrap()
            .check()
            .unwrap();
    }
    x.conn.map_window(id).unwrap().check().unwrap();

    let frame = TargetFrame {
        x: 0.0,
        y: 0.0,
        width: 500.0,
        height: 400.0,
        scale: 1.0,
    };
    let session = Collector::start().unwrap();
    let mut previous_id = None;
    for (time, title) in [
        (100, "First synthetic page — Mozilla Firefox"),
        (200, "Second synthetic page — Mozilla Firefox"),
    ] {
        x.conn
            .change_property8(
                PropMode::REPLACE,
                id,
                x.atom("_NET_WM_NAME"),
                x.atom("UTF8_STRING"),
                title.as_bytes(),
            )
            .unwrap()
            .check()
            .unwrap();
        let at = Instant::now();
        session
            .jobs
            .try_send(Request {
                key: (ActionKind::Pointer, time),
                at,
                probe: Probe::Point(50.0, 50.0),
                frame,
                passthrough: Vec::new(),
                dock: None,
            })
            .unwrap_or_else(|_| panic!("observation queue unavailable"));
        let row = session
            .context
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        eprintln!("X11 action observation in {:?}", at.elapsed());
        assert_eq!(row.t, time);
        assert_eq!(row.window.app, "Firefox");
        assert_eq!(row.window.title.as_deref(), Some(title));
        if let Some(prior) = &previous_id {
            assert_eq!(prior, &row.window.id);
        }
        previous_id = Some(row.window.id);
    }
    x.conn.destroy_window(id).unwrap().check().unwrap();
}
