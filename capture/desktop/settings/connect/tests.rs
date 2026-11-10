use super::*;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
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

fn policy_receipt(events: &mpsc::Receiver<Event>) -> Event {
    let event = recv(events);
    assert!(
        event.policy.is_some(),
        "expected async TypeScript policy receipt"
    );
    event
}

fn policy_failure(generation: u64, action: PolicyAction) -> Event {
    Event {
        request: Arc::new(Request {
            active: AtomicBool::new(true),
            operation: Operation::Policy,
            server: String::new(),
        }),
        outcome: Outcome::Policy,
        policy: Some(PolicyEvent {
            generation,
            action,
            result: Err(SafeError::Unavailable),
        }),
    }
}

fn disconnected(server: Option<&str>) -> Snapshot {
    Snapshot {
        server: server.map(str::to_owned),
        connected: false,
        uploads_enabled: false,
        reauthorization_required: false,
        account_initial: None,
    }
}

fn connected() -> Snapshot {
    Snapshot {
        server: Some(DEFAULT_SERVER.into()),
        connected: true,
        uploads_enabled: true,
        reauthorization_required: false,
        account_initial: None,
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

fn policy(controller: &mut Controller, events: &mpsc::Receiver<Event>, command: Command) {
    controller.command(command);
    let event = policy_receipt(events);
    assert!(!controller.receive(event));
}

fn start(
    controller: &mut Controller,
    events: &mpsc::Receiver<Event>,
    logins: &mpsc::Receiver<LoginCall>,
) -> LoginCall {
    policy(controller, events, Command::Connect);
    policy(controller, events, Command::Allow);
    recv(logins)
}

fn confirm(controller: &mut Controller, events: &mpsc::Receiver<Event>, command: Command) {
    let request = match command {
        Command::Disable => Command::RequestDisable,
        Command::Disconnect => Command::RequestDisconnect,
        _ => panic!("expected a destructive action"),
    };
    policy(controller, events, request);
    assert_eq!(
        controller.policy_state.confirmation,
        Some(if command == Command::Disable {
            PolicyConfirmation::Disable
        } else {
            PolicyConfirmation::Disconnect
        })
    );
    controller.command(command);
    assert!(controller.disabling());
}

#[test]
fn consent_precedes_network_and_preserves_custom_server() {
    let (mut c, backend, events, logins, probes, disables) = fixture();
    *backend.local.lock().unwrap() = Ok(disconnected(Some("https://custom.example")));
    c.refresh();
    policy(&mut c, &events, Command::Allow); // A forged renderer action cannot skip the explanation.
    policy(&mut c, &events, Command::Connect);
    assert!(logins.try_recv().is_err());
    assert!(probes.try_recv().is_err());
    assert!(
        c.view()
            .buttons
            .iter()
            .any(|b| b.command == Command::Allow && b.enabled)
    );
    policy(&mut c, &events, Command::Allow);
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
    assert_eq!(c.view().status, "Not connected");
}

#[test]
fn pending_allow_cancel_invalidates_the_admitted_generation_and_late_receipt() {
    let (mut c, _backend, events, logins, _, _) = fixture();
    policy(&mut c, &events, Command::Connect);
    c.command(Command::Allow);
    let allow = policy_receipt(&events);
    assert_eq!(allow.policy.as_ref().unwrap().action, PolicyAction::Allow);
    let pending_view = c.view();
    assert!(
        pending_view
            .buttons
            .iter()
            .any(|b| b.command == Command::Allow && !b.enabled)
    );
    assert!(
        pending_view
            .buttons
            .iter()
            .any(|b| b.command == Command::Cancel && b.enabled)
    );
    assert!(
        pending_view
            .buttons
            .iter()
            .all(|b| b.command == Command::Cancel || !b.enabled)
    );
    assert!(
        pending_view
            .presentation
            .buttons
            .iter()
            .all(|b| b.command == Command::Cancel || !b.enabled)
    );

    let generation = c.policy_generation;
    c.command(Command::Allow); // Forged duplicate admission is inert while pending.
    assert_eq!(c.policy_generation, generation);
    assert!(logins.try_recv().is_err());
    c.command(Command::Cancel);
    assert!(c.policy_generation > generation);
    assert_eq!(c.policy_action, Some(PolicyAction::Cancel));
    assert!(logins.try_recv().is_err());
    let cancel = policy_receipt(&events);
    assert_eq!(cancel.policy.as_ref().unwrap().action, PolicyAction::Cancel);
    assert!(!c.receive(cancel));
    assert!(!c.receive(allow));
    assert!(!c.policy_state.consent);
    assert!(c.policy_overlay.is_none());
    assert!(logins.try_recv().is_err());
}

#[test]
fn pending_connect_close_reopen_ignores_the_old_policy_receipt() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    c.command(Command::Connect);
    let late = policy_receipt(&events);
    assert_eq!(late.policy.as_ref().unwrap().action, PolicyAction::Connect);
    c.close();
    let (reopened_sender, reopened_events) = mpsc::channel();
    let mut reopened = Controller::new(
        backend,
        Arc::new(move |event| reopened_sender.send(event).unwrap()),
    );
    assert!(!reopened.receive(late.clone()));
    assert!(!c.receive(late));
    assert!(!reopened.policy_state.consent);
    assert!(logins.try_recv().is_err());
    assert!(disables.try_recv().is_err());
    assert!(reopened_events.try_recv().is_err());
}

#[test]
fn policy_worker_failure_clears_consent_and_keeps_durable_retry_without_fallback() {
    let (mut c, _backend, events, logins, _, disables) = fixture();
    policy(&mut c, &events, Command::Connect);
    assert!(c.policy_state.consent);
    c.command(Command::Allow);
    let late_allow = policy_receipt(&events);
    let generation = late_allow.policy.as_ref().unwrap().generation;
    assert!(!c.receive(policy_failure(generation, PolicyAction::Allow)));
    assert!(c.policy_state == PolicyState::default());
    assert!(c.policy_overlay.is_none());
    assert!(logins.try_recv().is_err());
    assert!(disables.try_recv().is_err());
    assert!(!c.receive(late_allow));
    assert!(logins.try_recv().is_err());

    let (mut c, backend, events, _, _, disables) = fixture();
    *backend.local.lock().unwrap() = Ok(connected());
    c.refresh();
    policy(&mut c, &events, Command::RequestDisable);
    let generation = c.policy_generation;
    c.command(Command::Disable);
    // Accepted revocation enters the native executor directly. A missing or
    // failed subsequent pure-policy reply cannot leave uploads enabled.
    let (logout, finish) = recv(&disables);
    assert!(!logout);
    assert!(c.disabling());
    assert!(!c.receive(policy_failure(generation, PolicyAction::Disable)));
    assert!(c.disabling());
    finish.send(Err(SafeError::LocalState)).unwrap();
    assert!(!c.receive(recv(&events)));
    assert_eq!(c.retry_disable, Some(false));
    assert!(
        c.view()
            .buttons
            .iter()
            .any(|b| b.command == Command::Disable && b.enabled)
    );
    assert!(disables.try_recv().is_err());
}

#[test]
fn confirmed_revocation_survives_close_or_drop_without_a_policy_receipt() {
    for (command, logout) in [(Command::Disable, false), (Command::Disconnect, true)] {
        for drop_window in [false, true] {
            let (mut c, backend, events, _, _, disables) = fixture();
            *backend.local.lock().unwrap() = Ok(connected());
            c.refresh();
            policy(
                &mut c,
                &events,
                if logout {
                    Command::RequestDisconnect
                } else {
                    Command::RequestDisable
                },
            );
            let generation = c.policy_generation;
            c.command(command);
            assert!(c.disabling());
            // No policy or native completion receipt has been delivered after
            // the destructive click. Closing cannot retract this durable intent.
            if drop_window {
                drop(c);
                let (actual_logout, finish) = recv(&disables);
                assert_eq!(actual_logout, logout);
                *backend.local.lock().unwrap() = Ok(disconnected(None));
                finish.send(Ok(())).unwrap();
                let completion = recv(&events);
                assert!(matches!(completion.outcome, Outcome::Disabled(Ok(()))));
            } else {
                c.close();
                c.close();
                let (actual_logout, finish) = recv(&disables);
                assert_eq!(actual_logout, logout);
                assert!(!c.receive(policy_failure(
                    generation,
                    if logout {
                        PolicyAction::Disconnect
                    } else {
                        PolicyAction::Disable
                    }
                )));
                assert!(c.disabling());
                *backend.local.lock().unwrap() = Ok(disconnected(None));
                finish.send(Ok(())).unwrap();
                assert!(!c.receive(recv(&events)));
                assert!(c.view().buttons.iter().all(|button| !button.enabled));
            }
            assert!(disables.try_recv().is_err(), "revocation must execute once");
        }
    }
}

#[test]
fn emergency_revocation_supersedes_pending_confirmation_and_raced_login_commit() {
    for (command, logout) in [(Command::Disable, false), (Command::Disconnect, true)] {
        let (mut c, backend, events, logins, _, disables) = fixture();
        let call = start(&mut c, &events, &logins);
        call.approve.send(approval()).unwrap();
        assert!(!c.receive(recv(&events)));
        c.command(Command::RequestDisconnect);
        let late_confirmation = policy_receipt(&events);
        let generation = late_confirmation.policy.as_ref().unwrap().generation;
        c.command(command);
        assert!(!(call.allowed)());
        assert!(c.disabling());
        // Native execution is admitted before a confirmation worker receipt,
        // its error, or a raced successful sign-in receipt can reach the UI.
        let (actual_logout, finish) = recv(&disables);
        assert_eq!(actual_logout, logout);
        c.close();
        *backend.local.lock().unwrap() = Ok(connected());
        call.finish.send(Ok(())).unwrap();
        assert!(!c.receive(recv(&events)));
        assert!(!c.receive(late_confirmation));
        assert!(!c.receive(policy_failure(generation, PolicyAction::RequestDisconnect)));
        assert!(c.disabling());
        *backend.local.lock().unwrap() = Ok(disconnected(None));
        finish.send(Ok(())).unwrap();
        assert!(!c.receive(recv(&events)));
        assert_eq!(c.view().status, "Not connected");
        assert!(disables.try_recv().is_err());
        assert!(logins.try_recv().is_err());
    }
}

#[test]
fn late_a_and_duplicate_completion_cannot_replace_or_authorize_b() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    let a = start(&mut c, &events, &logins);
    a.approve.send(approval()).unwrap();
    let late_approval = recv(&events);
    c.command(Command::Cancel);
    let (_, finish) = recv(&disables);
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    let b = start(&mut c, &events, &logins);
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
    assert_eq!(c.view().status, "Uploads on");
}

