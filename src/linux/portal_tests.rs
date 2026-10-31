//! Private D-Bus transport fixture. Never talks to the desktop's real portal.
use super::*;
use std::sync::atomic::AtomicU32;
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

struct DiagnosticSession(flume::Sender<()>);
#[zbus::interface(name = "org.freedesktop.portal.Session")]
impl DiagnosticSession {
    fn close(&self) { let _ = self.0.try_send(()); }
}

struct DiagnosticPortal {
    closed: flume::Sender<()>,
    peers: flume::Sender<std::os::unix::net::UnixStream>,
    next: AtomicU32,
    multiple_nodes: bool,
    remote_count: AtomicU32,
    remote_gate: Option<(flume::Sender<()>, flume::Receiver<bool>)>,
}

async fn diagnostic_response(connection: &zbus::Connection, header: zbus::message::Header<'_>,
    options: &HashMap<String, OwnedValue>, result: HashMap<&str, Value<'_>>) -> zbus::fdo::Result<OwnedObjectPath> {
    let sender = header.sender().unwrap();
    let id = sender.trim_start_matches(':').replace('.', "_");
    let token = options["handle_token"].downcast_ref::<&str>().unwrap();
    let path: OwnedObjectPath = format!("/org/freedesktop/portal/desktop/request/{id}/{token}").try_into().unwrap();
    connection.emit_signal(Some(sender.as_str()), path.clone(), "org.freedesktop.portal.Request", "Response",
        &(0u32, result)).await.unwrap();
    Ok(path)
}

#[zbus::interface(name = "org.freedesktop.portal.ScreenCast")]
impl DiagnosticPortal {
    #[zbus(property)]
    fn version(&self) -> u32 { 5 }

    async fn create_session(&self, options: HashMap<String, OwnedValue>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: zbus::message::Header<'_>) -> zbus::fdo::Result<OwnedObjectPath> {
        let id = header.sender().unwrap().trim_start_matches(':').replace('.', "_");
        let token = options["session_handle_token"].downcast_ref::<&str>().unwrap();
        let session: OwnedObjectPath = format!("/org/freedesktop/portal/desktop/session/{id}/{token}").try_into().unwrap();
        connection.object_server().at(session.clone(), DiagnosticSession(self.closed.clone())).await.unwrap();
        diagnostic_response(connection, header, &options, HashMap::from([("session_handle", Value::from(session))])).await
    }

    async fn select_sources(&self, _session: OwnedObjectPath, options: HashMap<String, OwnedValue>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: zbus::message::Header<'_>) -> zbus::fdo::Result<OwnedObjectPath> {
        assert_eq!(options["multiple"].downcast_ref::<bool>().unwrap(), true);
        diagnostic_response(connection, header, &options, HashMap::new()).await
    }

    async fn start(&self, _session: OwnedObjectPath, _parent: &str, options: HashMap<String, OwnedValue>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: zbus::message::Header<'_>) -> zbus::fdo::Result<OwnedObjectPath> {
        let node = self.next.fetch_add(1, Ordering::Relaxed);
        let mut streams = vec![(node, HashMap::from([("source_type", Value::from(1u32)),
            ("mapping_id", Value::from(if node == 71 { "SYNTHETIC-A" } else { "SYNTHETIC-B" }))]))];
        if self.multiple_nodes {
            streams.push((72, HashMap::from([("source_type", Value::from(1u32)),
                ("mapping_id", Value::from("SYNTHETIC-B"))])));
        }
        diagnostic_response(connection, header, &options, HashMap::from([
            ("streams", Value::from(streams)), ("restore_token", Value::from("PRIVATE-CANARY-NEVER-LOG"))])).await
    }

