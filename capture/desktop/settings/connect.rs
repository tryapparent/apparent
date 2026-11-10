//! Shared Connect Settings policy; native renderers only draw `View` and send `Command`.
//!
//! The parent gates construction/rendering with the default-on `connectSettings` flag.
//! An explicit false hides the controls without changing upload consent. A Session
//! owns one controller and routes emitted events back to that same controller on its UI
//! thread. Call `refresh()` on Settings Tick for fresh **local-only** state; it never
//! probes the network. `Check` alone starts a background health request. Call `close()`
//! when the window closes (Drop also cancels); create a new controller on reopen.
//!
//! `receive()` authorizes the parent's existing upload worker exactly once, only for
//! the current login after an authoritative local read verifies the committed state.
//! It does not upload, scan old captures, create shares, write config, or open browsers.
//! `command(OpenBrowser)` returns a URI only while its owning login is current. The
//! Session must open it synchronously as that user action, not queue it for later.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use serde::{Deserialize, Serialize};

mod presentation;
pub use presentation::{Presentation, Tone};

pub const CONNECT_SETTINGS: &str = "connectSettings";
pub const DEFAULT_SERVER: &str = "https://hosted.tryapparent.com";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Command {
    Connect,
    Allow,
    Cancel,
    Check,
    Disable,
    Disconnect,
    OpenBrowser,
    RequestDisable,
    RequestDisconnect,
    OpenSharedLinks,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Button {
    pub command: Command,
    pub title: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub title: String,
    pub status: String,
    pub detail: String,
    pub server: Option<String>,
    pub verification_uri: Option<String>,
    pub user_code: Option<String>,
    pub buttons: Vec<Button>,
    pub note: String,
    #[serde(default)]
    pub presentation: Presentation,
}

/// Local, authoritative state, not cached network health. The adapter must validate
/// a configured server with the existing client's validator; invalid configuration
/// is an error, never `None`. `None` means no server was configured. `connected`
/// includes a usable read-only grant. `uploads_enabled` requires *all* current upload
/// gates plus a usable upload grant for this server, not just cloud.enabled.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub server: Option<String>,
    pub connected: bool,
    pub uploads_enabled: bool,
    pub reauthorization_required: bool,
    pub account_initial: Option<String>,
}