#[test]
fn cancelled_b_cannot_authorize_worker_even_after_backend_success() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    let b = start(&mut c, &events, &logins);
    b.approve.send(approval()).unwrap();
    c.receive(recv(&events));
    c.close();
    *backend.local.lock().unwrap() = Ok(connected());
    b.finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert!(!(b.allowed)());
    assert_eq!(c.command(Command::OpenBrowser), None);
    assert!(c.view().verification_uri.is_none());
    let (logout, finish) = recv(&disables);
    assert!(!logout);
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert_eq!(c.view().status, "Not connected");
}

#[test]
fn login_requires_authoritative_enabled_state_not_transport_success() {
    for local in [
        Err(SafeError::LocalState),
        Ok(disconnected(None)),
        Ok(Snapshot {
            server: Some(DEFAULT_SERVER.into()),
            connected: true,
            uploads_enabled: false,
            reauthorization_required: false,
            account_initial: None,
        }),
        Ok(Snapshot {
            server: Some("https://other.example".into()),
            connected: true,
            uploads_enabled: true,
            reauthorization_required: false,
            account_initial: None,
        }),
    ] {
        let (mut c, backend, events, logins, _, _) = fixture();
        let call = start(&mut c, &events, &logins);
        call.approve.send(approval()).unwrap();
        c.receive(recv(&events));
        *backend.local.lock().unwrap() = local;
        call.finish.send(Ok(())).unwrap();
        assert!(!c.receive(recv(&events)));
        assert_ne!(c.view().status, "Uploads on");
        assert!(c.view().verification_uri.is_none());
    }
}

