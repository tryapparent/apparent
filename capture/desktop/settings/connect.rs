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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Command {
    Connect,
    Allow,
    Resume,
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
    #[serde(default)]
    pub reusable_upload_grant: bool,
    #[serde(default)]
    pub encryption: Option<bool>,
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub local_ready: bool,
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

pub use apparent_connect_client::settings::{Approval, Health, SafeError, Snapshot, DEFAULT_SERVER};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Activity {
    Idle,
    Consent,
    Starting,
    Approval,
    Resume,
    Check,
    Disable,
    Disconnect,
    ConfirmDisable,
    ConfirmDisconnect,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountFacts {
    pub connected: bool,
    pub reauthorization_required: bool,
    pub renewal_due: bool,
    pub uploads_enabled: bool,
    pub reusable_upload_grant: bool,
    pub local_ready: bool,
    pub closed: bool,
    pub encryption: Option<bool>,
    pub retry_disable: Option<bool>,
    pub server: Option<String>,
    pub account_initial: Option<String>,
    pub verification_uri: Option<String>,
    pub user_code: Option<String>,
    pub shared_links_url: Option<String>,
    pub activity: Activity,
    pub outcome: Option<SafeError>,
    pub local_error: Option<SafeError>,
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
    fn shared_links_url(&self) -> Option<String> { None }
    fn login(
        &self,
        server: &str,
        allowed: Arc<dyn Fn() -> bool + Send + Sync>,
        on_approval: &dyn Fn(Approval),
    ) -> Result<(), SafeError>;
    fn resume(&self, _server: &str, _allowed: Arc<dyn Fn() -> bool + Send + Sync>) -> Result<(), SafeError> { Err(SafeError::AuthRequired) }
    fn health(&self, allowed: Arc<dyn Fn() -> bool + Send + Sync>) -> Health;
    fn disable(&self, logout: bool) -> Result<(), SafeError>;
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Operation {
    Login,
    Resume,
    Probe,
    Disable { logout: bool },
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
}

pub struct Controller {
    backend: Arc<dyn Backend>,
    emit: Arc<dyn Fn(Event) + Send + Sync>,
    snapshot: Option<Snapshot>,
    local_error: Option<SafeError>,
    error: Option<SafeError>,
    health: Option<Health>,
    consent: bool,
    approval: Option<Approval>,
    request: Option<Arc<Request>>,
    closed: bool,
    // A failed durable cancellation must remain actionable even if snapshot fails.
    retry_disable: Option<bool>,
    confirmation: Option<bool>,
    resume_failed: bool,
    native_facts: Option<AccountFacts>,
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
            consent: false,
            approval: None,
            request: None,
            closed: false,
            retry_disable: None,
            confirmation: None,
            resume_failed: false,
            native_facts: None,
        };
        controller.refresh();
        controller
    }

    /// Compatibility entry for the native Settings window. Electron owns its
    /// opening check in TypeScript; this path remains until that pane is replaced.
    pub fn open(backend: Arc<dyn Backend>, emit: Arc<dyn Fn(Event) + Send + Sync>) -> Self {
        let mut controller = Self::new(backend, emit);
        if controller.snapshot.as_ref().is_some_and(|snapshot| snapshot.connected) {
            controller.command(Command::Check);
        }
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
        self.consent = false;
    }

    /// Closing cancels ephemeral login/probes but cannot interrupt durable revocation.
    /// Continue routing its receipt if Session survives close; Drop does not stop the
    /// detached disable worker, and the next Session reads its durable result locally.
    pub fn close(&mut self) {
        if self
            .request
            .as_ref()
            .is_some_and(|r| matches!(r.operation, Operation::Login | Operation::Resume))
        {
            // A click can race a committed login whose UI receipt has not arrived.
            // Serialize cancellation through the same durable client transaction.
            self.cancel_request();
            self.start(Operation::Disable { logout: false }, String::new());
        }
        self.closed = true;
        self.approval = None;
        self.consent = false;
        if !self.disabling() {
            self.cancel_request();
        }
    }

    fn disabling(&self) -> bool {
        self.request
            .as_ref()
            .is_some_and(|r| matches!(r.operation, Operation::Disable { .. }))
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
                                });
                            }
                        });
                    Outcome::Login(result)
                }
                Operation::Resume => Outcome::Login(backend.resume(&request.server, request.allowed())),
                Operation::Probe => Outcome::Health(backend.health(request.allowed())),
                Operation::Disable { logout } => Outcome::Disabled(backend.disable(logout)),
            };
            emit(Event { request, outcome });
        });
    }

    /// Returns a safe browser URI only for this immediate, explicit user action.
    /// Busy controls reject forged/duplicate renderer commands, not just button clicks.
    pub fn command(&mut self, command: Command) -> Option<String> {
        if self.closed || self.disabling() {
            return None;
        }
        if matches!(command, Command::RequestDisable | Command::RequestDisconnect) {
            self.confirmation = Some(command == Command::RequestDisconnect);
            return None;
        }
        if command == Command::Cancel && self.confirmation.take().is_some() {
            return None;
        }
        if command != Command::Cancel { self.confirmation = None; }
        if command == Command::OpenSharedLinks { return self.backend.shared_links_url(); }
        if command == Command::OpenBrowser {
            return self
                .request
                .as_ref()
                .filter(|r| r.operation == Operation::Login && r.active.load(Ordering::SeqCst))
                .and(self.approval.as_ref())
                .map(|a| a.verification_uri.clone());
        }
        if matches!(command, Command::Disable | Command::Disconnect) {
            // Invalidate login/probe BEFORE calling the client's durable operation.
            self.cancel_request();
            let logout = command == Command::Disconnect;
            self.retry_disable = Some(logout);
            self.start(Operation::Disable { logout }, String::new());
            return None;
        }
        if command == Command::Cancel && self.consent {
            self.cancel_request();
            self.refresh();
            return None;
        }
        if command == Command::Cancel {
            if self
                .request
                .as_ref()
                .is_some_and(|r| matches!(r.operation, Operation::Login | Operation::Resume))
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
            Command::Connect => {
                self.refresh();
                if self.snapshot.is_some() && self.retry_disable.is_none() {
                    self.error = None;
                    self.consent = true;
                }
            }
            Command::Allow | Command::Resume if self.consent && self.retry_disable.is_none() => {
                self.refresh();
                if let Some(snapshot) = &self.snapshot {
                    let server = snapshot
                        .server
                        .clone()
                        .unwrap_or_else(|| DEFAULT_SERVER.into());
                    self.start(if command == Command::Resume { Operation::Resume } else { Operation::Login }, server);
                }
            }
            Command::Check if !self.consent => {
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
        if event.request.operation == Operation::Resume {
            self.resume_failed = !matches!(event.outcome, Outcome::Login(Ok(())));
        } else if event.request.operation == Operation::Login && matches!(event.outcome, Outcome::Login(Ok(()))) { self.resume_failed = false; }
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
            Outcome::Approval(_) => unreachable!(),
        }
        false
    }

    pub fn native_view(&mut self) -> Option<Option<View>> {
        let facts = self.facts();
        if self.native_facts.as_ref() == Some(&facts) {
            return None;
        }
        let view = serde_json::to_value(&facts).ok()
            .and_then(|facts| apparent_connect_client::Client::account_presentation(facts).ok())
            .and_then(|view| serde_json::from_value(view).ok());
        self.native_facts = Some(facts);
        Some(view)
    }

    pub fn facts(&self) -> AccountFacts {
        let snapshot = self.snapshot.as_ref();
        let approval = self.approval.as_ref().filter(|_| !self.closed);
        let activity = match (self.confirmation, self.request.as_ref().map(|r| r.operation)) {
            (_, Some(Operation::Disable { logout: true })) => Activity::Disconnect,
            (_, Some(Operation::Disable { logout: false })) => Activity::Disable,
            (Some(true), _) => Activity::ConfirmDisconnect,
            (Some(false), _) => Activity::ConfirmDisable,
            (_, Some(Operation::Login)) if approval.is_some() => Activity::Approval,
            (_, Some(Operation::Login)) => Activity::Starting,
            (_, Some(Operation::Resume)) => Activity::Resume,
            (_, Some(Operation::Probe)) => Activity::Check,
            (_, None) if self.consent => Activity::Consent,
            (_, None) => Activity::Idle,
        };
        let outcome = self.error.or(match self.health {
            Some(Health::Offline) => Some(SafeError::Offline),
            Some(Health::AuthRequired) => Some(SafeError::AuthRequired),
            Some(Health::Cancelled) => Some(SafeError::Cancelled),
            Some(Health::Unavailable) => Some(SafeError::Unavailable),
            _ => None,
        });
        AccountFacts {
            connected: snapshot.is_some_and(|s| s.connected),
            reauthorization_required: snapshot.is_some_and(|s| s.reauthorization_required),
            renewal_due: snapshot.is_some_and(|s| s.renewal_due),
            uploads_enabled: snapshot.is_some_and(|s| s.uploads_enabled),
            reusable_upload_grant: !self.resume_failed && snapshot.is_some_and(|s| s.reusable_upload_grant),
            local_ready: self.request.is_none() && self.retry_disable.is_none()
                && snapshot.is_some_and(|s| !s.uploads_enabled),
            closed: self.closed,
            encryption: snapshot.map(|s| s.encryption),
            retry_disable: self.retry_disable,
            server: snapshot.map(|s| s.server.clone().unwrap_or_else(|| DEFAULT_SERVER.into())),
            account_initial: snapshot.and_then(|s| s.account_initial.clone()),
            verification_uri: approval.filter(|_| activity == Activity::Approval).map(|a| a.verification_uri.clone()),
            user_code: approval.filter(|_| activity == Activity::Approval).map(|a| a.user_code.clone()),
            shared_links_url: self.backend.shared_links_url(),
            activity,
            outcome,
            local_error: self.local_error,
        }
    }
}

pub(super) fn native_connect(
    events: &Arc<dyn Fn(super::settings::Event) + Send + Sync>,
    config: &std::path::Path,
) -> Controller {
    let events = events.clone();
    Controller::open(crate::connect::hosted::settings_backend(config),
        Arc::new(move |event| events(super::settings::Event::Connect(event))))
}

impl Drop for Controller {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests;
