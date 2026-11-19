use super::*;
use std::sync::{Mutex, mpsc};
use std::time::Duration;

struct LoginCall {
    server: String,
    allowed: Arc<dyn Fn() -> bool + Send + Sync>,
    approve: mpsc::Sender<Approval>,
    finish: mpsc::Sender<Result<(), SafeError>>,
}

struct Fake {
    local: Mutex<Result<Snapshot, SafeError>>,
    logins: mpsc::Sender<LoginCall>,
    probes: mpsc::Sender<mpsc::Sender<Health>>,
    disables: mpsc::Sender<(bool, mpsc::Sender<Result<(), SafeError>>)>,
}

impl Backend for Fake {
    fn snapshot(&self) -> Result<Snapshot, SafeError> {
        self.local.lock().unwrap().clone()
    }

    fn login(
        &self,
        server: &str,
        allowed: Arc<dyn Fn() -> bool + Send + Sync>,
        on_approval: &dyn Fn(Approval),
    ) -> Result<(), SafeError> {
        let (approve, approvals) = mpsc::channel();
        let (finish, finished) = mpsc::channel();
        self.logins
            .send(LoginCall {
                server: server.into(),
                allowed,
                approve,
                finish,
            })
            .unwrap();
        // One controlled approval, followed by the independently controlled result.
        // Deliberately emit even after cancellation to exercise the real controller guard.
        if let Ok(approval) = approvals.recv_timeout(Duration::from_secs(5)) {
            on_approval(approval);
        }
        finished.recv_timeout(Duration::from_secs(5)).unwrap()
    }

    fn health(&self, _allowed: Arc<dyn Fn() -> bool + Send + Sync>) -> Health {
        let (send, receive) = mpsc::channel();
        self.probes.send(send).unwrap();
        receive.recv_timeout(Duration::from_secs(5)).unwrap()
    }

    fn disable(&self, logout: bool) -> Result<(), SafeError> {
        let (send, receive) = mpsc::channel();
        self.disables.send((logout, send)).unwrap();
        receive.recv_timeout(Duration::from_secs(5)).unwrap()
    }
}

fn recv<T>(rx: &mpsc::Receiver<T>) -> T {
    rx.recv_timeout(Duration::from_secs(5))
        .expect("controlled worker event")
}

fn disconnected(server: Option<&str>) -> Snapshot {
    Snapshot { reusable_upload_grant: false, encryption: true,
        server: server.map(str::to_owned),
        connected: false,
        uploads_enabled: false,
        reauthorization_required: false, renewal_due: false, account_initial: None,
    }
}

fn connected() -> Snapshot {
    Snapshot { reusable_upload_grant: false, encryption: true,
        server: Some(DEFAULT_SERVER.into()),
        connected: true,
        uploads_enabled: true,
        reauthorization_required: false, renewal_due: false, account_initial: None,
    }
}

fn fixture() -> (
    Controller,
    Arc<Fake>,
    mpsc::Receiver<Event>,
    mpsc::Receiver<LoginCall>,
    mpsc::Receiver<mpsc::Sender<Health>>,
    mpsc::Receiver<(bool, mpsc::Sender<Result<(), SafeError>>)>,
) {
    let (events, receive) = mpsc::channel();
    let (logins, login_rx) = mpsc::channel();
    let (probes, probe_rx) = mpsc::channel();
    let (disables, disable_rx) = mpsc::channel();
    let backend = Arc::new(Fake {
        local: Mutex::new(Ok(disconnected(None))),
        logins,
        probes,
        disables,
    });
    let controller = Controller::new(
        backend.clone(),
        Arc::new(move |event| {
            events.send(event).unwrap();
        }),
    );
    (controller, backend, receive, login_rx, probe_rx, disable_rx)
}

fn approval() -> Approval {
    Approval {
        verification_uri: "https://connect.example/device".into(),
        user_code: "ABCD-EFGH".into(),
    }
}