#[test]
fn disable_cancels_login_and_blocks_reenable_until_durable_result_even_on_close() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    let call = start(&mut c, &events, &logins);
    call.approve.send(approval()).unwrap();
    c.receive(recv(&events));
    confirm(&mut c, &events, Command::Disconnect);
    assert!(!(call.allowed)());
    let (logout, finish) = recv(&disables);
    assert!(logout);
    c.command(Command::Connect);
    c.command(Command::Allow);
    c.command(Command::Cancel);
    assert!(logins.try_recv().is_err());
    assert_eq!(c.view().status, "Disconnecting…");
    c.close();
    call.finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert_eq!(c.view().status, "Not connected");
}

#[test]
fn emergency_disable_during_login_enters_native_executor_before_any_policy_receipt() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    let call = start(&mut c, &events, &logins);
    call.approve.send(approval()).unwrap();
    assert!(!c.receive(recv(&events)));
    let request = c.request.as_ref().unwrap().clone();
    assert!(
        c.view()
            .presentation
            .buttons
            .iter()
            .any(|b| b.command == Command::Disable && b.enabled)
    );
    assert!(
        !c.view()
            .presentation
            .buttons
            .iter()
            .any(|b| b.command == Command::RequestDisable)
    );

    c.command(Command::Disable);
    assert!(!(request.allowed())());
    assert!(c.disabling());
    assert!(c.policy_state.confirmation.is_none());
    assert!(!c.policy_pending);
    assert!(events.try_recv().is_err());
    let (logout, finish) = recv(&disables);
    assert!(!logout);
    call.finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
}

