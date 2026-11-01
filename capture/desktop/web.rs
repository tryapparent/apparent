//! Local dev-page registration and context for browser captures.
//!
//! A project adds `<script src="http://127.0.0.1:47777/sdk.js" data-session="ses_…"></script>`
//! (or `data-directory`) to its dev build. The script registers the page with the local server
//! and heartbeats while the tab is open. Registrations last `TTL_MS` past the last heartbeat.
//!
//! Only a page on a loopback origin, calling from this Mac, may register.
//!
//! With the `agentContext` experiment on, a loopback page also posts what it sees under clicks
//! and marks, plus errors, failed requests and video playback, to `/web/context` (`crate::page`).

use std::io::{Read as _, Write as _};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::shared::routing::{is_loopback_host, parse_url};

/// How long a registration lasts after its last heartbeat. The script beats every 30 s.
pub const TTL_MS: u64 = 120_000;
const MAX_ENTRIES: usize = 64;
const SDK_JS: &str = include_str!("sdk.js");
pub const PORT: u16 = 47777;

/// The browser SDK runs on a local listener independently of phone capture.
pub fn start_server() {
    std::thread::spawn(|| {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(listener) => listener,
            Err(error) => {
                crate::capture::engine::runtime::apparent_log(format!("Web SDK port {PORT}: {error}"));
                return;
            }
        };
        set_serving();
        let connections = crate::capture::desktop::ingest_http::Connections::default();
        for incoming in listener.incoming() {
            let Ok(mut stream) = incoming else { continue };
            let Some(permit) = connections.acquire() else { continue };
            std::thread::spawn(move || {
                let _permit = permit;
                if let Ok(Some(header)) = crate::capture::desktop::ingest_http::read_header(
                    &mut stream, crate::capture::desktop::ingest_http::HEADER_TIMEOUT,
                ) {
                    if !handle(&mut stream, &header).unwrap_or(false) {
                        respond_json(&mut stream, "404 Not Found", &serde_json::json!({"ok":false}), None);
                    }
                }
            });
        }
    });
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    pub origin: String,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    /// A random ID per page load, so two tabs on one origin come and go separately.
    #[serde(default)]
    pub tab: String,
    #[serde(default)]
    pub seen_ms: u64,
}

#[derive(Debug, Default)]
pub struct Registry {
    entries: Vec<Registration>,
}

impl Registry {
    pub fn register(&mut self, mut reg: Registration, now: u64) {
        reg.seen_ms = now;
        self.entries.retain(|e| {
            now.saturating_sub(e.seen_ms) <= TTL_MS && !(e.origin == reg.origin && e.tab == reg.tab)
        });
        self.entries.push(reg);
        if self.entries.len() > MAX_ENTRIES {
            self.entries.sort_by_key(|e| std::cmp::Reverse(e.seen_ms));
            self.entries.truncate(MAX_ENTRIES);
        }
    }

    pub fn unregister(&mut self, origin: &str, tab: &str) {
        self.entries
            .retain(|e| !(e.origin == origin && e.tab == tab));
    }

    pub fn live(&self, now: u64) -> Vec<Registration> {
        self.entries
            .iter()
            .filter(|e| now.saturating_sub(e.seen_ms) <= TTL_MS)
            .cloned()
            .collect()
    }

    /// The live registration for `url`'s origin: the tab on that exact URL, else the most
    /// recently heard from.
    pub fn lookup(&self, url: &str, now: u64) -> Option<Registration> {
        let origin = parse_url(url)?.origin();
        let live = self
            .live(now)
            .into_iter()
            .filter(|e| e.origin == origin)
            .collect::<Vec<_>>();
        live.iter()
            .filter(|e| e.url == url)
            .max_by_key(|e| e.seen_ms)
            .or_else(|| live.iter().max_by_key(|e| e.seen_ms))
            .cloned()
    }
}

static REGISTRY: Mutex<Registry> = Mutex::new(Registry {
    entries: Vec::new(),
});
/// Whether this process owns the browser SDK port, and so holds the registrations.
static SERVING: AtomicBool = AtomicBool::new(false);

fn registry() -> std::sync::MutexGuard<'static, Registry> {
    REGISTRY
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub fn set_serving() {
    SERVING.store(true, Ordering::Release);
}