    async fn open_pipe_wire_remote(&self, _session: OwnedObjectPath, _options: HashMap<String, OwnedValue>) -> zbus::fdo::Result<zbus::zvariant::OwnedFd> {
        if self.remote_count.fetch_add(1, Ordering::Relaxed) == 2
            && let Some((entered, release)) = &self.remote_gate {
            entered.send(()).unwrap();
            if !release.recv_async().await.unwrap() { return Err(zbus::fdo::Error::Failed("synthetic partial connection failure".into())); }
        }
        let (fd, peer) = std::os::unix::net::UnixStream::pair().unwrap();
        self.peers.send(peer).unwrap();
        Ok(zbus::zvariant::OwnedFd::from(OwnedFd::from(fd)))
    }
}

#[test]
fn diagnostic_authorization_runs_on_private_bus() {
    let data = std::env::temp_dir().join(format!("apparent-portal-diag-{}", crate::make_bundle_id()));
    std::fs::create_dir(&data).unwrap();
    let output = std::process::Command::new("dbus-run-session").arg("--").arg(std::env::current_exe().unwrap())
        .args(["--exact", "linux::portal::protocol_tests::diagnostic_authorization_private_bus_fixture", "--ignored", "--nocapture"])
        .env("APPARENT_TEST_OWNED_REQUEST_BUS", "1").env("APPARENT_PORTAL_DIAGNOSTICS", "1")
        .env("XDG_DATA_HOME", &data).output().unwrap();
    std::fs::remove_dir_all(data).unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{stderr}");
    assert!(!stderr.contains("PRIVATE-CANARY-NEVER-LOG"));
    let records: Vec<serde_json::Value> = stderr.lines().filter_map(|line| line.split_once("portal-resource "))
        .map(|(_, json)| serde_json::from_str(json).unwrap()).collect();
    let streams: Vec<_> = records.iter().filter(|r| r["event"] == "held_fd" && r["role"] == "stream").collect();
    assert_eq!(streams.len(), 2);
    let generations: std::collections::HashSet<_> = streams.iter().map(|r| r["generation"].as_u64().unwrap()).collect();
    assert_eq!(generations.len(), 2);
    for held in streams {
        assert_eq!(held["identity_status"], "OBSERVED");
        assert!(held["session"].as_str().unwrap().starts_with("/org/freedesktop/portal/desktop/session/"));
        assert!(held["mapping_sha256"].as_str().unwrap().len() == 64);
        assert!(records.iter().any(|r| r["event"] == "media_binding" && r["generation"] == held["generation"] && r["fd"] == held["fd"]));
        assert!(records.iter().any(|r| r["event"] == "producer_fd_dropped" && r["generation"] == held["generation"] && r["fd"] == held["fd"]));
        assert!(records.iter().any(|r| r["event"] == "held_fd" && r["role"] == "remote" && r["generation"] == held["generation"]
            && r["fd"] == held["parent_fd"] && r["socket_cookie"] == held["socket_cookie"] && r["target"] == held["target"]));
    }
    if let Ok(path) = std::env::var("APPARENT_DIAGNOSTIC_TEST_OUTPUT") {
        let observations: Vec<serde_json::Value> = stderr.lines().filter_map(|line| line.strip_prefix("portal-test-observation "))
            .map(|json| serde_json::from_str(json).unwrap()).collect();
        std::fs::write(path, serde_json::to_vec_pretty(&serde_json::json!({"records": records, "observations": observations})).unwrap()).unwrap();
    }
}