#[test]
fn emergency_disconnect_during_probe_enters_native_executor_before_any_policy_receipt() {
    let (mut c, backend, events, _, probes, disables) = fixture();
    *backend.local.lock().unwrap() = Ok(connected());
    c.refresh();
    c.command(Command::Check);
    let probe = recv(&probes);
    let request = c.request.as_ref().unwrap().clone();
    assert!(
        c.view()
            .presentation
            .buttons
            .iter()
            .any(|b| b.command == Command::Disconnect && b.enabled)
    );
    assert!(
        !c.view()
            .presentation
            .buttons
            .iter()
            .any(|b| b.command == Command::RequestDisconnect)
    );

    c.command(Command::Disconnect);
    assert!(!(request.allowed())());
    assert!(c.disabling());
    assert!(c.policy_state.confirmation.is_none());
    assert!(!c.policy_pending);
    assert!(events.try_recv().is_err());
    let (logout, finish) = recv(&disables);
    assert!(logout);
    probe.send(Health::Offline).unwrap();
    assert!(!c.receive(recv(&events)));
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
}

#[test]
fn failed_disable_retains_retry_and_fresh_read_only_status_without_health_flood() {
    let (mut c, backend, events, _, probes, disables) = fixture();
    *backend.local.lock().unwrap() = Ok(connected());
    c.refresh();
    confirm(&mut c, &events, Command::Disable);
    let (_, finish) = recv(&disables);
    finish.send(Err(SafeError::LocalState)).unwrap();
    c.receive(recv(&events));
    assert!(c.view().detail.contains("could not"));
    assert!(
        c.view()
            .buttons
            .iter()
            .any(|b| b.command == Command::Disable && b.enabled)
    );
    *backend.local.lock().unwrap() = Ok(Snapshot {
        server: Some(DEFAULT_SERVER.into()),
        connected: true,
        uploads_enabled: false,
        reauthorization_required: false,
        account_initial: None,
    });
    c.refresh();
    c.refresh();
    assert!(probes.try_recv().is_err());
    assert_eq!(c.view().status, "Connected · uploads off");
    c.command(Command::Check);
    recv(&probes).send(Health::AuthRequired).unwrap();
    c.receive(recv(&events));
    assert_eq!(c.view().status, "Sign-in required");
}

#[test]
fn stale_probe_cannot_override_new_login_and_offline_does_not_revoke_consent() {
    let (mut c, backend, events, logins, probes, _) = fixture();
    c.command(Command::Check);
    let health = recv(&probes);
    c.command(Command::Cancel);
    let call = start(&mut c, &events, &logins);
    health.send(Health::Offline).unwrap();
    assert!(!c.receive(recv(&events)));
    assert_eq!(c.view().status, "Signing in…");
    call.approve.send(approval()).unwrap();
    c.receive(recv(&events));
    *backend.local.lock().unwrap() = Ok(connected());
    call.finish.send(Ok(())).unwrap();
    assert!(c.receive(recv(&events)));
    c.command(Command::Check);
    recv(&probes).send(Health::Offline).unwrap();
    assert!(!c.receive(recv(&events)));
    assert_eq!(c.view().status, "Uploads on · offline");
    assert!(backend.snapshot().unwrap().uploads_enabled);
}