/// The live registration for `url`, from this process when it runs the web server, else
/// from the one that does.
pub fn lookup(url: &str) -> Option<Registration> {
    let now = crate::shared::clock::now_epoch_ms();
    if SERVING.load(Ordering::Acquire) {
        return registry().lookup(url, now);
    }
    let mut remote = Registry::default();
    for reg in fetch_registrations(PORT).ok()? {
        remote.entries.push(reg);
    }
    remote.lookup(url, now)
}

/// The running local server's live registrations.
pub fn fetch_registrations(port: u16) -> Result<Vec<Registration>> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(400))
        .with_context(|| format!("Apparent isn't listening on port {port}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    write!(
        stream,
        "GET /web/registrations HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    let response = String::from_utf8_lossy(&response);
    let (head, body) = response
        .split_once("\r\n\r\n")
        .context("Malformed response")?;
    anyhow::ensure!(
        head.starts_with("HTTP/1.1 200"),
        "Apparent answered {}",
        head.lines().next().unwrap_or("")
    );
    let value: serde_json::Value = serde_json::from_str(body)?;
    Ok(serde_json::from_value(
        value.get("registrations").cloned().unwrap_or_default(),
    )?)
}

// MARK: Who may register

/// A browser `Origin` on this machine: `http(s)://localhost`, `*.localhost`, `127.x`, `[::1]`.
pub fn is_loopback_origin(origin: &str) -> bool {
    parse_url(origin).is_some_and(|u| is_loopback_host(&u.host))
}

/// A browser origin and peer must both be local.
pub fn may_register(origin: Option<&str>, peer_loopback: bool) -> bool {
    peer_loopback && origin.is_some_and(is_loopback_origin)
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Body {
    url: Option<String>,
    title: Option<String>,
    session: Option<String>,
    directory: Option<String>,
    tab: Option<String>,
}

fn valid_session(id: &str) -> bool {
    id.starts_with("ses")
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The registration a request describes. The page's own `Origin` header is authoritative.
fn registration_from(body: Body, header_origin: Option<&str>) -> std::result::Result<Registration, &'static str> {
    let origin = header_origin
        .and_then(parse_url)
        .ok_or("missing or invalid origin")?
        .origin();
    let url = body
        .url
        .filter(|u| u.len() <= 4096 && parse_url(u).is_some_and(|p| p.origin() == origin))
        .unwrap_or_else(|| format!("{origin}/"));
    let session = body
        .session
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());
    if session.as_deref().is_some_and(|s| !valid_session(s)) {
        return Err("invalid session ID");
    }
    let directory = body
        .directory
        .map(|d| d.trim().trim_end_matches('/').to_owned())
        .filter(|d| !d.is_empty());
    if directory
        .as_deref()
        .is_some_and(|d| !d.starts_with('/') || d.len() > 1024 || d.contains('\0'))
    {
        return Err("directory must be an absolute path");
    }
    let tab: String = body
        .tab
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(32)
        .collect();
    Ok(Registration {
        origin,
        url,
        title: body.title.unwrap_or_default().chars().take(200).collect(),
        session,
        directory,
        tab,
        seen_ms: 0,
    })
}

// MARK: HTTP

fn header_value<'a>(header: &'a str, name: &str) -> Option<&'a str> {
    header.lines().skip(1).find_map(|line| {
        let (k, v) = line.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim())
    })
}

/// Reject rebinding to the loopback listener through an attacker-controlled hostname.
fn local_host(header: &str) -> bool {
    header_value(header, "host").is_some_and(|host| {
        ["127.0.0.1", "localhost"]
            .iter()
            .any(|name| host.eq_ignore_ascii_case(name) || host.eq_ignore_ascii_case(&format!("{name}:{PORT}")))
    })
}

