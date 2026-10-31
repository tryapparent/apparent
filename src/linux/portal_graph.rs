//! Read-only, opt-in PipeWire registry probe on a FRESH OpenPipeWireRemote socket.
//! No stream, node binding, activation, media read, or default-server connection.
//! ABI prefixes follow PipeWire 0.3 core.h/thread-loop.h and SPA hook.h/dict.h.
//! The library is loaded once and stays resident (pw_init owns process-global state).
use std::ffi::{CStr, c_char, c_int, c_void};
use std::os::fd::{AsRawFd, IntoRawFd, OwnedFd};
use std::ptr::{null, null_mut};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use serde_json::{Value, json};

type P = *mut c_void;
#[repr(C)] struct Callbacks { funcs: *const c_void, data: P }
#[repr(C)] struct Interface { kind: *const c_char, version: u32, cb: Callbacks }
#[repr(C)] struct Hook { link: [P; 2], cb: Callbacks, removed: Option<unsafe extern "C" fn(P)>, private: P }
#[repr(C)] struct Dict { flags: u32, len: u32, items: *const Item }
#[repr(C)] struct Item { key: *const c_char, value: *const c_char }
#[repr(C)] struct CoreInfo { id: u32, cookie: u32 }
#[repr(C)] struct CoreEvents {
    version: u32,
    info: Option<unsafe extern "C" fn(P, *const CoreInfo)>,
    done: Option<unsafe extern "C" fn(P, u32, c_int)>,
    ping: Option<unsafe extern "C" fn(P, u32, c_int)>,
    error: Option<unsafe extern "C" fn(P, u32, c_int, c_int, *const c_char)>,
    // Version 0 ends at remove_mem. Version 1's bound_props is not requested.
    tail: [Option<unsafe extern "C" fn()>; 4],
}
#[repr(C)] struct RegistryEvents {
    version: u32,
    global: Option<unsafe extern "C" fn(P, u32, u32, *const c_char, u32, *const Dict)>,
    removed: Option<unsafe extern "C" fn(P, u32)>,
}
#[repr(C)] struct CoreMethods {
    version: u32,
    add: unsafe extern "C" fn(P, *mut Hook, *const CoreEvents, P) -> c_int,
    hello: Option<unsafe extern "C" fn()>,
    sync: unsafe extern "C" fn(P, u32, c_int) -> c_int,
    pong: Option<unsafe extern "C" fn()>,
    error: Option<unsafe extern "C" fn()>,
    registry: unsafe extern "C" fn(P, u32, usize) -> P,
}
#[repr(C)] struct RegistryMethods {
    version: u32,
    add: unsafe extern "C" fn(P, *mut Hook, *const RegistryEvents, P) -> c_int,
}
struct Api {
    init: unsafe extern "C" fn(*mut c_int, *mut *mut *mut c_char),
    loop_new: unsafe extern "C" fn(*const c_char, *const Dict) -> P,
    loop_get: unsafe extern "C" fn(P) -> P,
    loop_start: unsafe extern "C" fn(P) -> c_int,
    loop_stop: unsafe extern "C" fn(P),
    loop_destroy: unsafe extern "C" fn(P),
    lock: unsafe extern "C" fn(P),
    unlock: unsafe extern "C" fn(P),
    context_new: unsafe extern "C" fn(P, P, usize) -> P,
    context_destroy: unsafe extern "C" fn(P),
    connect: unsafe extern "C" fn(P, c_int, P, usize) -> P,
    disconnect: unsafe extern "C" fn(P) -> c_int,
}
fn api() -> Option<&'static Api> {
    static API: OnceLock<Option<Api>> = OnceLock::new();
    API.get_or_init(|| {
        // SAFETY: fixed system SONAME, fixed C ABI symbol types. Never load a path
        // from the diagnostic trace or user configuration. No library unload.
        unsafe {
            let lib = libc::dlopen(c"libpipewire-0.3.so.0".as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
            if lib.is_null() { return None; }
            macro_rules! symbol { ($name:literal, $ty:ty) => {{
                let p = libc::dlsym(lib, concat!($name, "\0").as_ptr().cast());
                if p.is_null() { return None; }
                std::mem::transmute::<P, $ty>(p)
            }}; }
            let a = Api {
                init: symbol!("pw_init", unsafe extern "C" fn(*mut c_int, *mut *mut *mut c_char)),
                loop_new: symbol!("pw_thread_loop_new", unsafe extern "C" fn(*const c_char, *const Dict) -> P),
                loop_get: symbol!("pw_thread_loop_get_loop", unsafe extern "C" fn(P) -> P),
                loop_start: symbol!("pw_thread_loop_start", unsafe extern "C" fn(P) -> c_int),
                loop_stop: symbol!("pw_thread_loop_stop", unsafe extern "C" fn(P)),
                loop_destroy: symbol!("pw_thread_loop_destroy", unsafe extern "C" fn(P)),
                lock: symbol!("pw_thread_loop_lock", unsafe extern "C" fn(P)),
                unlock: symbol!("pw_thread_loop_unlock", unsafe extern "C" fn(P)),
                context_new: symbol!("pw_context_new", unsafe extern "C" fn(P, P, usize) -> P),
                context_destroy: symbol!("pw_context_destroy", unsafe extern "C" fn(P)),
                connect: symbol!("pw_context_connect_fd", unsafe extern "C" fn(P, c_int, P, usize) -> P),
                disconnect: symbol!("pw_core_disconnect", unsafe extern "C" fn(P) -> c_int),
            };
            (a.init)(null_mut(), null_mut());
            Some(a)
        }
    }).as_ref()
}
#[derive(Default)]
struct State { cookie: Option<u32>, seq: c_int, done: bool, failed: bool, objects: Vec<Value>, events: usize }
unsafe extern "C" fn info(data: P, info: *const CoreInfo) {
    // SAFETY: library callbacks run under the thread-loop lock; storage and
    // listener tables outlive the core and loop thread. Only read ABI prefixes.
    unsafe { if !info.is_null() { (*(data as *mut State)).cookie = Some((*info).cookie); } }
}
unsafe extern "C" fn done(data: P, id: u32, seq: c_int) {
    unsafe { let s = &mut *(data as *mut State); if id == 0 && seq == s.seq { s.done = true; } }
}
unsafe extern "C" fn error(data: P, _: u32, _: c_int, _: c_int, _: *const c_char) {
    unsafe { (*(data as *mut State)).failed = true; } // Never serialize server error text.
}
unsafe fn text<'a>(p: *const c_char) -> Option<&'a str> {
    if p.is_null() { None } else { unsafe { CStr::from_ptr(p).to_str().ok() } }
}
unsafe fn number(props: *const Dict, key: &str) -> Option<String> {
    if props.is_null() { return None; }
    unsafe {
        if (*props).len > 4096 || ((*props).len != 0 && (*props).items.is_null()) { return None; }
        for i in 0..(*props).len as usize {
            let item = &*(*props).items.add(i);
            if text(item.key) == Some(key) {
                return text(item.value)?.parse::<u64>().ok().map(|n| n.to_string());
            }
        }
    }
    None
}
unsafe extern "C" fn global(data: P, id: u32, permissions: u32, kind: *const c_char, _: u32, props: *const Dict) {
    unsafe {
        let s = &mut *(data as *mut State);
        s.events += 1;
        if s.events > 4096 { s.failed = true; return; }
        let Some(kind @ ("PipeWire:Interface:Node" | "PipeWire:Interface:Client")) = text(kind) else { return; };
        if s.objects.len() >= 512 { s.failed = true; return; }
        s.objects.retain(|o| o["id"] != id.to_string());
        s.objects.push(json!({"type": kind, "id": id.to_string(), "permissions": permissions,
            "serial": number(props, "object.serial"), "client_id": number(props, "client.id")}));
    }
}
unsafe extern "C" fn removed(data: P, id: u32) {
    unsafe { (*(data as *mut State)).objects.retain(|o| o["id"] != id.to_string()); }
}
static CORE: CoreEvents = CoreEvents { version: 0, info: Some(info), done: Some(done), ping: None, error: Some(error), tail: [None; 4] };
static REGISTRY: RegistryEvents = RegistryEvents { version: 0, global: Some(global), removed: Some(removed) };