#[test]
fn renderer_contract_uses_camel_case_fields_and_kebab_case_commands() {
    let (c, _, _, _, _, _) = fixture();
    let view = serde_json::to_value(c.view()).unwrap();
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
    assert_eq!(c.view().status, "Sign-in required");
    assert!(
        c.view()
            .buttons
            .iter()
            .any(|b| b.command == Command::Connect && b.enabled)
    );
    assert!(
        c.view()
            .buttons
            .iter()
            .any(|b| b.command == Command::Disconnect && b.enabled)
    );
    assert!(logins.try_recv().is_err());
    assert!(probes.try_recv().is_err());
}

#[test]
fn closing_signin_durably_disables_even_when_success_committed_before_receipt() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    let call = start(&mut c, &events, &logins);
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
    assert_eq!(c.view().status, "Not connected");
    assert!(c.view().buttons.iter().all(|button| !button.enabled));
}

#[test]
fn reopened_unsettled_revocation_can_be_retried_without_allowing_a_new_login() {
    let (mut c, backend, events, logins, _, disables) = fixture();
    *backend.local.lock().unwrap() = Err(SafeError::LocalState);
    c.refresh();
    let view = c.view();
    assert!(
        view.buttons
            .iter()
            .any(|button| button.command == Command::Disable && button.enabled)
    );
    assert!(
        view.buttons
            .iter()
            .any(|button| button.command == Command::Disconnect && button.enabled)
    );
    policy(&mut c, &events, Command::Connect);
    policy(&mut c, &events, Command::Allow);
    assert!(logins.try_recv().is_err());
    // With local state unreadable this is the existing explicit emergency retry
    // action, not a normal connected-account disable request.
    c.command(Command::Disable);
    let (logout, finish) = recv(&disables);
    assert!(!logout);
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    finish.send(Ok(())).unwrap();
    assert!(!c.receive(recv(&events)));
    assert_eq!(c.view().status, "Not connected");
}

#[test]
fn typed_presentation_never_promotes_unverified_or_unreadable_state_to_success() {
    let (mut c, backend, _events, _logins, _probes, _disables) = fixture();
    assert_eq!(
        c.view().presentation.headline,
        "Help others see what you mean."
    );
    assert_eq!(c.view().presentation.tone, Tone::Neutral);
    *backend.local.lock().unwrap() = Ok(connected());
    c.refresh();
    assert_eq!(c.view().presentation.tone, Tone::Success);
    c.health = Some(Health::Offline);
    assert_eq!(c.view().presentation.tone, Tone::Failure);
    c.health = None;
    c.error = Some(SafeError::UnverifiedCommit);
    assert_eq!(c.view().presentation.tone, Tone::Failure);
    *backend.local.lock().unwrap() = Err(SafeError::LocalState);
    c.refresh();
    let p = c.view().presentation;
    assert_eq!(p.tone, Tone::Failure);
    assert!(
        p.buttons
            .iter()
            .any(|b| b.command == Command::RequestDisconnect)
    );
}

#[test]
fn confirmation_and_consent_cancel_are_local_until_explicit_allow_or_revoke() {
    let (mut c, backend, events, logins, probes, disables) = fixture();
    *backend.local.lock().unwrap() = Ok(connected());
    c.refresh();
    policy(&mut c, &events, Command::RequestDisconnect);
    let p = c.view().presentation;
    assert_eq!(p.tone, Tone::Warning);
    assert_eq!(p.buttons[0].command, Command::Disconnect);
    assert!(disables.try_recv().is_err());
    policy(&mut c, &events, Command::Cancel);
    assert_eq!(c.view().presentation.tone, Tone::Success);
    policy(&mut c, &events, Command::Connect);
    policy(&mut c, &events, Command::Cancel);
    assert!(logins.try_recv().is_err());
    assert!(probes.try_recv().is_err());
    assert!(disables.try_recv().is_err());
    assert_eq!(c.view().presentation.tone, Tone::Success);
    policy(&mut c, &events, Command::RequestDisable);
    c.command(Command::Disable);
    let (logout, result) = recv(&disables);
    assert!(!logout);
    assert_eq!(c.view().presentation.tone, Tone::Progress);
    assert!(!c.view().presentation.buttons[0].enabled);
    result.send(Err(SafeError::LocalState)).unwrap();
    c.receive(recv(&events));
    assert_eq!(c.view().presentation.tone, Tone::Failure);
    assert!(
        c.view()
            .presentation
            .buttons
            .iter()
            .any(|b| b.command == Command::Disable)
    );
}