#[test]
fn native_open_checks_saved_session_once_without_enrollment() {
    for saved in [false, true] {
        let (_old, backend, _old_events, logins, probes, disables) = fixture();
        if saved {
            let mut snapshot = connected();
            snapshot.uploads_enabled = false;
            *backend.local.lock().unwrap() = Ok(snapshot);
        }
        let (send, events) = mpsc::channel();
        let mut controller = Controller::open(backend, Arc::new(move |event| { send.send(event).unwrap(); }));
        if saved {
            assert_eq!(controller.facts().activity, Activity::Check);
            recv(&probes).send(Health::Offline).unwrap();
            controller.receive(recv(&events));
            assert_eq!(controller.facts().outcome, Some(SafeError::Offline));
        }
        for _ in 0..3 { controller.refresh(); }
        assert!(probes.try_recv().is_err());
        assert!(logins.try_recv().is_err());
        assert!(disables.try_recv().is_err());
    }
}

fn start(controller: &mut Controller, logins: &mpsc::Receiver<LoginCall>) -> LoginCall {
    controller.command(Command::Connect);
    controller.command(Command::Allow);
    recv(logins)
}

#[test]
fn local_opt_out_waits_for_durable_disable_and_can_retry_a_failed_write() {
    let (mut c, backend, events, _, _, disables) = fixture();
    let mut active = disconnected(None);
    active.connected = true; active.uploads_enabled = true;
    *backend.local.lock().unwrap() = Ok(active);
    c.refresh();
    assert!(!c.facts().local_ready);
    c.command(Command::Disable);
    let (_, finish) = recv(&disables);
    assert_eq!(c.facts().activity, Activity::Disable);
    finish.send(Err(SafeError::LocalState)).unwrap();
    c.receive(recv(&events));
    assert!(!c.facts().local_ready);
    c.command(Command::Disable);
    let (_, finish) = recv(&disables);
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    finish.send(Ok(())).unwrap();
    c.receive(recv(&events));
    assert!(c.facts().local_ready);
    assert_eq!(c.facts().activity, Activity::Idle);
}

#[test]
fn confirmed_waitlist_never_claims_upload_connection() {
    let (mut c, _, events, logins, _, _) = fixture();
    let login = start(&mut c, &logins);
    login.approve.send(approval()).unwrap();
    c.receive(recv(&events));
    login.finish.send(Err(SafeError::Waitlisted)).unwrap();
    c.receive(recv(&events));
    assert_eq!(c.facts().outcome, Some(SafeError::Waitlisted));
    assert!(c.facts().local_ready);
}

#[test]
fn consent_precedes_network_and_preserves_custom_server() {
    let (mut c, backend, events, logins, probes, disables) = fixture();
    *backend.local.lock().unwrap() = Ok(disconnected(Some("https://custom.example")));
    c.refresh();
    c.command(Command::Allow); // A forged renderer action cannot skip the explanation.
    c.command(Command::Connect);
    assert!(logins.try_recv().is_err());
    assert!(probes.try_recv().is_err());
    assert_eq!(c.facts().activity, Activity::Consent);
    c.command(Command::Allow);
    let call = recv(&logins);
    assert_eq!(call.server, "https://custom.example");
    call.approve.send(approval()).unwrap();
    assert!(!c.receive(recv(&events)));
    assert_eq!(
        c.command(Command::OpenBrowser),
        Some("https://connect.example/device".into())
    );
    c.command(Command::Cancel);
    assert!(!(call.allowed)());
    assert_eq!(c.command(Command::OpenBrowser), None);
    call.finish.send(Err(SafeError::Cancelled)).unwrap();
    assert!(!c.receive(recv(&events)));
    let (logout, finish) = recv(&disables);
    assert!(!logout);
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert!(!c.facts().connected);
}

#[test]
fn late_a_and_duplicate_completion_cannot_replace_or_authorize_b() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    let a = start(&mut c, &logins);
    a.approve.send(approval()).unwrap();
    let late_approval = recv(&events);
    c.command(Command::Cancel);
    let (_, finish) = recv(&disables);
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    let b = start(&mut c, &logins);
    assert!(!c.receive(late_approval));
    a.finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert!((b.allowed)());
    b.approve.send(approval()).unwrap();
    assert!(!c.receive(recv(&events)));
    *backend.local.lock().unwrap() = Ok(connected());
    b.finish.send(Ok(())).unwrap();
    let success = recv(&events);
    assert!(c.receive(success.clone()));
    assert!(!c.receive(success));
    assert_eq!(c.command(Command::OpenBrowser), None);
    assert!(c.facts().uploads_enabled);
}