#[test]
#[ignore = "only in the subprocess's isolated bus"]
fn diagnostic_authorization_private_bus_fixture() {
    assert_eq!(std::env::var("APPARENT_TEST_OWNED_REQUEST_BUS").as_deref(), Ok("1"));
    futures_lite::future::block_on(async {
        let (closed, closes) = flume::bounded(4);
        let (peers, remote_peers) = flume::bounded(4);
        let _service = zbus::connection::Builder::session().unwrap().name("org.freedesktop.portal.Desktop").unwrap()
            .serve_at("/org/freedesktop/portal/desktop", DiagnosticPortal { closed, peers, next: AtomicU32::new(71), multiple_nodes: false,
                remote_count: AtomicU32::new(0), remote_gate: None }).unwrap().build().await.unwrap();
        let (release, released) = flume::bounded(1);
        let (ready, is_ready) = flume::bounded(1);
        let worker = std::thread::spawn(move || {
            let mut held = Vec::new();
            for _ in 0..2 {
                let (streams, token) = portal_screencasts_until(false, true, "synthetic-test-only", &AtomicBool::new(false),
                    std::time::Instant::now() + Duration::from_secs(3)).unwrap();
                assert_eq!(token.as_deref(), Some("PRIVATE-CANARY-NEVER-LOG"));
                assert_eq!(streams.len(), 1);
                for stream in &streams { stream.diagnostic_media_binding(); }
                held.extend(streams);
            }
            ready.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(3)).unwrap();
            drop(held);
        });
        let mut peers = Vec::new();
        for _ in 0..4 { peers.push(remote_peers.recv_async().await.unwrap()); }
        is_ready.recv_async().await.unwrap();
        fn observe(label: &str) {
            let fds: HashMap<_, _> = std::fs::read_dir("/proc/self/fd").unwrap().filter_map(|entry| {
                let p = entry.unwrap().path();
                Some((p.file_name()?.to_str()?.to_owned(), std::fs::read_link(&p).ok()?.to_str()?.to_owned()))
            }).collect();
            let cookies: HashMap<_, _> = fds.iter().filter_map(|(fd, target)| {
                if !target.starts_with("socket:[") { return None; }
                let mut cookie = 0u64;
                let mut len = std::mem::size_of_val(&cookie) as libc::socklen_t;
                // Independent observer read while the producer's handles remain held.
                let result = unsafe { libc::getsockopt(fd.parse().unwrap(), libc::SOL_SOCKET,
                    libc::SO_COOKIE, &mut cookie as *mut _ as *mut _, &mut len) };
                (result == 0).then(|| (fd.clone(), cookie.to_string()))
            }).collect();
            eprintln!("portal-test-observation {}", serde_json::json!({"label": label, "fd": fds, "fd_cookie": cookies}));
        }
        observe("active");
        release.send(()).unwrap();
        worker.join().unwrap();
        for (index, mut peer) in peers.into_iter().enumerate() {
            peer.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            use std::io::Read;
            let mut protocol = Vec::new();
            peer.read_to_end(&mut protocol).expect("actual last descriptor release must produce EOF");
            if index % 2 == 1 {
                assert!(protocol.is_empty(), "the recording connection must never acquire a competing reader");
            } else {
                assert!(!protocol.is_empty(), "only the fresh observer connection speaks PipeWire");
            }
        }
        for _ in 0..2 { assert!(closes.recv_timeout(Duration::from_secs(2)).is_ok()); }
        observe("completed");
    });
}