#[test]
fn failed_first_signin_keeps_recovery_actions_reachable() {
    let (mut c, _backend, _events, _logins, _probes, _disables) = fixture();
    for error in [SafeError::Rejected, SafeError::Expired, SafeError::Offline] {
        c.error = Some(error);
        let p = c.view().presentation;
        assert_eq!(p.tone, Tone::Failure);
        assert!(p.account_menu);
        assert!(p.menu_actions.contains(&Command::Check));
        assert!(
            p.buttons
                .iter()
                .any(|b| b.command == Command::Check && b.enabled)
        );
    }
}

#[test]
fn account_initial_tracks_fresh_identity_without_changing_actions() {
    let (mut c, backend, _events, _logins, _probes, _disables) = fixture();
    let mut snapshot = connected();
    for initial in [Some("S"), Some("M"), None] {
        snapshot.account_initial = initial.map(str::to_owned);
        *backend.local.lock().unwrap() = Ok(snapshot.clone());
        c.refresh();
        let p = c.view().presentation;
        assert_eq!(p.account_initial.as_deref(), initial);
        assert!(p.account_menu);
        assert!(p.menu_actions.contains(&Command::Check));
        assert!(p.menu_actions.contains(&Command::RequestDisconnect));
    }
    snapshot.account_initial = Some("S".into());
    *backend.local.lock().unwrap() = Ok(snapshot.clone());
    c.refresh();
    c.health = Some(Health::AuthRequired);
    assert!(c.view().presentation.account_initial.is_none());
    c.health = None;
    c.error = Some(SafeError::AuthRequired);
    assert!(c.view().presentation.account_initial.is_none());
    c.error = None;
    *backend.local.lock().unwrap() = Err(SafeError::LocalState);
    c.refresh();
    assert!(c.view().presentation.account_initial.is_none());
    snapshot.reauthorization_required = true;
    *backend.local.lock().unwrap() = Ok(snapshot);
    c.refresh();
    assert!(c.view().presentation.account_initial.is_none());
    *backend.local.lock().unwrap() = Ok(disconnected(None));
    c.refresh();
    assert!(c.view().presentation.account_initial.is_none());
}

#[test]
#[cfg(unix)]
fn policy_child_deadline_covers_spawn_and_pipes_without_waiting_for_inherited_stdout() {
    let root = std::env::temp_dir().join(format!(
        "apparent-dev-account-policy-child-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
    let runtime = root.join("hang.sh");
    std::fs::write(&runtime, "#!/bin/sh\n/bin/sleep 10 &\nwait\n").unwrap();
    std::fs::set_permissions(&runtime, std::fs::Permissions::from_mode(0o700)).unwrap();
    let started = std::time::Instant::now();
    let blocked_input = vec![b'x'; 4096];
    let result = run_policy_child(&runtime, std::path::Path::new("/dev/null"), &blocked_input);
    let elapsed = started.elapsed();
    std::fs::remove_dir_all(root).unwrap();
    assert_eq!(result.unwrap_err(), SafeError::Unavailable);
    assert!(elapsed < Duration::from_secs(2));
}

#[test]
fn old_controller_policy_reply_cannot_match_a_reopened_controller() {
    let (mut old, _, old_events, _, _, _) = fixture();
    old.command(Command::Connect);
    let old_reply = policy_receipt(&old_events);
    old.close();
    let (mut current, _, current_events, logins, _, disables) = fixture();
    // This Controller has not shown consent. Simulate the shared Session event
    // sink forwarding the old Connect reply while its forged Allow is pending.
    current.command(Command::Allow);
    assert!(current.policy_pending);
    assert!(!current.receive(old_reply));
    assert!(current.policy_pending);
    assert!(!current.policy_state.consent);
    assert!(!current.receive(policy_receipt(&current_events)));
    assert!(!current.policy_state.consent);
    assert!(logins.try_recv().is_err());
    assert!(disables.try_recv().is_err());
}