#[test]
fn cancelled_b_cannot_authorize_worker_even_after_backend_success() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    let b = start(&mut c, &logins);
    b.approve.send(approval()).unwrap();
    c.receive(recv(&events));
    c.close();
    *backend.local.lock().unwrap() = Ok(connected());
    b.finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert!(!(b.allowed)());
    assert_eq!(c.command(Command::OpenBrowser), None);
    assert!(c.facts().verification_uri.is_none());
    let (logout, finish) = recv(&disables);
    assert!(!logout);
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert!(!c.facts().connected);
}

#[test]
fn login_requires_authoritative_enabled_state_not_transport_success() {
    for local in [
        Err(SafeError::LocalState),
        Ok(disconnected(None)),
        Ok(Snapshot { reusable_upload_grant: false, encryption: true,
            server: Some(DEFAULT_SERVER.into()),
            connected: true,
            uploads_enabled: false,
            reauthorization_required: false, renewal_due: false, account_initial: None,
        }),
        Ok(Snapshot { reusable_upload_grant: false, encryption: true,
            server: Some("https://other.example".into()),
            connected: true,
            uploads_enabled: true,
            reauthorization_required: false, renewal_due: false, account_initial: None,
        }),
    ] {
        let (mut c, backend, events, logins, _, _) = fixture();
        let call = start(&mut c, &logins);
        call.approve.send(approval()).unwrap();
        c.receive(recv(&events));
        *backend.local.lock().unwrap() = local;
        call.finish.send(Ok(())).unwrap();
        assert!(!c.receive(recv(&events)));
        assert!(c.facts().local_error.is_some() || c.facts().outcome == Some(SafeError::UnverifiedCommit));
        assert!(c.facts().verification_uri.is_none());
    }
}

#[test]
fn disable_cancels_login_and_blocks_reenable_until_durable_result_even_on_close() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    let call = start(&mut c, &logins);
    call.approve.send(approval()).unwrap();
    c.receive(recv(&events));
    c.command(Command::Disconnect);
    assert!(!(call.allowed)());
    let (logout, finish) = recv(&disables);
    assert!(logout);
    c.command(Command::Connect);
    c.command(Command::Allow);
    c.command(Command::Cancel);
    assert!(logins.try_recv().is_err());
    assert_eq!(c.facts().activity, Activity::Disconnect);
    c.close();
    call.finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert!(!c.facts().connected);
}

#[test]
fn failed_disable_retains_retry_and_fresh_read_only_status_without_health_flood() {
    let (mut c, backend, events, _, probes, disables) = fixture();
    *backend.local.lock().unwrap() = Ok(connected());
    c.refresh();
    c.command(Command::Disable);
    let (_, finish) = recv(&disables);
    finish.send(Err(SafeError::LocalState)).unwrap();
    c.receive(recv(&events));
    assert_eq!(c.facts().outcome, Some(SafeError::LocalState));
    assert_eq!(c.facts().retry_disable, Some(false));
    *backend.local.lock().unwrap() = Ok(Snapshot { reusable_upload_grant: false, encryption: true,
        server: Some(DEFAULT_SERVER.into()),
        connected: true,
        uploads_enabled: false,
        reauthorization_required: false, renewal_due: false, account_initial: None,
    });
    c.refresh();
    c.refresh();
    assert!(probes.try_recv().is_err());
    assert!(c.facts().connected && !c.facts().uploads_enabled);
    c.command(Command::Check);
    recv(&probes).send(Health::AuthRequired).unwrap();
    c.receive(recv(&events));
    assert_eq!(c.facts().outcome, Some(SafeError::AuthRequired));
}

#[test]
fn stale_probe_cannot_override_new_login_and_offline_does_not_revoke_consent() {
    let (mut c, backend, events, logins, probes, _) = fixture();
    c.command(Command::Check);
    let health = recv(&probes);
    c.command(Command::Cancel);
    let call = start(&mut c, &logins);
    health.send(Health::Offline).unwrap();
    assert!(!c.receive(recv(&events)));
    assert_eq!(c.facts().activity, Activity::Starting);
    call.approve.send(approval()).unwrap();
    c.receive(recv(&events));
    *backend.local.lock().unwrap() = Ok(connected());
    call.finish.send(Ok(())).unwrap();
    assert!(c.receive(recv(&events)));
    c.command(Command::Check);
    recv(&probes).send(Health::Offline).unwrap();
    assert!(!c.receive(recv(&events)));
    assert_eq!(c.facts().outcome, Some(SafeError::Offline));
    assert!(backend.snapshot().unwrap().uploads_enabled);
}

