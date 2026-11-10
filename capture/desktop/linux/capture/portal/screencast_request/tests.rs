use super::*;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use zbus::zvariant::{ObjectPath, OwnedValue};

struct Bus(Child, String);
impl Bus {
    fn new() -> Self {
        let mut child = Command::new("dbus-daemon")
            .args(["--session", "--nofork", "--nopidfile", "--print-address=1"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut address = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut address)
            .unwrap();
        Self(child, address.trim().to_owned())
    }
}
impl Drop for Bus {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct Request {
    closed: flume::Sender<bool>,
    operation_dropped: Arc<AtomicBool>,
    hang: bool,
}
#[zbus::interface(name = "org.freedesktop.portal.Request")]
impl Request {
    async fn close(&self) {
        self.closed
            .send(self.operation_dropped.load(Ordering::Acquire))
            .unwrap();
        if self.hang {
            futures_lite::future::pending::<()>().await;
        }
    }
}

struct Portal {
    started: flume::Sender<()>,
    closed: flume::Sender<bool>,
    dropped: Arc<AtomicBool>,
    response: Option<u32>,
    mismatch: bool,
}
#[zbus::interface(name = "org.freedesktop.portal.ScreenCast")]
impl Portal {
    async fn start(
        &self,
        session: ObjectPath<'_>,
        parent: &str,
        options: HashMap<String, OwnedValue>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: zbus::message::Header<'_>,
    ) -> zbus::fdo::Result<OwnedObjectPath> {
        assert_eq!(session.as_str(), "/owned/session");
        assert_eq!(parent, "");
        let token = <&str>::try_from(options.get("handle_token").unwrap()).unwrap();
        assert!(token.starts_with("apparent_"));
        let sender = header
            .sender()
            .unwrap()
            .trim_start_matches(':')
            .replace('.', "_");
        let suffix = if self.mismatch { "_other" } else { "" };
        let path = OwnedObjectPath::try_from(format!(
            "/org/freedesktop/portal/desktop/request/{sender}/{token}{suffix}"
        ))
        .unwrap();
        connection
            .object_server()
            .at(
                path.clone(),
                Request {
                    closed: self.closed.clone(),
                    operation_dropped: self.dropped.clone(),
                    hang: false,
                },
            )
            .await
            .unwrap();
        self.started.send(()).unwrap();
        if let Some(status) = self.response {
            // Reply before the Start method returns: exercise signal subscription order.
            let values = if status == 0 {
                HashMap::from([(
                    "streams",
                    Value::new(vec![(42u32, HashMap::<&str, Value<'_>>::new())]),
                )])
            } else {
                HashMap::new()
            };
            connection
                .emit_signal(
                    None::<&str>,
                    path.clone(),
                    "org.freedesktop.portal.Request",
                    "Response",
                    &(status, values),
                )
                .await
                .unwrap();
        }
        Ok(path)
    }
}

fn timed<T>(operation: impl std::future::Future<Output = Result<T>>) -> T {
    let (deadline_tx, deadline_rx) = flume::bounded(1);
    let (finished_tx, finished_rx) = flume::bounded::<()>(1);
    std::thread::scope(|scope| {
        scope.spawn(move || {
            if matches!(
                finished_rx.recv_timeout(Duration::from_secs(4)),
                Err(flume::RecvTimeoutError::Timeout)
            ) {
                let _ = deadline_tx.send(());
            }
        });
        let result = futures_lite::future::block_on(futures_lite::future::race(operation, async {
            let _ = deadline_rx.recv_async().await;
            Err(anyhow!("private portal test deadline exceeded"))
        }));
        drop(finished_tx);
        result.unwrap()
    })
}

async fn connect(bus: &Bus, portal: Portal) -> (zbus::Connection, Proxy<'static>) {
    let server = zbus::connection::Builder::address(bus.1.as_str())
        .unwrap()
        .name("org.freedesktop.portal.Desktop")
        .unwrap()
        .serve_at("/org/freedesktop/portal/desktop", portal)
        .unwrap()
        .build()
        .await
        .unwrap();
    let client = zbus::connection::Builder::address(bus.1.as_str())
        .unwrap()
        .build()
        .await
        .unwrap();
    let proxy = Proxy::new_owned(
        client,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.ScreenCast",
    )
    .await
    .unwrap();
    (server, proxy)
}

struct Dropped(Arc<AtomicBool>);
impl Drop for Dropped {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

#[test]
fn pending_start_closes_its_request_after_dropping_operation_on_cancel_or_disconnect() {
    for disconnect in [false, true] {
        let bus = Bus::new();
        let (started, started_rx) = flume::bounded(1);
        let (closed, closed_rx) = flume::bounded(1);
        let dropped = Arc::new(AtomicBool::new(false));
        let (stop_tx, stop_rx) = flume::bounded(1);
        std::thread::scope(|scope| {
            scope.spawn(move || {
                started_rx.recv_timeout(Duration::from_secs(3)).unwrap();
                if !disconnect {
                    stop_tx.send(()).unwrap();
                }
                drop(stop_tx);
            });
            timed(async {
                let (_server, portal) = connect(
                    &bus,
                    Portal {
                        started,
                        closed,
                        dropped: dropped.clone(),
                        response: None,
                        mismatch: false,
                    },
                )
                .await;
                let request = StartRequest::new(&portal).await?;
                let operation = async {
                    let _dropped = Dropped(dropped.clone());
                    request
                        .start(&portal, &ObjectPath::try_from("/owned/session")?)
                        .await
                };
                let error = request
                    .until_stopped(operation, &stop_rx)
                    .await
                    .unwrap_err();
                assert_eq!(error.to_string(), "Screen sharing was cancelled");
                assert!(
                    closed_rx.recv_timeout(Duration::from_secs(1))?,
                    "pending operation drops before Request.Close"
                );
                assert!(closed_rx.is_empty(), "one close for one owned request");
                Ok(())
            });
        });
    }
}

#[test]
fn immediate_start_response_is_received_and_success_does_not_close_the_request() {
    let bus = Bus::new();
    let (started, _started_rx) = flume::bounded(1);
    let (closed, closed_rx) = flume::bounded(1);
    let (_stop_tx, stop_rx) = flume::bounded(1);
    timed(async {
        let (_server, portal) = connect(
            &bus,
            Portal {
                started,
                closed,
                dropped: Arc::new(AtomicBool::new(false)),
                response: Some(0),
                mismatch: false,
            },
        )
        .await;
        let request = StartRequest::new(&portal).await?;
        let streams = request
            .until_stopped(
                request.start(&portal, &ObjectPath::try_from("/owned/session")?),
                &stop_rx,
            )
            .await?;
        assert_eq!(streams.streams()[0].pipe_wire_node_id(), 42);
        assert!(closed_rx.is_empty());
        Ok(())
    });
}

#[test]
fn mismatched_start_handle_is_closed_and_refused() {
    let bus = Bus::new();
    let (started, _started_rx) = flume::bounded(1);
    let (closed, closed_rx) = flume::bounded(1);
    let (_stop_tx, stop_rx) = flume::bounded(1);
    timed(async {
        let (_server, portal) = connect(
            &bus,
            Portal {
                started,
                closed,
                dropped: Arc::new(AtomicBool::new(true)),
                response: None,
                mismatch: true,
            },
        )
        .await;
        let request = StartRequest::new(&portal).await?;
        let error = request
            .until_stopped(
                request.start(&portal, &ObjectPath::try_from("/owned/session")?),
                &stop_rx,
            )
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "Screen sharing portal returned an unexpected Request handle"
        );
        assert!(closed_rx.recv_timeout(Duration::from_secs(1))?);
        assert!(closed_rx.is_empty());
        Ok(())
    });
}

#[test]
fn unresponsive_request_close_is_bounded() {
    let bus = Bus::new();
    let (closed, closed_rx) = flume::bounded(1);
    timed(async {
        let server = zbus::connection::Builder::address(bus.1.as_str())?
            .name("org.freedesktop.portal.Desktop")?
            .serve_at(
                "/owned/request",
                Request {
                    closed,
                    operation_dropped: Arc::new(AtomicBool::new(true)),
                    hang: true,
                },
            )?
            .build()
            .await?;
        let client = zbus::connection::Builder::address(bus.1.as_str())?
            .build()
            .await?;
        let request = Proxy::new_owned(
            client,
            "org.freedesktop.portal.Desktop",
            "/owned/request",
            "org.freedesktop.portal.Request",
        )
        .await?;
        let started = std::time::Instant::now();
        let error = close_request(&request, Duration::from_millis(100))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "Screen sharing Request.Close timed out");
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(closed_rx.recv_timeout(Duration::from_secs(1))?);
        drop(server);
        Ok(())
    });
}