#[test]
fn multiple_node_consumers_run_on_private_bus() {
    let data = std::env::temp_dir().join(format!("apparent-multiple-{}", crate::make_bundle_id()));
    std::fs::create_dir(&data).unwrap();
    for mode in ["success", "partial-failure", "cancel"] {
    let output = std::process::Command::new("dbus-run-session").arg("--").arg(std::env::current_exe().unwrap())
        .args(["--exact", "linux::portal::protocol_tests::multiple_node_consumers_private_bus_fixture", "--ignored", "--nocapture"])
        .env("APPARENT_TEST_OWNED_REQUEST_BUS", "1").env("APPARENT_PORTAL_DIAGNOSTICS", "1")
        .env("APPARENT_TEST_REMOTE_MODE", mode)
        .env("XDG_DATA_HOME", &data).output().unwrap();
    assert!(output.status.success(), "{mode}: {}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    }
    std::fs::remove_dir_all(data).unwrap();
}

#[test]
#[ignore = "only in the subprocess's isolated bus"]
fn multiple_node_consumers_private_bus_fixture() {
    assert_eq!(std::env::var("APPARENT_TEST_OWNED_REQUEST_BUS").as_deref(), Ok("1"));
    futures_lite::future::block_on(async {
        let (closed, closes) = flume::bounded(4);
        let (peers, remote_peers) = flume::bounded(8);
        let mode = std::env::var("APPARENT_TEST_REMOTE_MODE").unwrap();
        let (entered, calls) = flume::bounded(1);
        let (release, released) = flume::bounded(1);
        let _service = zbus::connection::Builder::session().unwrap().name("org.freedesktop.portal.Desktop").unwrap()
            .serve_at("/org/freedesktop/portal/desktop", DiagnosticPortal { closed, peers, next: AtomicU32::new(71), multiple_nodes: true,
                remote_count: AtomicU32::new(0), remote_gate: (mode != "success").then_some((entered, released)) }).unwrap().build().await.unwrap();
        let stopping = Arc::new(AtomicBool::new(false));
        let stop = stopping.clone();
        let worker = std::thread::spawn(move || portal_screencasts_until(false, true, "synthetic-test-only", &stop,
            std::time::Instant::now() + Duration::from_secs(3)));
        if mode != "success" {
            calls.recv_timeout(Duration::from_secs(2)).unwrap();
            if mode == "cancel" { stopping.store(true, Ordering::Release); }
            else { release.send(false).unwrap(); }
            assert!(worker.join().unwrap().is_err());
            closes.recv_timeout(Duration::from_secs(2)).expect("partial grant Session.Close");
            if mode == "cancel" { release.send(true).unwrap(); }
            let count = if mode == "cancel" { 3 } else { 2 };
            for index in 0..count {
                use std::io::Read;
                let mut peer = remote_peers.recv_timeout(Duration::from_secs(2)).unwrap();
                peer.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut bytes = Vec::new();
                peer.read_to_end(&mut bytes).expect("all partial/late remote descriptors must reach actual EOF");
                assert_eq!(bytes.is_empty(), index != 0, "observer cannot read a recording socket");
            }
            return;
        }
        let mut streams = worker.join().unwrap().unwrap().0;
        assert_eq!(streams.len(), 2);
        let cookie = |stream: &Stream| {
            let mut cookie = 0u64;
            let mut len = std::mem::size_of_val(&cookie) as libc::socklen_t;
            assert_eq!(unsafe { libc::getsockopt(stream.fd(), libc::SOL_SOCKET, libc::SO_COOKIE,
                &mut cookie as *mut _ as *mut _, &mut len) }, 0);
            cookie
        };
        assert_ne!(cookie(&streams[0]), cookie(&streams[1]), "independent Recorder consumers require fresh protocol connections, not dup FDs");
        assert!(Arc::ptr_eq(streams[0].stop.as_ref().unwrap(), streams[1].stop.as_ref().unwrap()));
        for (index, stream) in streams.iter().enumerate() {
            assert_eq!(stream.node, 71 + index as u32);
            assert_eq!(stream.mapping_id.as_deref(), Some(if index == 0 { "SYNTHETIC-A" } else { "SYNTHETIC-B" }));
        }
        // This is Recorder's actual pipewiresrc launch wiring, not a duplicate formatter.
        let sources: Vec<_> = streams.drain(..).map(|session| Source::PipeWire { session, crop: None }).collect();
        for source in &sources {
            let Source::PipeWire { session, .. } = source else { unreachable!() };
            let launch = super::super::media::source_launch(source);
            assert!(launch.starts_with(&format!("pipewiresrc fd={} path={} ", session.fd(), session.node)));
        }
        let mut sources = sources;
        drop(sources.remove(0));
        assert!(closes.recv_timeout(Duration::from_millis(50)).is_err(), "one dropped consumer must not close the shared Session");
        drop(sources);
        closes.recv_timeout(Duration::from_secs(2)).unwrap();
        let peers: Vec<_> = remote_peers.try_iter().collect();
        assert_eq!(peers.len(), 3, "two consumers plus one fresh observer");
        for (index, mut peer) in peers.into_iter().enumerate() {
            use std::io::Read;
            peer.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut bytes = Vec::new();
            peer.read_to_end(&mut bytes).unwrap();
            assert_eq!(bytes.is_empty(), index != 0, "only the fresh observer speaks the protocol in this FD fixture");
        }
    });
}

struct FakeRequest(Arc<AtomicBool>);
struct WithheldCreatePortal {
    entered: flume::Sender<String>,
    request_closed: flume::Sender<()>,
    session_closed: flume::Sender<()>,
    delayed_reply: bool,
}

struct CreateRequest {
    closed: flume::Sender<()>,
    release: flume::Sender<()>,
    registered: flume::Receiver<()>,
}

#[zbus::interface(name = "org.freedesktop.portal.Request")]
impl CreateRequest {
    async fn close(&self) {
        self.closed.send(()).unwrap();
        self.release.send(()).unwrap();
        // The hostile-but-bounded test service creates its late Session while
        // Close is in progress, before acknowledging Close to the client.
        self.registered.recv_async().await.unwrap();
    }
}

#[zbus::interface(name = "org.freedesktop.portal.ScreenCast")]
impl WithheldCreatePortal {
    #[zbus(property)]
    fn version(&self) -> u32 { 5 }

    async fn create_session(&self, options: HashMap<String, OwnedValue>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: zbus::message::Header<'_>) -> zbus::fdo::Result<OwnedObjectPath> {
        let sender = header.sender().unwrap().to_owned();
        let id = sender.trim_start_matches(':').replace('.', "_");
        let token = options["session_handle_token"].downcast_ref::<&str>().unwrap();
        let session: OwnedObjectPath = format!("/org/freedesktop/portal/desktop/session/{id}/{token}").try_into().unwrap();
        let token = options["handle_token"].downcast_ref::<&str>().unwrap();
        let request: OwnedObjectPath = format!("/org/freedesktop/portal/desktop/request/{id}/{token}").try_into().unwrap();
        let (release, released) = flume::bounded(1);
        let (registered, registration) = flume::bounded(1);
        connection.object_server().at(request.clone(), CreateRequest {
            closed: self.request_closed.clone(), release, registered: registration,
        }).await.unwrap();
        self.entered.send(sender.to_string()).unwrap();
        if self.delayed_reply {
            released.recv_async().await.unwrap();
            connection.object_server().at(session.clone(), DiagnosticSession(self.session_closed.clone())).await.unwrap();
            connection.emit_signal(Some(sender.as_str()), request.clone(), "org.freedesktop.portal.Request", "Response",
                &(0u32, HashMap::from([("session_handle", Value::from(session))]))).await.unwrap();
            registered.send(()).unwrap();
        } else {
            // Withhold Response but return the method's request handle normally.
            connection.object_server().at(session, DiagnosticSession(self.session_closed.clone())).await.unwrap();
            std::thread::spawn(move || { released.recv().unwrap(); registered.send(()).unwrap(); });
        }
        Ok(request)
    }
}

#[test]
fn create_session_cancellation_runs_on_private_bus() {
    let data = std::env::temp_dir().join(format!("apparent-create-{}", crate::make_bundle_id()));
    std::fs::create_dir(&data).unwrap();
    for mode in ["reply-stop", "reply-deadline", "response-stop", "response-deadline"] {
        let output = std::process::Command::new("dbus-run-session").arg("--").arg(std::env::current_exe().unwrap())
            .args(["--exact", "linux::portal::protocol_tests::create_session_cancellation_private_bus_fixture", "--ignored", "--nocapture"])
            .env("APPARENT_TEST_OWNED_REQUEST_BUS", mode).env("APPARENT_PORTAL_DIAGNOSTICS", "1")
            .env("XDG_DATA_HOME", &data).output().unwrap();
        assert!(output.status.success(), "{mode}: {}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    }
    std::fs::remove_dir_all(data).unwrap();
}

#[test]
#[ignore = "only in the subprocess's isolated bus"]
fn create_session_cancellation_private_bus_fixture() {
    let mode = std::env::var("APPARENT_TEST_OWNED_REQUEST_BUS").unwrap();
    futures_lite::future::block_on(async {
        let (entered, calls) = flume::bounded(1);
        let (request_closed, requests) = flume::bounded(1);
        let (session_closed, sessions) = flume::bounded(1);
        let _service = zbus::connection::Builder::session().unwrap().name("org.freedesktop.portal.Desktop").unwrap()
            .serve_at("/org/freedesktop/portal/desktop", WithheldCreatePortal {
                entered, request_closed, session_closed, delayed_reply: mode.starts_with("reply"),
            }).unwrap().build().await.unwrap();
        let stopping = Arc::new(AtomicBool::new(false));
        let stop = stopping.clone();
        let deadline = if mode.ends_with("deadline") { 350 } else { 3000 };
        let worker = std::thread::spawn(move || portal_screencasts_until(false, true, "synthetic-test-only", &stop,
            std::time::Instant::now() + Duration::from_millis(deadline)));
        let owner = calls.recv_timeout(Duration::from_secs(2)).unwrap();
        let before = std::time::Instant::now();
        if mode.ends_with("stop") { stopping.store(true, Ordering::Release); }
        assert!(worker.join().unwrap().is_err());
        assert!(before.elapsed() < Duration::from_secs(1), "caller must not join native cleanup");
        requests.recv_timeout(Duration::from_secs(2)).expect("CreateSession's actual Request.Close was not called");
        sessions.recv_timeout(Duration::from_secs(2)).expect("late/existing Session.Close was not called");
        let bus = zbus::fdo::DBusProxy::new(&_service).await.unwrap();
        let until = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            let alive = std::fs::read_dir("/proc/self/task").unwrap().filter_map(|entry| {
                std::fs::read_to_string(entry.ok()?.path().join("comm")).ok()
            }).any(|name| name.trim() == "apparent-portal");
            let connected = bus.name_has_owner(owner.as_str().try_into().unwrap()).await.unwrap();
            if !alive && !connected { break; }
            assert!(std::time::Instant::now() < until, "portal worker or cleanup timer leaked");
            std::thread::sleep(Duration::from_millis(20));
        }
    });
}

#[zbus::interface(name = "org.freedesktop.portal.Request")]
impl FakeRequest {
    fn close(&self) { self.0.store(true, Ordering::Release); }
}

struct FakePortal {
    status: Arc<AtomicU32>,
    hold: Arc<AtomicBool>,
    closed: Arc<AtomicBool>,
    called: flume::Sender<()>,
}
#[zbus::interface(name = "org.freedesktop.portal.ScreenCast")]
impl FakePortal {
    async fn select_sources(&self, session: OwnedObjectPath, options: HashMap<String, OwnedValue>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: zbus::message::Header<'_>) -> zbus::fdo::Result<OwnedObjectPath> {
        assert_eq!(session.as_str(), "/synthetic/session");
        assert_eq!(options["types"].downcast_ref::<u32>().unwrap(), 1);
        assert!(!options["multiple"].downcast_ref::<bool>().unwrap());
        let token = options["handle_token"].downcast_ref::<&str>().unwrap();
        let sender = header.sender().unwrap();
        let id = sender.trim_start_matches(':').replace('.', "_");
        let path: OwnedObjectPath = format!("/org/freedesktop/portal/desktop/request/{id}/{token}").try_into().unwrap();
        connection.object_server().at(path.clone(), FakeRequest(Arc::clone(&self.closed))).await.unwrap();
        self.called.try_send(()).unwrap();
        if !self.hold.load(Ordering::Acquire) {
            connection.emit_signal(Some(sender.as_str()), path.clone(), "org.freedesktop.portal.Request", "Response",
                &(self.status.load(Ordering::Acquire), HashMap::<String, OwnedValue>::new())).await.unwrap();
        }
        Ok(path)
    }
}

#[test]
fn owned_request_runs_on_private_bus() {
    let output = std::process::Command::new("dbus-run-session").arg("--").arg(std::env::current_exe().unwrap())
        .args(["--exact", "linux::portal::protocol_tests::owned_request_private_bus_fixture", "--ignored", "--nocapture"])
        .env("APPARENT_TEST_OWNED_REQUEST_BUS", "1").env("APPARENT_PORTAL_DIAGNOSTICS", "1")
        .output().expect("private dbus-run-session fixture");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let records: Vec<serde_json::Value> = String::from_utf8_lossy(&output.stderr).lines()
        .filter_map(|line| line.split_once("portal-resource "))
        .map(|(_, json)| serde_json::from_str(json).unwrap()).collect();
    assert!(records.iter().any(|r| r["event"] == "request_pending"),
        "actual private-bus request must export its owned identity, not just close text");
    for record in &records {
        assert_eq!(record["schema"], 1);
        assert!(record["bus"].as_str().unwrap().starts_with(':'));
        assert!(record["generation"].as_u64().unwrap() > 0);
        assert!(!record.to_string().contains("restore_token"));
    }
}

#[test]
#[ignore = "invoked only by owned_request_runs_on_private_bus in its private bus"]
fn owned_request_private_bus_fixture() {
    assert_eq!(std::env::var("APPARENT_TEST_OWNED_REQUEST_BUS").as_deref(), Ok("1"), "refuse real desktop bus");
    futures_lite::future::block_on(async {
        let status = Arc::new(AtomicU32::new(0));
        let hold = Arc::new(AtomicBool::new(false));
        let closed = Arc::new(AtomicBool::new(false));
        let (called, calls) = flume::bounded(1);
        let _service = zbus::connection::Builder::session().unwrap().name("org.freedesktop.portal.Desktop").unwrap()
            .serve_at("/org/freedesktop/portal/desktop", FakePortal { status: status.clone(), hold: hold.clone(), closed: closed.clone(), called }).unwrap()
            .build().await.unwrap();
        let client = zbus::Connection::session().await.unwrap();
        let proxy = zbus::Proxy::new(&client, "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", "org.freedesktop.portal.ScreenCast").await.unwrap();
        for response in [0, 1, 2] {
            status.store(response, Ordering::Release);
            let request = OwnedPortalRequest::new(&client).unwrap();
            let pending = std::cell::RefCell::new(None);
            let options = HashMap::from([("handle_token", Value::from(request.token.as_str())), ("types", Value::from(1u32)), ("multiple", Value::from(false))]);
            let result = request.perform(&proxy, "SelectSources", &(OwnedObjectPath::try_from("/synthetic/session").unwrap(), options), &pending).await;
            calls.recv_async().await.unwrap();
            assert_eq!(result.is_ok(), response == 0);
            if response == 1 { assert!(user_cancelled(&result.unwrap_err())); }
            assert!(pending.borrow().is_none(), "Response ends owned request");
        }
        hold.store(true, Ordering::Release);
        let request = OwnedPortalRequest::new(&client).unwrap();
        let pending = std::cell::RefCell::new(None);
        let options = HashMap::from([("handle_token", Value::from(request.token.as_str())), ("types", Value::from(1u32)), ("multiple", Value::from(false))]);
        let body = (OwnedObjectPath::try_from("/synthetic/session").unwrap(), options);
        let result = futures_lite::future::race(request.perform(&proxy, "SelectSources", &body, &pending), async {
            calls.recv_async().await.unwrap();
            Err(anyhow!("synthetic cancellation with no Response"))
        }).await;
        assert!(result.is_err());
        assert_eq!(pending.borrow().as_ref(), Some(&request.path));
        // Exercise the same owned Request.Close operation used by detached production cleanup.
        cleanup_portal(async {
            client.call_method(Some("org.freedesktop.portal.Desktop"), pending.take().unwrap(),
                Some("org.freedesktop.portal.Request"), "Close", &()).await.unwrap();
        }, async {}, Duration::from_secs(1)).await;
        assert!(closed.load(Ordering::Acquire), "dropping the pending future alone is not Request.Close");
    });
}