#[test]
fn renderer_contract_uses_camel_case_fields_and_kebab_case_commands() {
    let (c, _, _, _, _, _) = fixture();
    let view = serde_json::to_value(c.facts()).unwrap();
    assert!(view.get("verificationUri").is_some());
    assert!(view.get("userCode").is_some());
    assert_eq!(
        serde_json::to_value(Command::OpenBrowser).unwrap(),
        "open-browser"
    );
    assert_eq!(
        serde_json::from_str::<Command>("\"allow\"").unwrap(),
        Command::Allow
    );
}

#[test]
fn expired_authorization_is_actionable_without_network_or_enabled_upload_claim() {
    let (mut c, backend, _, logins, probes, _) = fixture();
    let mut expired = connected();
    expired.connected = false;
    expired.uploads_enabled = false;
    expired.reauthorization_required = true;
    *backend.local.lock().unwrap() = Ok(expired);
    c.refresh();
    assert!(c.facts().reauthorization_required && !c.facts().uploads_enabled);
    assert!(logins.try_recv().is_err());
    assert!(probes.try_recv().is_err());
}

#[test]
fn closing_signin_durably_disables_even_when_success_committed_before_receipt() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    let call = start(&mut c, &logins);
    call.approve.send(approval()).unwrap();
    let event = recv(&events);
    assert_eq!(format!("{event:?}"), "ConnectEvent");
    c.receive(event);
    *backend.local.lock().unwrap() = Ok(connected());
    call.finish.send(Ok(())).unwrap();
    let success = recv(&events);
    c.close();
    assert!(!c.receive(success));
    assert!(!(call.allowed)());
    let (logout, finish) = recv(&disables);
    assert!(!logout);
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert!(!c.facts().connected);
    assert!(c.facts().closed);
}

#[test]
fn reopened_unsettled_revocation_can_be_retried_without_allowing_a_new_login() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    *backend.local.lock().unwrap() = Err(SafeError::LocalState);
    c.refresh();
    assert_eq!(c.facts().local_error, Some(SafeError::LocalState));
    c.command(Command::Connect);
    c.command(Command::Allow);
    assert!(logins.try_recv().is_err());
    c.command(Command::Disable);
    let (logout, finish) = recv(&disables);
    assert!(!logout);
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert!(!c.facts().connected);
}

#[test]
fn confirmation_and_consent_cancel_are_local_until_explicit_allow_or_revoke() {
    let (mut c, backend, events, logins, probes, disables) = fixture();
    *backend.local.lock().unwrap() = Ok(connected());
    c.refresh();
    c.command(Command::RequestDisconnect);
    assert_eq!(c.facts().activity, Activity::ConfirmDisconnect);
    assert!(disables.try_recv().is_err());
    c.command(Command::Cancel);
    assert!(c.facts().uploads_enabled);
    c.command(Command::Connect);
    c.command(Command::Cancel);
    assert!(logins.try_recv().is_err());
    assert!(probes.try_recv().is_err());
    assert!(disables.try_recv().is_err());
    c.command(Command::RequestDisable);
    c.command(Command::Disable);
    let (logout, result) = recv(&disables);
    assert!(!logout);
    assert_eq!(c.facts().activity, Activity::Disable);
    result.send(Err(SafeError::LocalState)).unwrap();
    c.receive(recv(&events));
    assert_eq!(c.facts().retry_disable, Some(false));
}

#[test]
fn failed_resume_withdraws_receipt_without_starting_browser_login() {
    let (mut controller,backend,events,logins,_,_)=fixture();
    let mut state=connected(); state.uploads_enabled=false; state.reusable_upload_grant=true;
    *backend.local.lock().unwrap()=Ok(state);
    controller.refresh();
    assert!(controller.facts().reusable_upload_grant);
    assert!(logins.try_recv().is_err());
    controller.command(Command::Connect);
    controller.command(Command::Resume);
    assert!(!controller.receive(recv(&events)));
    controller.command(Command::Connect);
    assert!(!controller.facts().reusable_upload_grant);
    assert!(logins.try_recv().is_err());
    controller.command(Command::Allow);
    let call=recv(&logins);
    assert!((call.allowed)());
    call.finish.send(Err(SafeError::Rejected)).unwrap();
    drop(call.approve);
}