fn respond(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    origin: Option<&str>,
) {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(origin) = origin {
        head.push_str(&format!(
            "Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\n"
        ));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn respond_json(
    stream: &mut TcpStream,
    status: &str,
    body: &serde_json::Value,
    origin: Option<&str>,
) {
    respond(
        stream,
        status,
        "application/json",
        body.to_string().as_bytes(),
        origin,
    );
}

/// Answers the SDK's routes; `false` for unrecognized paths.
pub fn handle(stream: &mut TcpStream, header: &str) -> Result<bool> {
    let first = header.lines().next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let path = path.split('?').next().unwrap_or("");
    let is_web = path.starts_with("/web/");
    if !(path == "/sdk.js" || is_web) {
        return Ok(false);
    }
    if !local_host(header) {
        respond_json(stream, "403 Forbidden", &serde_json::json!({"ok": false}), None);
        return Ok(true);
    }
    let origin = header_value(header, "origin").filter(|o| *o != "null");
    let peer_loopback = stream.peer_addr().is_ok_and(|a| a.ip().is_loopback());

    match (method, path) {
        ("GET", "/sdk.js") => {
            respond(
                stream,
                "200 OK",
                "text/javascript; charset=utf-8",
                SDK_JS.as_bytes(),
                None,
            );
        }
        ("OPTIONS", _) => respond(stream, "204 No Content", "text/plain", b"", origin),
        ("GET", "/web/registrations") => {
            if peer_loopback {
                let live = registry().live(crate::shared::clock::now_epoch_ms());
                respond_json(
                    stream,
                    "200 OK",
                    &serde_json::json!({ "registrations": live }),
                    None,
                );
            } else {
                respond_json(
                    stream,
                    "401 Unauthorized",
                    &serde_json::json!({"ok": false}),
                    None,
                );
            }
        }
        ("POST", "/web/context") => {
            let len: usize = header_value(header, "content-length")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            anyhow::ensure!(len <= 64 * 1024, "Page context too large");
            let bytes =
                crate::capture::desktop::ingest_http::read_body(stream, len, crate::capture::desktop::ingest_http::SMALL_BODY_TIMEOUT)?;
            // Loopback pages only.
            let Some(page_origin) = origin
                .filter(|o| peer_loopback && is_loopback_origin(o))
                .and_then(parse_url)
                .map(|u| u.origin())
            else {
                respond_json(
                    stream,
                    "403 Forbidden",
                    &serde_json::json!({"ok": false, "error": "only loopback pages send context"}),
                    None,
                );
                return Ok(true);
            };
            let wanted = crate::shared::handoff::experiment(crate::shared::handoff::AGENT_CONTEXT);
            if wanted && let Ok(post) = serde_json::from_slice::<crate::capture::desktop::workflow::page::Post>(&bytes) {
                crate::capture::desktop::workflow::page::record(&page_origin, post);
            }
            respond_json(
                stream,
                "200 OK",
                &serde_json::json!({"ok": true, "context": wanted}),
                origin,
            );
        }
        ("POST", "/web/register" | "/web/unregister") => {
            let len: usize = header_value(header, "content-length")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            anyhow::ensure!(len <= 16 * 1024, "Registration too large");
            // Read the body even when refusing, so the answer isn't lost to a reset. Within a
            // total deadline, so a client trickling it can't hold a connection slot.
            let bytes =
                crate::capture::desktop::ingest_http::read_body(stream, len, crate::capture::desktop::ingest_http::SMALL_BODY_TIMEOUT)?;
            if !may_register(origin, peer_loopback) {
                respond_json(
                    stream,
                    "403 Forbidden",
                    &serde_json::json!({"ok": false, "error": "only loopback pages may register"}),
                    None,
                );
                return Ok(true);
            }
            let body: Body = serde_json::from_slice(&bytes).unwrap_or_default();
            match registration_from(body, origin) {
                Ok(reg) if path == "/web/unregister" => {
                    registry().unregister(&reg.origin, &reg.tab);
                    respond_json(stream, "200 OK", &serde_json::json!({"ok": true}), origin);
                }
                Ok(reg) => {
                    // `context`: the page may send what it sees (`crate::page`); loopback only.
                    let context = origin.is_some_and(is_loopback_origin)
                        && crate::shared::handoff::experiment(crate::shared::handoff::AGENT_CONTEXT);
                    crate::capture::engine::runtime::apparent_log(format!(
                            "web: {} registered (session {}, directory {})",
                            reg.url,
                            reg.session.as_deref().unwrap_or("-"),
                            reg.directory.as_deref().unwrap_or("-")
                        ));
                    registry().register(reg, crate::shared::clock::now_epoch_ms());
                    respond_json(
                        stream,
                        "200 OK",
                        &serde_json::json!({"ok": true, "ttlMs": TTL_MS, "context": context}),
                        origin,
                    );
                }
                Err(error) => respond_json(
                    stream,
                    "400 Bad Request",
                    &serde_json::json!({"ok": false, "error": error}),
                    origin,
                ),
            }
        }
        _ => respond_json(
            stream,
            "404 Not Found",
            &serde_json::json!({"ok": false}),
            origin,
        ),
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_loopback_origins_register() {
        assert!(may_register(Some("http://localhost:5173"), true));
        assert!(!may_register(Some("http://localhost:5173"), false));
        assert!(!may_register(Some("https://example.com"), true));
        assert!(!may_register(None, true));
    }

    #[test]
    fn pages_register_only_their_own_origin() {
        let body = Body {
            url: Some("https://victim.example/x".into()),
            session: Some("ses_abc".into()),
            tab: Some("t1!".into()),
            ..Body::default()
        };
        let reg = registration_from(body, Some("http://localhost:5173")).unwrap();
        assert_eq!(reg.origin, "http://localhost:5173");
        assert_eq!(reg.url, "http://localhost:5173/");
        assert_eq!(reg.tab, "t1");
        assert_eq!(reg.session.as_deref(), Some("ses_abc"));
        assert!(registration_from(Body { session: Some("ses_a; rm -rf".into()), ..Body::default() }, Some("http://localhost:1")).is_err());
        assert!(registration_from(Body::default(), None).is_err());
    }

    fn reg(origin: &str, url: &str, tab: &str, session: &str) -> Registration {
        Registration {
            origin: origin.into(),
            url: url.into(),
            tab: tab.into(),
            session: Some(session.into()),
            ..Registration::default()
        }
    }

    #[test]
    fn registrations_expire_and_prefer_the_exact_tab() {
        let mut registry = Registry::default();
        let o = "http://localhost:5173";
        registry.register(reg(o, "http://localhost:5173/a", "1", "ses_a"), 1_000);
        registry.register(reg(o, "http://localhost:5173/b", "2", "ses_b"), 2_000);
        let session = |r: &Registry, url: &str, now| r.lookup(url, now).and_then(|r| r.session);
        assert_eq!(
            session(&registry, "http://localhost:5173/a", 3_000).as_deref(),
            Some("ses_a")
        );
        // Another page on the origin goes to the newest tab.
        assert_eq!(
            session(&registry, "http://localhost:5173/c", 3_000).as_deref(),
            Some("ses_b")
        );
        assert_eq!(session(&registry, "http://localhost:3000/", 3_000), None);
        // Tab 2 stops heartbeating; tab 1 heartbeats on.
        registry.register(reg(o, "http://localhost:5173/a", "1", "ses_a"), 100_000);
        assert_eq!(
            session(&registry, "http://localhost:5173/c", 2_000 + TTL_MS + 1).as_deref(),
            Some("ses_a")
        );
        assert_eq!(
            session(&registry, "http://localhost:5173/a", 100_000 + TTL_MS + 1),
            None
        );
        // A heartbeat replaces the tab's entry instead of adding one.
        registry.register(reg(o, "http://localhost:5173/a", "1", "ses_a"), 100_500);
        assert_eq!(registry.live(100_500).len(), 2);
        registry.unregister(o, "1");
        assert_eq!(registry.live(100_500).len(), 1);
    }

    fn request(raw: &str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let raw = if raw.to_ascii_lowercase().contains("\r\nhost:") {
            raw.to_owned()
        } else {
            raw.replacen("\r\n", "\r\nHost: 127.0.0.1:47777\r\n", 1)
        };
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.write_all(raw.as_bytes()).unwrap();
            let mut out = String::new();
            stream.read_to_string(&mut out).unwrap();
            out
        });
        let (mut stream, _) = listener.accept().unwrap();
        let mut header = Vec::new();
        let mut byte = [0_u8; 1];
        while !header.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            header.push(byte[0]);
        }
        let header = String::from_utf8(header).unwrap();
        if !handle(&mut stream, &header).unwrap() {
            respond_json(&mut stream, "404 Not Found", &serde_json::json!({"ok": false}), None);
        }
        drop(stream);
        client.join().unwrap()
    }

    #[test]
    fn web_registration_body_has_a_total_deadline() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let writer = std::thread::spawn(move || {
            let mut client = TcpStream::connect(addr).unwrap();
            client
                .write_all(b"POST /web/register HTTP/1.1\r\nHost: 127.0.0.1:47777\r\nOrigin: http://localhost:6123\r\nContent-Length: 100\r\n\r\n")
                .unwrap();
            for _ in 0..7 {
                if client.write_all(b"x").is_err() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        });
        let (mut server, _) = listener.accept().unwrap();
        server.set_read_timeout(Some(std::time::Duration::from_secs(30))).unwrap();
        let header = crate::capture::desktop::ingest_http::read_header(&mut server, crate::capture::desktop::ingest_http::HEADER_TIMEOUT)
            .unwrap()
            .unwrap();
        let start = std::time::Instant::now();
        assert!(handle(&mut server, &header).is_err());
        assert!(
            start.elapsed() < std::time::Duration::from_millis(6_000),
            "body trickle occupied a connection beyond the deadline"
        );
        drop(server);
        writer.join().unwrap();
    }

    #[test]
    fn http_routes_serve_the_script_and_check_registrations() {
        let js = request("GET /sdk.js HTTP/1.1\r\nHost: 127.0.0.1:47777\r\n\r\n" );
        assert!(
            js.starts_with("HTTP/1.1 200") && js.contains("/web/register"),
            "{js}"
        );

        let body = r#"{"url":"http://localhost:6123/","session":"ses_webtest","tab":"zz"}"#;
        let ok = request(
            &format!(
                "POST /web/register HTTP/1.1\r\nOrigin: http://localhost:6123\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            ),
        );
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        assert!(ok.contains("Access-Control-Allow-Origin: http://localhost:6123"));
        assert_eq!(
            registry()
                .lookup("http://localhost:6123/", crate::shared::clock::now_epoch_ms())
                .and_then(|r| r.session)
                .as_deref(),
            Some("ses_webtest")
        );

        let remote = request(
            &format!(
                "POST /web/register HTTP/1.1\r\nOrigin: https://example.com\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            ),
        );
        assert!(remote.starts_with("HTTP/1.1 403"), "{remote}");
        let authed = request(
            &format!(
                "POST /web/register HTTP/1.1\r\nOrigin: https://example.com\r\nAuthorization: Bearer tok\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            ),
        );
        assert!(authed.starts_with("HTTP/1.1 403"), "{authed}");

        let list = request("GET /web/registrations HTTP/1.1\r\n\r\n" );
        assert!(list.starts_with("HTTP/1.1 200"), "{list}");
        let rebound = request("GET /web/registrations HTTP/1.1\r\nHost: attacker.example:47777\r\n\r\n");
        assert!(rebound.starts_with("HTTP/1.1 403"), "{rebound}");
        assert!(!rebound.contains("ses_webtest"), "{rebound}");
        let no_host = request("GET /web/registrations HTTP/1.1\r\nHost: \r\n\r\n");
        assert!(no_host.starts_with("HTTP/1.1 403"), "{no_host}");
        let retired = request("POST /ingest HTTP/1.1\r\n\r\n");
        assert!(retired.starts_with("HTTP/1.1 404"), "{retired}");
        let list = request(
            "GET /web/registrations HTTP/1.1\r\nAuthorization: Bearer tok\r\n\r\n",
        );
        assert!(list.contains("ses_webtest"), "{list}");

        let unregister = request(
            &format!(
                "POST /web/unregister HTTP/1.1\r\nOrigin: http://localhost:6123\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            ),
        );
        assert!(unregister.starts_with("HTTP/1.1 200"), "{unregister}");

        // Page context is loopback-only and ignored with the experiment off.
        let context = r#"{"tab":"zz","events":[]}"#;
        let refused = request(
            &format!(
                "POST /web/context HTTP/1.1\r\nOrigin: https://example.com\r\nAuthorization: Bearer tok\r\nContent-Length: {}\r\n\r\n{context}",
                context.len()
            ),
        );
        assert!(refused.starts_with("HTTP/1.1 403"), "{refused}");
        let accepted = request(
            &format!(
                "POST /web/context HTTP/1.1\r\nOrigin: http://localhost:6123\r\nContent-Length: {}\r\n\r\n{context}",
                context.len()
            ),
        );
        assert!(
            accepted.starts_with("HTTP/1.1 200") && accepted.contains(r#""context":false"#),
            "{accepted}"
        );
        assert!(
            registry()
                .lookup("http://localhost:6123/", crate::shared::clock::now_epoch_ms())
                .is_none()
        );
    }
}