fn socket_cookie(fd: c_int) -> Option<u64> {
    let mut cookie = 0u64;
    let mut len = std::mem::size_of_val(&cookie) as libc::socklen_t;
    // SAFETY: writable initialized storage matches the advertised size.
    (unsafe { libc::getsockopt(fd, libc::SOL_SOCKET, libc::SO_COOKIE,
        (&mut cookie as *mut u64).cast(), &mut len) } == 0
        && len as usize == std::mem::size_of_val(&cookie)).then_some(cookie)
}

/// Consumes ONLY a newly opened observer connection. The caller must never pass
/// a clone of the recording connection. Teardown finishes before this returns.
/// A successful sync proves a registry snapshot, NOT unrestricted visibility.
pub(super) fn probe(fd: OwnedFd, nodes: &[u32]) -> Value {
    let unknown = || json!({"status": "UNKNOWN", "observer_released": true});
    let Some(a) = api() else { return unknown(); };
    // SAFETY: all native objects are private to this call and accessed under
    // their loop lock. Teardown disconnects/destroys them before stack listeners
    // and State are dropped. No callback unwinds, reads media, or stores C data.
    unsafe {
        let loop_ = (a.loop_new)(c"apparent-graph-probe".as_ptr(), null());
        if loop_.is_null() { return unknown(); }
        let context = (a.context_new)((a.loop_get)(loop_), null_mut(), 0);
        if context.is_null() { (a.loop_destroy)(loop_); return unknown(); }
        let raw = fd.as_raw_fd();
        let cookie = socket_cookie(raw);
        // core.h transfers ownership. PipeWire 1.0.5 core_new's early error
        // precedes the protocol handoff and can leave the descriptor open.
        let core = (a.connect)(context, fd.into_raw_fd(), null_mut(), 0);
        if core.is_null() {
            (a.context_destroy)(context);
            (a.loop_destroy)(loop_);
            // No loop thread was started. Close only if this exact fresh
            // socket still occupies the number; never close a reused number.
            if cookie.is_some() && socket_cookie(raw) == cookie { libc::close(raw); }
            return unknown();
        }
        let mut state = State::default();
        let mut ch: Hook = std::mem::zeroed();
        let mut rh: Hook = std::mem::zeroed();
        let ci = &*(core as *const Interface);
        let cm = &*(ci.cb.funcs as *const CoreMethods);
        let data = (&mut state as *mut State).cast();
        (cm.add)(ci.cb.data, &mut ch, &CORE, data);
        let registry = (cm.registry)(ci.cb.data, 3, 0);
        if !registry.is_null() {
            let ri = &*(registry as *const Interface);
            let rm = &*(ri.cb.funcs as *const RegistryMethods);
            (rm.add)(ri.cb.data, &mut rh, &REGISTRY, data);
            state.seq = (cm.sync)(ci.cb.data, 0, 0);
        } else { state.failed = true; }
        let started = (a.loop_start)(loop_) >= 0;
        if started {
            let until = Instant::now() + Duration::from_millis(300);
            loop {
                (a.lock)(loop_);
                let finished = state.done || state.failed;
                (a.unlock)(loop_);
                if finished || Instant::now() >= until { break; }
                std::thread::sleep(Duration::from_millis(5));
            }
            // Stop without holding lock. All callbacks have returned afterward.
            (a.loop_stop)(loop_);
        }
        (a.disconnect)(core);
        (a.context_destroy)(context);
        (a.loop_destroy)(loop_);
        if !started || state.failed || !state.done || state.cookie.is_none() { return unknown(); }
        let selected: Vec<_> = nodes.iter().map(|node| {
            let source = state.objects.iter().find(|o| o["type"] == "PipeWire:Interface:Node" && o["id"] == node.to_string());
            let client = source.and_then(|n| state.objects.iter().find(|c| c["type"] == "PipeWire:Interface:Client" && c["id"] == n["client_id"]));
            json!({"node": node, "serial": source.and_then(|n| n["serial"].as_str()),
                "client_id": source.and_then(|n| n["client_id"].as_str()),
                "client_serial": client.and_then(|c| c["serial"].as_str())})
        }).collect();
        json!({"status": "OBSERVED", "server_cookie": state.cookie.unwrap().to_string(),
            "selected": selected, "observer_released": true, "visibility": "permission_scoped"})
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test]
    #[ignore = "child fixture: isolated synthetic PipeWire server only"]
    fn private_server_probe_fixture() {
        use std::os::unix::net::UnixStream;
        let path = std::env::var("APPARENT_TEST_GRAPH_SOCKET").unwrap();
        let root = std::env::var("TMPDIR").unwrap();
        assert!(std::path::Path::new(&path).starts_with(root));
        let node: u32 = std::env::var("APPARENT_TEST_GRAPH_NODE").unwrap().parse().unwrap();
        let result = probe(UnixStream::connect(path).unwrap().into(), &[node]);
        println!("GRAPH-PROBE {result}");
        assert_eq!(result["status"], "OBSERVED");
        assert_eq!(result["observer_released"], true);
        assert!(result["server_cookie"].is_string());
        for key in ["serial", "client_id", "client_serial"] {
            assert!(result["selected"][0][key].is_string(), "{key}: {result}");
        }
    }
    #[test]
    fn fresh_non_protocol_socket_is_bounded_and_closed() {
        use std::os::unix::net::UnixStream;
        use std::io::Read;
        let (a, mut peer) = UnixStream::pair().unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let start = Instant::now();
        let result = probe(a.into(), &[42]);
        assert_eq!(result["status"], "UNKNOWN");
        assert_eq!(result["observer_released"], true);
        assert!(start.elapsed() < Duration::from_secs(2));
        // Read the client's hello bytes until EOF: peer proves actual release,
        // not merely the adapter's teardown log.
        let mut bytes = Vec::new();
        peer.read_to_end(&mut bytes).unwrap();
    }
}