/// Only public device-flow presentation data. The adapter must use the client's
/// existing verification-URI validation (HTTPS, or test loopback HTTP), reject embedded
/// credentials/device secrets and control characters, and supply only the public code.
/// Never pass a deviceCode, access token, raw response or error into this module.
#[derive(Clone)]
pub struct Approval {
    pub verification_uri: String,
    pub user_code: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Health {
    Online,
    Offline,
    AuthRequired,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PolicyAction {
    Connect,
    Allow,
    Cancel,
    RequestDisable,
    RequestDisconnect,
    Disable,
    Disconnect,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PolicyConfirmation {
    Disable,
    Disconnect,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyState {
    consent: bool,
    confirmation: Option<PolicyConfirmation>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyContext {
    action: PolicyAction,
    snapshot_available: bool,
    busy: bool,
    retry_disable: Option<bool>,
    emergency: bool,
    closed: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PolicyEffect {
    Allow,
    Disable,
    Disconnect,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyOverlay {
    mode: Option<String>,
    title: String,
    status: String,
    detail: String,
    note: String,
    buttons: Vec<Button>,
    presentation: Option<Presentation>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyResult {
    state: PolicyState,
    effect: Option<PolicyEffect>,
    overlay: PolicyOverlay,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyEnvelope {
    state: PolicyState,
    context: PolicyContext,
}

/// Closed error vocabulary prevents raw protocol responses/credentials reaching UI.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SafeError {
    Cancelled,
    Offline,
    AuthRequired,
    Rejected,
    Expired,
    LocalState,
    InvalidServer,
    UnverifiedCommit,
    Unavailable,
}

impl SafeError {
    fn message(self) -> &'static str {
        match self {
            Self::Cancelled => {
                "Cancelled. Check the current local upload settings before reconnecting."
            }
            Self::Offline => "Could not reach Connect. Check your connection and try again.",
            Self::AuthRequired => "Sign in again to authorize this device.",
            Self::Rejected => "Sign-in was not approved. You can try again.",
            Self::Expired => "The sign-in code expired. Connect again for a new code.",
            Self::LocalState => {
                "Apparent could not read or save Connect state. Check local storage and try again."
            }
            Self::InvalidServer => {
                "The configured Connect server is invalid. Correct it before connecting."
            }
            Self::UnverifiedCommit => {
                "Sign-in finished, but Apparent could not verify uploads are enabled for this server. Check local state before trying again."
            }
            Self::Unavailable => "Connect is unavailable. Try again.",
        }
    }
}

/// Adapter over the sole owned Connect client; no protocol or config implementation here.
///
/// `snapshot` must be local-only and fresh. `login` is upload login after explicit
/// consent; it MUST NOT print device data or open a browser. It must check `allowed`
/// during transport AND under the existing queue lock immediately before publishing
/// credentials/consent. `disable` uses the same queue -> config transaction to revoke
/// gates and durably cancel jobs; logout additionally removes credentials. Neither
/// operation may revive old jobs. Those client guarantees apply across controllers,
/// CLI processes and a close/reopen while a durable disable finishes. The controller's
/// UI guard cannot replace that transaction. All calls must have bounded waits.
pub trait Backend: Send + Sync + 'static {
    fn snapshot(&self) -> Result<Snapshot, SafeError>;
    fn shared_links_url(&self) -> Option<String> {
        None
    }
    fn login(
        &self,
        server: &str,
        allowed: Arc<dyn Fn() -> bool + Send + Sync>,
        on_approval: &dyn Fn(Approval),
    ) -> Result<(), SafeError>;
    fn health(&self, allowed: Arc<dyn Fn() -> bool + Send + Sync>) -> Health;
    fn disable(&self, logout: bool) -> Result<(), SafeError>;
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Operation {
    Login,
    Probe,
    Disable { logout: bool },
    Policy,
}

struct Request {
    active: AtomicBool,
    operation: Operation,
    server: String,
}

impl Request {
    fn allowed(self: &Arc<Self>) -> Arc<dyn Fn() -> bool + Send + Sync> {
        let request = self.clone();
        Arc::new(move || request.active.load(Ordering::SeqCst))
    }
}

/// Opaque, cloneable UI-thread receipt. Do not log it or route to another Session.
#[derive(Clone)]
pub struct Event {
    request: Arc<Request>,
    outcome: Outcome,
    policy: Option<PolicyEvent>,
}

#[derive(Clone)]
struct PolicyEvent {
    generation: u64,
    action: PolicyAction,
    result: Result<PolicyResult, SafeError>,
}

impl std::fmt::Debug for Event {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConnectEvent")
    }
}

#[derive(Clone)]
enum Outcome {
    Approval(Approval),
    Login(Result<(), SafeError>),
    Health(Health),
    Disabled(Result<(), SafeError>),
    Policy,
}

pub struct Controller {
    backend: Arc<dyn Backend>,
    emit: Arc<dyn Fn(Event) + Send + Sync>,
    snapshot: Option<Snapshot>,
    local_error: Option<SafeError>,
    error: Option<SafeError>,
    health: Option<Health>,
    policy_state: PolicyState,
    policy_overlay: Option<PolicyOverlay>,
    policy_generation: u64,
    policy_pending: bool,
    policy_action: Option<PolicyAction>,
    approval: Option<Approval>,
    request: Option<Arc<Request>>,
    closed: bool,
    // A failed durable cancellation must remain actionable even if snapshot fails.
    retry_disable: Option<bool>,
}

impl Controller {
    pub fn new(backend: Arc<dyn Backend>, emit: Arc<dyn Fn(Event) + Send + Sync>) -> Self {
        let mut controller = Self {
            backend,
            emit,
            snapshot: None,
            local_error: None,
            error: None,
            health: None,
            policy_state: PolicyState::default(),
            policy_overlay: None,
            policy_generation: 0,
            policy_pending: false,
            policy_action: None,
            approval: None,
            request: None,
            closed: false,
            retry_disable: None,
        };
        controller.refresh();
        controller
    }

    /// Safe for each Settings Tick: reads local state only, never starts a worker.
    /// Errors discard the old snapshot rather than presenting cached success.
    pub fn refresh(&mut self) {
        match self.backend.snapshot() {
            Ok(snapshot) => {
                if self.snapshot.as_ref() != Some(&snapshot) {
                    self.health = None;
                }
                self.snapshot = Some(snapshot);
                self.local_error = None;
            }
            Err(error) => {
                self.snapshot = None;
                self.local_error = Some(error);
                self.health = None;
            }
        }
    }

    fn cancel_request(&mut self) {
        if let Some(request) = self.request.take() {
            request.active.store(false, Ordering::SeqCst);
        }
        self.approval = None;
    }

    /// Closing cancels ephemeral login/probes but cannot interrupt durable revocation.
    /// Continue routing its receipt if Session survives close; Drop does not stop the
    /// detached disable worker, and the next Session reads its durable result locally.
    pub fn close(&mut self) {
        if self
            .request
            .as_ref()
            .is_some_and(|r| r.operation == Operation::Login)
        {
            // A click can race a committed login whose UI receipt has not arrived.
            // Serialize cancellation through the same durable client transaction.
            self.cancel_request();
            self.start(Operation::Disable { logout: false }, String::new());
        }
        self.closed = true;
        self.approval = None;
        self.policy_generation = self.policy_generation.wrapping_add(1);
        self.policy_pending = false;
        self.policy_action = None;
        self.policy_state = PolicyState::default();
        self.policy_overlay = None;
        if !self.disabling() {
            self.cancel_request();
        }
    }

    fn disabling(&self) -> bool {
        self.request
            .as_ref()
            .is_some_and(|r| matches!(r.operation, Operation::Disable { .. }))
    }

    fn invalidate_policy(&mut self) {
        self.policy_generation = self.policy_generation.wrapping_add(1);
        self.policy_pending = false;
        self.policy_action = None;
    }

    fn emergency_operation(&self) -> bool {
        self.request
            .as_ref()
            .is_some_and(|request| matches!(request.operation, Operation::Login | Operation::Probe))
    }

    fn start(&mut self, operation: Operation, server: String) {
        self.cancel_request();
        self.error = None;
        self.health = None;
        let request = Arc::new(Request {
            active: AtomicBool::new(true),
            operation,
            server,
        });
        self.request = Some(request.clone());
        let backend = self.backend.clone();
        let emit = self.emit.clone();
        std::thread::spawn(move || {
            let outcome = match operation {
                Operation::Login => {
                    let approval_request = request.clone();
                    let approval_emit = emit.clone();
                    let result =
                        backend.login(&request.server, request.allowed(), &move |approval| {
                            if approval_request.active.load(Ordering::SeqCst) {
                                approval_emit(Event {
                                    request: approval_request.clone(),
                                    outcome: Outcome::Approval(approval),
                                    policy: None,
                                });
                            }
                        });
                    Outcome::Login(result)
                }
                Operation::Probe => Outcome::Health(backend.health(request.allowed())),
                Operation::Disable { logout } => Outcome::Disabled(backend.disable(logout)),
                Operation::Policy => Outcome::Policy,
            };
            emit(Event {
                request,
                outcome,
                policy: None,
            });
        });
    }

    fn policy(&mut self, action: PolicyAction, emergency: bool) {
        if self.closed || self.policy_pending || self.disabling() {
            return;
        }
        if matches!(action, PolicyAction::Connect | PolicyAction::Allow) && self.request.is_some() {
            return;
        }
        if action == PolicyAction::Connect || action == PolicyAction::Allow {
            self.refresh();
        }
        self.policy_generation = self.policy_generation.wrapping_add(1);
        let generation = self.policy_generation;
        self.policy_pending = true;
        self.policy_action = Some(action);
        let snapshot_available = self.snapshot.is_some();
        let input = PolicyEnvelope {
            state: self.policy_state.clone(),
            context: PolicyContext {
                action,
                snapshot_available,
                busy: self.disabling(),
                retry_disable: self.retry_disable,
                emergency,
                closed: self.closed,
            },
        };
        let emit = self.emit.clone();
        std::thread::spawn(move || {
            let result = run_policy_worker(input);
            let request = Arc::new(Request {
                active: AtomicBool::new(true),
                operation: Operation::Policy,
                server: String::new(),
            });
            emit(Event {
                request,
                outcome: Outcome::Policy,
                policy: Some(PolicyEvent {
                    generation,
                    action,
                    result,
                }),
            });
        });
    }

    /// Returns a safe browser URI only for this immediate, explicit user action.
    /// Busy controls reject forged/duplicate renderer commands, not just button clicks.
    pub fn command(&mut self, command: Command) -> Option<String> {
        if self.closed || self.disabling() {
            return None;
        }
        if self.policy_pending {
            if command == Command::Cancel {
                if self
                    .request
                    .as_ref()
                    .is_some_and(|request| request.operation == Operation::Login)
                {
                    // Cancel sign-in is an existing durable revoke, even while a
                    // confirmation transition is still in flight.
                    self.invalidate_policy();
                    self.cancel_request();
                    self.retry_disable = Some(false);
                    self.start(Operation::Disable { logout: false }, String::new());
                    return None;
                }
                if self
                    .request
                    .as_ref()
                    .is_some_and(|request| request.operation == Operation::Probe)
                {
                    self.invalidate_policy();
                    self.cancel_request();
                    self.error = Some(SafeError::Cancelled);
                    self.refresh();
                    self.policy_overlay = None;
                    self.policy(PolicyAction::Cancel, false);
                    return None;
                }
                if self.policy_action.is_some_and(|action| {
                    !matches!(action, PolicyAction::Disable | PolicyAction::Disconnect)
                }) {
                    self.invalidate_policy();
                    self.policy_overlay = None;
                    self.policy(PolicyAction::Cancel, false);
                    return None;
                }
                return None;
            }
            if matches!(command, Command::Disable | Command::Disconnect)
                && self.emergency_operation()
            {
                // A direct emergency control supersedes any pending consent or
                // confirmation transition and invalidates the request first.
                let logout = command == Command::Disconnect;
                self.invalidate_policy();
                self.cancel_request();
                self.policy_overlay = None;
                self.retry_disable = Some(logout);
                self.policy(
                    if logout {
                        PolicyAction::Disconnect
                    } else {
                        PolicyAction::Disable
                    },
                    true,
                );
            }
            return None;
        }
        if command == Command::Connect {
            self.policy(PolicyAction::Connect, false);
            return None;
        }
        if command == Command::Allow {
            self.policy(PolicyAction::Allow, false);
            return None;
        }
        if command == Command::RequestDisable || command == Command::RequestDisconnect {
            self.policy(
                if command == Command::RequestDisable {
                    PolicyAction::RequestDisable
                } else {
                    PolicyAction::RequestDisconnect
                },
                false,
            );
            return None;
        }
        if command == Command::Cancel
            && self
                .policy_overlay
                .as_ref()
                .is_some_and(|o| o.mode.is_some())
        {
            self.policy_overlay = None;
            self.policy(PolicyAction::Cancel, false);
            return None;
        }
        if command == Command::Disable || command == Command::Disconnect {
            let confirmation_matches = self.policy_state.confirmation
                == Some(if command == Command::Disable {
                    PolicyConfirmation::Disable
                } else {
                    PolicyConfirmation::Disconnect
                });
            let retry_matches = self.retry_disable == Some(command == Command::Disconnect);
            let active_request = self.emergency_operation();
            let emergency = self.policy_state.confirmation.is_none()
                && (active_request || self.snapshot.is_none() && self.retry_disable.is_none());
            if confirmation_matches || retry_matches || emergency {
                if active_request {
                    self.cancel_request();
                }
                if emergency {
                    self.retry_disable = Some(command == Command::Disconnect);
                }
                self.policy(
                    if command == Command::Disable {
                        PolicyAction::Disable
                    } else {
                        PolicyAction::Disconnect
                    },
                    emergency,
                );
                return None;
            }
        }
        if command == Command::OpenSharedLinks {
            return self.backend.shared_links_url();
        }
        if command == Command::OpenBrowser {
            return self
                .request
                .as_ref()
                .filter(|r| r.operation == Operation::Login && r.active.load(Ordering::SeqCst))
                .and(self.approval.as_ref())
                .map(|a| a.verification_uri.clone());
        }
        if command == Command::Cancel {
            if self
                .request
                .as_ref()
                .is_some_and(|r| r.operation == Operation::Login)
            {
                self.cancel_request();
                self.retry_disable = Some(false);
                self.start(Operation::Disable { logout: false }, String::new());
                return None;
            }
            self.cancel_request();
            self.error = Some(SafeError::Cancelled);
            self.refresh();
            return None;
        }
        if self.request.is_some() {
            return None;
        }
        match command {
            Command::Check if !self.policy_state.consent => {
                self.refresh();
                if self.snapshot.is_some() {
                    self.start(Operation::Probe, String::new());
                }
            }
            _ => {}
        }
        None
    }

    /// True ONLY for one exact current successful login, after a fresh local snapshot
    /// proves the upload grant and consent committed for the requested server. The
    /// parent may then start its existing worker (which rechecks consent itself).
    pub fn receive(&mut self, event: Event) -> bool {
        if let Some(policy) = event.policy {
            if self.closed || !self.policy_pending || policy.generation != self.policy_generation {
                return false;
            }
            let action = policy.action;
            self.policy_pending = false;
            self.policy_action = None;
            match policy.result {
                Ok(result) => {
                    let effect = result.effect;
                    self.policy_state = result.state;
                    let overlay = result.overlay;
                    if overlay.mode.as_deref() == Some("consent") {
                        self.error = None;
                    }
                    self.policy_overlay = if overlay.mode.is_some() {
                        Some(overlay)
                    } else {
                        None
                    };
                    match effect {
                        Some(PolicyEffect::Allow) => {
                            self.refresh();
                            if let Some(snapshot) = &self.snapshot {
                                if self.retry_disable.is_none() {
                                    let server = snapshot
                                        .server
                                        .clone()
                                        .unwrap_or_else(|| DEFAULT_SERVER.into());
                                    self.start(Operation::Login, server);
                                }
                            }
                        }
                        Some(PolicyEffect::Disable) | Some(PolicyEffect::Disconnect) => {
                            self.cancel_request();
                            let logout = effect == Some(PolicyEffect::Disconnect);
                            self.retry_disable = Some(logout);
                            self.start(Operation::Disable { logout }, String::new());
                        }
                        None => {}
                    }
                }
                Err(error) => {
                    self.policy_state = PolicyState::default();
                    self.policy_overlay = None;
                    if matches!(action, PolicyAction::Disable | PolicyAction::Disconnect) {
                        self.retry_disable = Some(action == PolicyAction::Disconnect);
                    }
                    self.error = Some(error);
                }
            }
            return false;
        }
        let current = self.request.as_ref().is_some_and(|current| {
            Arc::ptr_eq(current, &event.request) && current.active.load(Ordering::SeqCst)
        });
        if !current || (self.closed && !self.disabling()) {
            return false;
        }
        if let Outcome::Approval(approval) = event.outcome {
            if event.request.operation == Operation::Login && !self.closed {
                self.approval = Some(approval);
            }
            return false;
        }
        // Terminal receipts retire ONLY their own request; duplicate delivery is inert.
        self.cancel_request();
        self.refresh();
        match event.outcome {
            Outcome::Login(result) => match result {
                Ok(()) => {
                    let verified = self.snapshot.as_ref().is_some_and(|snapshot| {
                        snapshot.connected
                            && snapshot.uploads_enabled
                            && snapshot.server.as_deref().unwrap_or(DEFAULT_SERVER)
                                == event.request.server
                    });
                    if verified && self.local_error.is_none() {
                        self.error = None;
                        return true;
                    }
                    self.error = Some(SafeError::UnverifiedCommit);
                }
                Err(error) => self.error = Some(error),
            },
            Outcome::Health(health) => self.health = Some(health),
            Outcome::Disabled(result) => match result {
                Ok(()) => {
                    self.retry_disable = None;
                    self.error = None;
                }
                Err(error) => self.error = Some(error),
            },
            Outcome::Approval(_) | Outcome::Policy => unreachable!(),
        }
        false
    }

    pub fn view(&self) -> View {
        let mut view = View {
            title: "Apparent Connect".into(),
            status: "Not connected".into(),
            detail: "Sign in to send new captures to your Connect account.".into(),
            server: self.snapshot.as_ref().map(|s| s.server.clone().unwrap_or_else(|| DEFAULT_SERVER.into())),
            verification_uri: None,
            user_code: None,
            buttons: Vec::new(),
            presentation: Presentation::default(),
            note: "Existing captures are not uploaded. No public links are created. Disabling cancels unfinished uploads; disconnecting also signs out this computer. Already uploaded data is not deleted.".into(),
        };
        if let Some(snapshot) = &self.snapshot {
            if snapshot.reauthorization_required {
                view.status = "Sign-in required".into();
                view.detail = "Sign in again to authorize this computer for Connect. Local captures still work.".into();
            } else if snapshot.uploads_enabled {
                view.status = "Uploads on".into();
                view.detail = "New captures can upload privately to your Connect account.".into();
            } else if snapshot.connected {
                view.status = "Connected · uploads off".into();
                view.detail =
                    "This device is signed in. Uploads require your explicit permission.".into();
            }
        }
        match self.health {
            Some(Health::Offline) => {
                view.status = if self.snapshot.as_ref().is_some_and(|s| s.uploads_enabled) {
                    "Uploads on · offline"
                } else {
                    "Offline"
                }
                .into();
                view.detail = "Connect could not be reached. Local captures still work; upload consent has not changed.".into();
            }
            Some(Health::AuthRequired) => {
                view.status = "Sign-in required".into();
                view.detail =
                    "Sign in again to authorize this device. Local captures still work.".into();
            }
            Some(Health::Online) => view.detail.push_str(" Connect is reachable."),
            None => {}
        }
        if let Some(error) = self.error {
            view.detail = error.message().into();
            if error == SafeError::UnverifiedCommit {
                view.status = "Sign-in not verified".into();
            }
        }
        if let Some(error) = self.local_error {
            view.status = "Local state unavailable".into();
            view.detail = error.message().into();
        }
        if let Some(request) = &self.request {
            match request.operation {
                Operation::Login => {
                    view.status = "Signing in…".into();
                    view.detail =
                        "Approve upload access in your browser. You can cancel at any time.".into();
                    if let Some(approval) = &self.approval {
                        view.verification_uri = Some(approval.verification_uri.clone());
                        view.user_code = Some(approval.user_code.clone());
                        view.buttons
                            .push(button(Command::OpenBrowser, "Open browser", true));
                    }
                    view.buttons
                        .push(button(Command::Cancel, "Cancel sign-in", true));
                    view.buttons
                        .push(button(Command::Disable, "Disable uploads", true));
                    view.buttons
                        .push(button(Command::Disconnect, "Disconnect", true));
                }
                Operation::Probe => {
                    view.status = "Checking connection…".into();
                    view.buttons
                        .push(button(Command::Cancel, "Cancel check", true));
                    view.buttons
                        .push(button(Command::Disable, "Disable uploads", true));
                    view.buttons
                        .push(button(Command::Disconnect, "Disconnect", true));
                }
                Operation::Disable { logout } => {
                    view.status = if logout {
                        "Disconnecting…"
                    } else {
                        "Disabling uploads…"
                    }
                    .into();
                    view.detail = "Saving your choice and cancelling unfinished uploads. Wait for confirmation before reconnecting.".into();
                    view.buttons.push(button(
                        if logout {
                            Command::Disconnect
                        } else {
                            Command::Disable
                        },
                        "Please wait…",
                        false,
                    ));
                }
                Operation::Policy => {}
            }
        } else {
            let uploads = self.snapshot.as_ref().is_some_and(|s| s.uploads_enabled);
            let connected = self.snapshot.as_ref().is_some_and(|s| s.connected);
            let reauthorize = self
                .snapshot
                .as_ref()
                .is_some_and(|s| s.reauthorization_required)
                || self.health == Some(Health::AuthRequired);
            if !uploads || reauthorize {
                view.buttons.push(button(
                    Command::Connect,
                    if reauthorize {
                        "Sign in again…"
                    } else if connected {
                        "Enable uploads…"
                    } else {
                        "Sign in to Connect…"
                    },
                    self.snapshot.is_some() && self.retry_disable.is_none(),
                ));
            }
            if connected || reauthorize || self.error.is_some() || self.local_error.is_some() {
                view.buttons.push(button(
                    Command::Check,
                    "Check connection",
                    self.snapshot.is_some(),
                ));
            }
            if uploads || self.retry_disable == Some(false) || self.local_error.is_some() {
                view.buttons.push(button(
                    Command::Disable,
                    if self.retry_disable == Some(false) {
                        "Retry disabling uploads"
                    } else {
                        "Disable uploads"
                    },
                    true,
                ));
            }
            if connected
                || reauthorize
                || self.retry_disable == Some(true)
                || self.local_error.is_some()
            {
                view.buttons.push(button(
                    Command::Disconnect,
                    if self.retry_disable == Some(true) {
                        "Retry disconnecting"
                    } else {
                        "Disconnect"
                    },
                    true,
                ));
            }
        }
        view.presentation = self.presentation(&view);
        if let Some(overlay) = &self.policy_overlay {
            if overlay.mode.as_deref() == Some("consent") {
                view.title.clone_from(&overlay.title);
                view.status.clone_from(&overlay.status);
                view.detail.clone_from(&overlay.detail);
                view.note.clone_from(&overlay.note);
                view.buttons.clone_from(&overlay.buttons);
            }
            if let Some(presentation) = &overlay.presentation {
                view.presentation.clone_from(presentation);
            }
        }
        if self.policy_pending {
            view.status = match self.policy_action {
                Some(PolicyAction::Connect | PolicyAction::Allow) => "Preparing Connect action…",
                Some(PolicyAction::RequestDisable | PolicyAction::RequestDisconnect) => {
                    "Preparing confirmation…"
                }
                _ => "Applying Connect action…",
            }
            .into();
            let can_cancel = self.policy_action.is_some_and(|action| {
                !matches!(action, PolicyAction::Disable | PolicyAction::Disconnect)
            });
            let emergency_controls = self.emergency_operation();
            let cancel = button(
                Command::Cancel,
                if self
                    .request
                    .as_ref()
                    .is_some_and(|r| r.operation == Operation::Login)
                {
                    "Cancel sign-in"
                } else {
                    "Cancel"
                },
                can_cancel,
            );
            if can_cancel && !view.buttons.iter().any(|b| b.command == Command::Cancel) {
                view.buttons.push(cancel.clone());
            }
            if can_cancel
                && !view
                    .presentation
                    .buttons
                    .iter()
                    .any(|b| b.command == Command::Cancel)
            {
                view.presentation.buttons.push(cancel);
            }
            for button in &mut view.buttons {
                button.enabled = (can_cancel && button.command == Command::Cancel)
                    || (emergency_controls
                        && matches!(button.command, Command::Disable | Command::Disconnect));
            }
            for button in &mut view.presentation.buttons {
                button.enabled = (can_cancel && button.command == Command::Cancel)
                    || (emergency_controls
                        && matches!(button.command, Command::Disable | Command::Disconnect));
            }
        }
        if self.closed {
            view.verification_uri = None;
            view.user_code = None;
            for button in &mut view.presentation.buttons {
                button.enabled = false;
            }
            for button in &mut view.buttons {
                button.enabled = false;
            }
        }
        view
    }
}

impl Drop for Controller {
    fn drop(&mut self) {
        self.close();
    }
}

fn button(command: Command, title: &str, enabled: bool) -> Button {
    Button {
        command,
        title: title.into(),
        enabled,
    }
}

/// Run only the pure Connect-owned policy worker. It receives a tiny allowlisted
/// state frame and has no network, filesystem or credential capability. This runs
/// off the Settings thread and is bounded/reaped by the adapter.
fn run_policy_worker(input: PolicyEnvelope) -> Result<PolicyResult, SafeError> {
    const MAX_INPUT: usize = 4096;
    let bytes = serde_json::to_vec(&input).map_err(|_| SafeError::Unavailable)?;
    if bytes.len() > MAX_INPUT {
        return Err(SafeError::Unavailable);
    }

    #[cfg(test)]
    let test_node = std::env::var_os("APPARENT_CONNECT_TEST_ELECTRON")
        .or_else(|| std::env::var_os("APPARENT_CONNECT_POLICY_NODE"));
    #[cfg(test)]
    let resolved = test_node.map(|node| {
        (
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("capture/desktop/ui/frontend"),
            std::path::PathBuf::from(node),
        )
    });
    #[cfg(not(test))]
    let resolved: Option<(std::path::PathBuf, std::path::PathBuf)> = None;
    let (app, runtime) = match resolved.or_else(super::presentation::assets) {
        Some(resources) => resources,
        None => return Err(SafeError::Unavailable),
    };
    let worker = app.join("electron/settings-policy.cjs");
    let worker_metadata = std::fs::symlink_metadata(&worker).map_err(|_| SafeError::Unavailable)?;
    if !worker_metadata.is_file() || worker_metadata.file_type().is_symlink() {
        return Err(SafeError::Unavailable);
    }
    run_policy_child(&runtime, &worker, &bytes)
}

#[cfg(unix)]
fn run_policy_child(
    runtime: &std::path::Path,
    worker: &std::path::Path,
    bytes: &[u8],
) -> Result<PolicyResult, SafeError> {
    use std::{
        os::{fd::AsRawFd, unix::process::CommandExt},
        process::{Command as ProcessCommand, Stdio},
        time::{Duration, Instant},
    };
    const MAX_INPUT: usize = 4096;
    const MAX_OUTPUT: usize = 16 * 1024;
    const DEADLINE: Duration = Duration::from_millis(800);
    if bytes.len() > MAX_INPUT {
        return Err(SafeError::Unavailable);
    }
    let deadline = Instant::now() + DEADLINE;
    let mut command = ProcessCommand::new(runtime);
    command
        .process_group(0)
        .env_clear()
        .env("ELECTRON_RUN_AS_NODE", "1")
        .arg(worker)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| SafeError::Unavailable)?;
    let pid = child.id() as libc::pid_t;
    let Some(stdin) = child.stdin.take() else {
        kill_policy_group(pid);
        let _ = child.wait();
        return Err(SafeError::Unavailable);
    };
    let Some(stdout) = child.stdout.take() else {
        kill_policy_group(pid);
        let _ = child.wait();
        return Err(SafeError::Unavailable);
    };
    set_nonblocking(stdin.as_raw_fd()).map_err(|_| {
        kill_policy_group(pid);
        let _ = child.wait();
        SafeError::Unavailable
    })?;
    set_nonblocking(stdout.as_raw_fd()).map_err(|_| {
        kill_policy_group(pid);
        let _ = child.wait();
        SafeError::Unavailable
    })?;
    let output_fd = stdout.as_raw_fd();
    let mut input_pipe = Some(stdin);
    let mut input_offset = 0;
    let mut output = Vec::with_capacity(MAX_OUTPUT.min(1024));
    let mut child_status = None;
    let mut output_closed = false;
    let mut failed = false;
    let mut scratch = [0u8; 1024];
    loop {
        if input_offset < bytes.len() {
            let input_fd = input_pipe.as_ref().expect("open policy input").as_raw_fd();
            let written = unsafe {
                libc::write(
                    input_fd,
                    bytes[input_offset..].as_ptr().cast(),
                    bytes.len() - input_offset,
                )
            };
            if written > 0 {
                input_offset += written as usize;
            } else if written == -1 {
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::WouldBlock
                    && error.kind() != std::io::ErrorKind::Interrupted
                {
                    failed = true;
                }
            } else {
                failed = true;
            }
            if input_offset == bytes.len() {
                drop(input_pipe.take());
            }
        }
        if !output_closed && output.len() <= MAX_OUTPUT {
            let read = unsafe { libc::read(output_fd, scratch.as_mut_ptr().cast(), scratch.len()) };
            if read > 0 {
                output.extend_from_slice(&scratch[..read as usize]);
                if output.len() > MAX_OUTPUT {
                    failed = true;
                }
            } else if read == 0 {
                output_closed = true;
            } else {
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::WouldBlock
                    && error.kind() != std::io::ErrorKind::Interrupted
                {
                    failed = true;
                }
            }
        }
        if child_status.is_none() {
            match child.try_wait() {
                Ok(status) => child_status = status,
                Err(_) => failed = true,
            }
        }
        if failed || Instant::now() >= deadline {
            break;
        }
        if child_status.is_some() && output_closed && input_offset == bytes.len() {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    drop(input_pipe);
    drop(stdout);
    let complete = !failed
        && Instant::now() < deadline
        && input_offset == bytes.len()
        && output_closed
        && child_status.is_some_and(|status| status.success())
        && output.len() <= MAX_OUTPUT;
    if !complete {
        kill_policy_group(pid);
        let _ = child.kill();
    }
    let status = child.wait().ok().or(child_status);
    if !complete || status.is_none_or(|status| !status.success()) {
        return Err(SafeError::Unavailable);
    }
    serde_json::from_slice(&output).map_err(|_| SafeError::Unavailable)
}

#[cfg(not(unix))]
fn run_policy_child(
    _runtime: &std::path::Path,
    _worker: &std::path::Path,
    _bytes: &[u8],
) -> Result<PolicyResult, SafeError> {
    Err(SafeError::Unavailable)
}

#[cfg(unix)]
fn set_nonblocking(fd: std::os::fd::RawFd) -> std::io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(unix)]
fn kill_policy_group(pid: libc::pid_t) {
    // SAFETY: each worker is placed in a fresh process group whose id is its pid.
    unsafe {
        libc::killpg(pid, libc::SIGKILL);
    }
}

#[cfg(test)]
mod tests;
