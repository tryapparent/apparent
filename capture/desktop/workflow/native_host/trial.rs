//! Bounded native safety guard for one non-recording physical shortcut trial.
//!
//! This module contains no timer, OS hook, policy, or persistence. The native
//! owner serializes calls and supplies authoritative registration observations,
//! monotonic time, wall time, and physical edges. Do not call `physical_edge`
//! for CLI, socket, portal-command, or other command-dispatch callbacks.

pub const MAX_TRIAL_DURATION_MS: u64 = 10_000;
const MAX_ID_BYTES: usize = 256;
const MAX_BINDING_BYTES: usize = 256;

/// Source selectors carried by a current admission view or retained fact.
/// Current-view revisions fence new begins; retained facts keep their original
/// admission revision when the coherent GUI view advances.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrialBinding {
    pub source_epoch: String,
    pub source_revision: u64,
    pub binding_id: String,
    pub effective_binding: String,
}

pub type ShortcutTrialBeginBinding = TrialBinding;

impl TrialBinding {
    fn valid(&self) -> bool {
        valid_text(&self.source_epoch, MAX_ID_BYTES)
            && valid_text(&self.binding_id, MAX_ID_BYTES)
            && valid_text(&self.effective_binding, MAX_BINDING_BYTES)
    }
}

/// Caller-owned registration/readback sample. A sample is trial-capable only
/// when registration and a native physical-edge source are both authoritative.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceObservation {
    pub binding: TrialBinding,
    pub available: bool,
    pub registered: bool,
    pub physical_edges_available: bool,
    pub busy: bool,
    pub active_capture: bool,
}

impl SourceObservation {
    fn trial_capable(&self) -> bool {
        self.available && self.registered && self.physical_edges_available && self.binding.valid()
    }

    /// Registration identity is independent of GUI-view freshness revision.
    fn same_registration(&self, other: &Self) -> bool {
        self.binding.source_epoch == other.binding.source_epoch
            && self.binding.binding_id == other.binding.binding_id
            && self.binding.effective_binding == other.binding.effective_binding
            && self.available == other.available
            && self.registered == other.registered
            && self.physical_edges_available == other.physical_edges_available
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TerminalIdentity {
    pub reservation_id: String,
    pub source_epoch: String,
    pub source_revision: u64,
    pub binding_id: String,
    pub effective_binding: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BeginRequest {
    pub reservation_id: String,
    pub binding_id: String,
    pub effective_binding: String,
    pub source_epoch: String,
    pub source_revision: u64,
    /// Unix milliseconds, parsed by the caller from the public ISO expiry.
    pub expires_at_wall_ms: u64,
    /// Required only when atomically replacing an exact terminal fact.
    pub replaces: Option<TerminalIdentity>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrialFact {
    Unavailable,
    Idle(TrialBinding),
    Reserved {
        binding: TrialBinding,
        reservation_id: String,
        expires_at_wall_ms: u64,
    },
    Pressing {
        binding: TrialBinding,
        reservation_id: String,
        expires_at_wall_ms: u64,
    },
    Observed {
        binding: TrialBinding,
        reservation_id: String,
        press_id: String,
        pressed_at_wall_ms: u64,
        released_at_wall_ms: u64,
    },
    Expired {
        binding: TrialBinding,
        reservation_id: String,
    },
    Cancelled {
        binding: TrialBinding,
        reservation_id: String,
    },
    Unknown {
        binding: TrialBinding,
        reservation_id: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    Unavailable,
    Busy,
    ActiveCapture,
    StaleSource,
    InvalidRequest,
    ReservationActive,
    ReservationMismatch,
    ReplacementRequired,
    RetirementUnconfirmed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BeginOutcome {
    Accepted,
    Refused(Refusal),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CancelOutcome {
    Cancelled,
    UnknownWhileHeld,
    Refused(Refusal),
}

/// Decision to apply before the existing capture-shortcut dispatch path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureDisposition {
    Dispatch,
    Suppress,
    SuppressUntilPhysicalRelease,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EdgeKind {
    Press,
    Release,
}

/// Construct only from an actual native key-down/key-up callback associated
/// with the registered effective chord. `chord_id` identifies the physical
/// chord across registration replacement so a retained release can clear the
/// suppression latch. `press_id` is required on down and ignored on release.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PhysicalEdge {
    pub source_epoch: String,
    pub source_revision: u64,
    pub binding_id: String,
    pub chord_id: String,
    pub kind: EdgeKind,
    pub press_id: Option<String>,
    pub wall_time_ms: u64,
    pub monotonic_time_ms: u64,
}

impl PhysicalEdge {
    fn well_formed(&self) -> bool {
        valid_text(&self.source_epoch, MAX_ID_BYTES)
            && valid_text(&self.binding_id, MAX_ID_BYTES)
            && valid_text(&self.chord_id, MAX_ID_BYTES)
            && match self.kind {
                EdgeKind::Press => self
                    .press_id
                    .as_deref()
                    .is_some_and(|id| valid_text(id, MAX_ID_BYTES)),
                EdgeKind::Release => true,
            }
    }
}

#[derive(Clone, Debug)]
struct HeldPress {
    binding: TrialBinding,
    reservation_id: String,
    chord_id: String,
    press_id: String,
    pressed_at_wall_ms: u64,
    pressed_at_monotonic_ms: u64,
}

#[derive(Clone, Debug)]
struct ActiveReservation {
    binding: TrialBinding,
    reservation_id: String,
    expires_at_wall_ms: u64,
    expires_at_monotonic_ms: u64,
    admitted_at_monotonic_ms: u64,
}

/// One bounded tombstone for a reservation retired before input delivery was
/// known complete. It is deliberately not discarded after a release: without
/// a producer watermark, later callbacks from before that release may still
/// arrive and must remain suppressible by occurrence time.
#[derive(Clone, Debug)]
struct RetiringInput {
    binding: TrialBinding,
    reservation_id: String,
    retired_at_monotonic_ms: u64,
    retired_press: Option<(String, String, u64)>, // chord, press ID, occurrence
    released: Option<(String, u64)>,              // chord, occurrence
}

#[derive(Debug, Default)]
pub struct ShortcutTrialGuard {
    source: Option<SourceObservation>,
    fact: TrialFact,
    reservation: Option<ActiveReservation>,
    held: Option<HeldPress>,
    previous_fact: Option<TrialFact>,
    retiring: Option<RetiringInput>,
}

impl Default for TrialFact {
    fn default() -> Self {
        Self::Unavailable
    }
}

impl ShortcutTrialGuard {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn fact(&self) -> &TrialFact {
        &self.fact
    }

    pub fn has_unresolved_press(&self) -> bool {
        self.held.is_some()
    }

    pub fn has_unconfirmed_retirement(&self) -> bool {
        self.retiring.is_some()
    }

    /// Exact current source selectors for an idle begin or guarded terminal
    /// replacement. Active, held, unavailable, busy, and capture states return
    /// no begin binding.
    pub fn current_begin_binding(&self) -> Option<&ShortcutTrialBeginBinding> {
        let source = self.source.as_ref()?;
        if !source.trial_capable()
            || source.busy
            || source.active_capture
            || self.reservation.is_some()
            || self.held.is_some()
            || self.retiring.is_some()
        {
            return None;
        }
        Some(&source.binding)
    }

    /// The admitted revision context for translating native physical callbacks.
    /// A caller must also match the raw OS source epoch and registration ID.
    pub fn physical_edge_binding(&self) -> Option<&TrialBinding> {
        self.held
            .as_ref()
            .map(|held| &held.binding)
            .or_else(|| {
                self.reservation
                    .as_ref()
                    .map(|reservation| &reservation.binding)
            })
            .or_else(|| self.retiring.as_ref().map(|retiring| &retiring.binding))
    }

    /// One bounded predecessor fact preserves the replaced evidence/correlation.
    pub fn previous_fact(&self) -> Option<&TrialFact> {
        self.previous_fact.as_ref()
    }

    /// Refresh from the host's authoritative registration snapshot. A source
    /// change retires an in-flight reservation into a persistent input tombstone.
    /// A later exact release may clear the held latch, never the tombstone.
    /// Compatibility form has no trustworthy observation time. If it retires
    /// an admitted reservation, use an infinite cutoff and fail closed. Native
    /// integrations should call `observe_source_at` with their occurrence clock.
    pub fn observe_source(&mut self, next: Option<&SourceObservation>) -> CaptureDisposition {
        self.observe_source_at(next, u64::MAX)
    }

    pub fn observe_source_at(
        &mut self,
        next: Option<&SourceObservation>,
        now_monotonic_ms: u64,
    ) -> CaptureDisposition {
        let next = next.filter(|source| source.trial_capable()).cloned();
        let changed = match (&self.source, &next) {
            (Some(previous), Some(current)) => !previous.same_registration(current),
            (None, None) => false,
            _ => true,
        };
        let becomes_busy = next
            .as_ref()
            .is_some_and(|source| source.busy || source.active_capture);
        if self.reservation.is_some() && (changed || becomes_busy) {
            self.invalidate_reservation(now_monotonic_ms);
        }
        self.source = next;
        if self.reservation.is_none() && self.held.is_none() {
            match (&self.source, &self.fact) {
                (Some(source), TrialFact::Unavailable | TrialFact::Idle(_)) => {
                    self.fact = TrialFact::Idle(source.binding.clone());
                }
                (None, TrialFact::Unavailable | TrialFact::Idle(_)) => {
                    self.fact = TrialFact::Unavailable;
                }
                _ => {}
            }
        }
        if self.held.is_some() || self.retiring.is_some() {
            CaptureDisposition::SuppressUntilPhysicalRelease
        } else if self.reservation.is_some() {
            CaptureDisposition::Suppress
        } else {
            CaptureDisposition::Dispatch
        }
    }

    /// Accepts a request only against the current exact registration snapshot.
    /// Expiry is bounded to ten seconds and represented in both supplied clocks.
    pub fn begin(
        &mut self,
        request: &BeginRequest,
        now_monotonic_ms: u64,
        now_wall_ms: u64,
    ) -> BeginOutcome {
        // Caller must advance all pending facts before it takes the coherent
        // source/view freshness fence. begin intentionally has no hidden advance.
        if self.held.is_some() {
            return BeginOutcome::Refused(Refusal::Busy);
        }
        if self.retiring.is_some() {
            return BeginOutcome::Refused(Refusal::RetirementUnconfirmed);
        }
        let Some(source) = self.source.as_ref() else {
            return BeginOutcome::Refused(Refusal::Unavailable);
        };
        if !source.trial_capable() {
            return BeginOutcome::Refused(Refusal::Unavailable);
        }
        if source.busy {
            return BeginOutcome::Refused(Refusal::Busy);
        }
        if source.active_capture {
            return BeginOutcome::Refused(Refusal::ActiveCapture);
        }
        if self.reservation.is_some() {
            return BeginOutcome::Refused(Refusal::ReservationActive);
        }
        if !valid_text(&request.reservation_id, MAX_ID_BYTES)
            || !valid_text(&request.binding_id, MAX_ID_BYTES)
            || !valid_text(&request.effective_binding, MAX_BINDING_BYTES)
            || !valid_text(&request.source_epoch, MAX_ID_BYTES)
            || request.expires_at_wall_ms <= now_wall_ms
        {
            return BeginOutcome::Refused(Refusal::InvalidRequest);
        }
        if request.replaces.as_ref().is_some_and(|old| {
            !valid_text(&old.reservation_id, MAX_ID_BYTES)
                || !valid_text(&old.source_epoch, MAX_ID_BYTES)
                || !valid_text(&old.binding_id, MAX_ID_BYTES)
                || !valid_text(&old.effective_binding, MAX_BINDING_BYTES)
        }) {
            return BeginOutcome::Refused(Refusal::InvalidRequest);
        }
        if request.source_epoch != source.binding.source_epoch
            || request.source_revision != source.binding.source_revision
            || request.binding_id != source.binding.binding_id
            || request.effective_binding != source.binding.effective_binding
        {
            return BeginOutcome::Refused(Refusal::StaleSource);
        }
        let terminal_identity = terminal_identity(&self.fact);
        match (terminal_identity, request.replaces.as_ref()) {
            (None, None) => {}
            (None, Some(_)) => return BeginOutcome::Refused(Refusal::ReservationMismatch),
            (Some(_), None) => return BeginOutcome::Refused(Refusal::ReplacementRequired),
            (Some(old), Some(replaces)) if old == *replaces => {
                if replaces.reservation_id == request.reservation_id {
                    return BeginOutcome::Refused(Refusal::InvalidRequest);
                }
            }
            (Some(_), Some(_)) => return BeginOutcome::Refused(Refusal::ReservationMismatch),
        }
        let duration = request.expires_at_wall_ms - now_wall_ms;
        if duration > MAX_TRIAL_DURATION_MS {
            return BeginOutcome::Refused(Refusal::InvalidRequest);
        }
        let Some(expires_at_monotonic_ms) = now_monotonic_ms.checked_add(duration) else {
            return BeginOutcome::Refused(Refusal::InvalidRequest);
        };
        let previous = request.replaces.as_ref().map(|_| self.fact.clone());
        let active = ActiveReservation {
            binding: source.binding.clone(),
            reservation_id: request.reservation_id.clone(),
            expires_at_wall_ms: request.expires_at_wall_ms,
            expires_at_monotonic_ms,
            admitted_at_monotonic_ms: now_monotonic_ms,
        };
        self.fact = TrialFact::Reserved {
            binding: active.binding.clone(),
            reservation_id: active.reservation_id.clone(),
            expires_at_wall_ms: active.expires_at_wall_ms,
        };
        self.reservation = Some(active);
        if previous.is_some() {
            self.previous_fact = previous;
        }
        BeginOutcome::Accepted
    }

    /// Caller-driven expiry check. No timer is owned by this guard.
    pub fn advance(&mut self, now_monotonic_ms: u64) -> CaptureDisposition {
        let expired = self
            .reservation
            .as_ref()
            .is_some_and(|reservation| now_monotonic_ms >= reservation.expires_at_monotonic_ms);
        if expired {
            if let Some(reservation) = self.reservation.take() {
                if self.held.is_some() {
                    self.fact = TrialFact::Unknown {
                        binding: reservation.binding.clone(),
                        reservation_id: reservation.reservation_id.clone(),
                    };
                } else {
                    self.fact = TrialFact::Expired {
                        binding: reservation.binding.clone(),
                        reservation_id: reservation.reservation_id.clone(),
                    };
                }
                self.retire_input(reservation, now_monotonic_ms);
            }
        }
        if self.held.is_some() || self.retiring.is_some() {
            CaptureDisposition::SuppressUntilPhysicalRelease
        } else if self.reservation.is_some() {
            CaptureDisposition::Suppress
        } else {
            CaptureDisposition::Dispatch
        }
    }

    pub fn cancel(&mut self, reservation_id: &str, now_monotonic_ms: u64) -> CancelOutcome {
        self.advance(now_monotonic_ms);
        let Some(reservation) = self.reservation.take() else {
            return CancelOutcome::Refused(Refusal::ReservationMismatch);
        };
        if reservation.reservation_id != reservation_id {
            self.reservation = Some(reservation);
            return CancelOutcome::Refused(Refusal::ReservationMismatch);
        }
        if self.held.is_some() {
            self.fact = TrialFact::Unknown {
                binding: reservation.binding.clone(),
                reservation_id: reservation.reservation_id.clone(),
            };
            self.retire_input(reservation, now_monotonic_ms);
            CancelOutcome::UnknownWhileHeld
        } else {
            self.fact = TrialFact::Cancelled {
                binding: reservation.binding.clone(),
                reservation_id: reservation.reservation_id.clone(),
            };
            self.retire_input(reservation, now_monotonic_ms);
            CancelOutcome::Cancelled
        }
    }

    /// Called before existing capture dispatch for all sources. This can suppress
    /// a matching CLI/IPC callback while a reservation owns the binding, but it
    /// never qualifies that callback as physical evidence.
    pub fn legacy_capture_disposition(
        &self,
        binding_id: &str,
        chord_id: &str,
    ) -> CaptureDisposition {
        if self
            .held
            .as_ref()
            .is_some_and(|held| held.chord_id == chord_id)
        {
            return CaptureDisposition::SuppressUntilPhysicalRelease;
        }
        if self
            .retiring
            .as_ref()
            .is_some_and(|retiring| retiring.binding.binding_id == binding_id)
        {
            return CaptureDisposition::Suppress;
        }
        if self
            .reservation
            .as_ref()
            .is_some_and(|reservation| reservation.binding.binding_id == binding_id)
        {
            return CaptureDisposition::Suppress;
        }
        CaptureDisposition::Dispatch
    }

    /// Exact-source timestamped form suppresses retired input until a trusted
    /// release, and all delayed callbacks at/before that release. Pass `None`
    /// without a trustworthy occurrence time; retired input then fails closed.
    pub fn legacy_capture_disposition_at(
        &self,
        source_epoch: &str,
        source_revision: u64,
        binding_id: &str,
        chord_id: &str,
        occurrence_monotonic_ms: Option<u64>,
    ) -> CaptureDisposition {
        if self
            .held
            .as_ref()
            .is_some_and(|held| held.chord_id == chord_id)
        {
            return CaptureDisposition::SuppressUntilPhysicalRelease;
        }
        if let Some(retiring) = &self.retiring {
            let retired_chord = retiring
                .retired_press
                .as_ref()
                .map(|(chord, _, _)| chord)
                .or_else(|| retiring.released.as_ref().map(|(chord, _)| chord));
            if retiring.binding.source_epoch == source_epoch
                && retiring.binding.source_revision == source_revision
                && retiring.binding.binding_id == binding_id
                && retired_chord.map_or(true, |retired_chord| retired_chord == chord_id)
                && occurrence_monotonic_ms
                    .map(|time| {
                        retiring.released.as_ref().map_or(true, |(_, released_at)| {
                            time <= retiring.retired_at_monotonic_ms.max(*released_at)
                        })
                    })
                    .unwrap_or(true)
            {
                return CaptureDisposition::Suppress;
            }
        }
        if self
            .reservation
            .as_ref()
            .is_some_and(|reservation| reservation.binding.binding_id == binding_id)
        {
            return CaptureDisposition::Suppress;
        }
        CaptureDisposition::Dispatch
    }

    /// Consume only matching physical registration edges. Matching down owns the
    /// chord until the matching up; only an unexpired, same-incarnation pair
    /// publishes `Observed`.
    pub fn physical_edge(&mut self, edge: &PhysicalEdge) -> CaptureDisposition {
        if !edge.well_formed() {
            // An invalid native observation is never authority for capture or
            // for advancing trial facts. In particular, do not clear a held
            // press on a malformed release or let a missing press ID bypass a
            // reservation. Preserve the last authoritative state so only a
            // subsequent valid matching release can reconcile held ownership.
            return if self.held.is_some() {
                CaptureDisposition::SuppressUntilPhysicalRelease
            } else {
                CaptureDisposition::Suppress
            };
        }
        self.advance(edge.monotonic_time_ms);

        if let Some(retiring) = self.retiring.as_mut() {
            if edge_matches(edge, &retiring.binding) {
                match edge.kind {
                    EdgeKind::Press
                        if retiring.released.as_ref().map_or(true, |(_, released_at)| {
                            edge.monotonic_time_ms
                                <= retiring.retired_at_monotonic_ms.max(*released_at)
                        }) =>
                    {
                        let press_id = edge.press_id.as_ref().expect("well-formed press").clone();
                        if retiring.retired_press.is_none() {
                            retiring.retired_press = Some((
                                edge.chord_id.clone(),
                                press_id.clone(),
                                edge.monotonic_time_ms,
                            ));
                        }
                        let already_released =
                            retiring
                                .released
                                .as_ref()
                                .is_some_and(|(chord, released_at)| {
                                    chord == &edge.chord_id
                                        && *released_at >= edge.monotonic_time_ms
                                });
                        if !already_released && self.held.is_none() {
                            self.held = Some(HeldPress {
                                binding: retiring.binding.clone(),
                                reservation_id: retiring.reservation_id.clone(),
                                chord_id: edge.chord_id.clone(),
                                press_id,
                                pressed_at_wall_ms: edge.wall_time_ms,
                                pressed_at_monotonic_ms: edge.monotonic_time_ms,
                            });
                        }
                        return if self.held.is_some() {
                            CaptureDisposition::SuppressUntilPhysicalRelease
                        } else {
                            CaptureDisposition::Suppress
                        };
                    }
                    EdgeKind::Release => {
                        if edge.monotonic_time_ms < retiring.retired_at_monotonic_ms
                            || self
                                .held
                                .as_ref()
                                .is_some_and(|held| edge.wall_time_ms < held.pressed_at_wall_ms)
                        {
                            return CaptureDisposition::SuppressUntilPhysicalRelease;
                        }
                        let known_chord =
                            retiring.retired_press.as_ref().map(|(chord, _, _)| chord);
                        if known_chord.is_some_and(|chord| chord != &edge.chord_id) {
                            return CaptureDisposition::SuppressUntilPhysicalRelease;
                        }
                        if retiring.released.is_none() {
                            retiring.released =
                                Some((edge.chord_id.clone(), edge.monotonic_time_ms));
                        }
                        if self.held.as_ref().is_some_and(|held| {
                            held.binding == retiring.binding
                                && held.chord_id == edge.chord_id
                                && edge.monotonic_time_ms >= held.pressed_at_monotonic_ms
                        }) {
                            self.held = None;
                        } else if self.held.is_some() {
                            return CaptureDisposition::SuppressUntilPhysicalRelease;
                        }
                        return CaptureDisposition::Suppress;
                    }
                    EdgeKind::Press => {
                        if self
                            .held
                            .as_ref()
                            .is_some_and(|held| held.chord_id == edge.chord_id)
                        {
                            return CaptureDisposition::SuppressUntilPhysicalRelease;
                        }
                        return CaptureDisposition::Dispatch;
                    }
                }
            }
        }

        if let Some(held) = self.held.clone() {
            if held.chord_id != edge.chord_id {
                return CaptureDisposition::Dispatch;
            }
            // A chord token is not authority across source or registration incarnations.
            // A queued earlier up also cannot prove the admitted down is released.
            if !edge_matches(edge, &held.binding) {
                return CaptureDisposition::SuppressUntilPhysicalRelease;
            }
            if edge.monotonic_time_ms < held.pressed_at_monotonic_ms {
                self.invalidate_reservation(edge.monotonic_time_ms);
                return CaptureDisposition::SuppressUntilPhysicalRelease;
            }
            if edge.kind == EdgeKind::Release && edge.wall_time_ms < held.pressed_at_wall_ms {
                self.invalidate_reservation(edge.monotonic_time_ms);
                return CaptureDisposition::SuppressUntilPhysicalRelease;
            }
            match edge.kind {
                EdgeKind::Press => return CaptureDisposition::SuppressUntilPhysicalRelease,
                EdgeKind::Release => {
                    let exact_pair = self.reservation.as_ref().is_some_and(|reservation| {
                        reservation.reservation_id == held.reservation_id
                            && reservation.binding == held.binding
                            && edge_matches(edge, &held.binding)
                    });
                    self.held = None;
                    if let Some(reservation) = self.reservation.take() {
                        if exact_pair
                            && edge.wall_time_ms >= held.pressed_at_wall_ms
                            && edge.monotonic_time_ms >= held.pressed_at_monotonic_ms
                        {
                            self.fact = TrialFact::Observed {
                                binding: held.binding,
                                reservation_id: held.reservation_id,
                                press_id: held.press_id,
                                pressed_at_wall_ms: held.pressed_at_wall_ms,
                                released_at_wall_ms: edge.wall_time_ms,
                            };
                        } else {
                            self.fact = TrialFact::Unknown {
                                binding: reservation.binding.clone(),
                                reservation_id: reservation.reservation_id.clone(),
                            };
                            self.held = Some(held);
                            self.retire_input(reservation, edge.monotonic_time_ms);
                            return CaptureDisposition::SuppressUntilPhysicalRelease;
                        }
                    }
                    return CaptureDisposition::Suppress;
                }
            }
        }

        let Some(reservation) = self.reservation.as_ref() else {
            return CaptureDisposition::Dispatch;
        };
        if !edge_matches(edge, &reservation.binding) {
            let identity_changed = edge.source_epoch != reservation.binding.source_epoch
                || edge.source_revision != reservation.binding.source_revision
                || edge.binding_id != reservation.binding.binding_id;
            if identity_changed {
                self.invalidate_reservation(edge.monotonic_time_ms);
            }
            return CaptureDisposition::Dispatch;
        }
        if edge.monotonic_time_ms < reservation.admitted_at_monotonic_ms {
            return CaptureDisposition::Suppress;
        }
        if edge.kind == EdgeKind::Release {
            return CaptureDisposition::Dispatch;
        }
        let Some(press_id) = edge.press_id.as_ref() else {
            return CaptureDisposition::Dispatch;
        };
        let reservation = self
            .reservation
            .as_ref()
            .expect("reservation remains admitted");
        let held = HeldPress {
            binding: reservation.binding.clone(),
            reservation_id: reservation.reservation_id.clone(),
            chord_id: edge.chord_id.clone(),
            press_id: press_id.clone(),
            pressed_at_wall_ms: edge.wall_time_ms,
            pressed_at_monotonic_ms: edge.monotonic_time_ms,
        };
        self.fact = TrialFact::Pressing {
            binding: reservation.binding.clone(),
            reservation_id: reservation.reservation_id.clone(),
            expires_at_wall_ms: reservation.expires_at_wall_ms,
        };
        self.held = Some(held);
        CaptureDisposition::SuppressUntilPhysicalRelease
    }

    fn invalidate_reservation(&mut self, retired_at_monotonic_ms: u64) {
        if let Some(reservation) = self.reservation.take() {
            self.fact = TrialFact::Unknown {
                binding: reservation.binding.clone(),
                reservation_id: reservation.reservation_id.clone(),
            };
            self.retire_input(reservation, retired_at_monotonic_ms);
        }
    }

    fn retire_input(&mut self, reservation: ActiveReservation, retired_at_monotonic_ms: u64) {
        // A clock value before admission cannot define a retirement fence.
        // Preserve suppression forever for this candidate instead of using an
        // older cutoff that could admit a queued press.
        let retired_at_monotonic_ms =
            if retired_at_monotonic_ms < reservation.admitted_at_monotonic_ms {
                u64::MAX
            } else {
                retired_at_monotonic_ms
            };
        let retired_press = self
            .held
            .as_ref()
            .filter(|held| held.binding == reservation.binding)
            .map(|held| {
                (
                    held.chord_id.clone(),
                    held.press_id.clone(),
                    held.pressed_at_monotonic_ms,
                )
            });
        self.retiring = Some(RetiringInput {
            binding: reservation.binding,
            reservation_id: reservation.reservation_id,
            retired_at_monotonic_ms,
            retired_press,
            released: None,
        });
    }
}

fn terminal_identity(fact: &TrialFact) -> Option<TerminalIdentity> {
    let (binding, reservation_id) = match fact {
        TrialFact::Observed {
            binding,
            reservation_id,
            ..
        }
        | TrialFact::Expired {
            binding,
            reservation_id,
        }
        | TrialFact::Cancelled {
            binding,
            reservation_id,
        }
        | TrialFact::Unknown {
            binding,
            reservation_id,
        } => (binding, reservation_id),
        TrialFact::Unavailable
        | TrialFact::Idle(_)
        | TrialFact::Reserved { .. }
        | TrialFact::Pressing { .. } => return None,
    };
    Some(TerminalIdentity {
        reservation_id: reservation_id.clone(),
        source_epoch: binding.source_epoch.clone(),
        source_revision: binding.source_revision,
        binding_id: binding.binding_id.clone(),
        effective_binding: binding.effective_binding.clone(),
    })
}

fn edge_matches(edge: &PhysicalEdge, binding: &TrialBinding) -> bool {
    edge.source_epoch == binding.source_epoch
        && edge.source_revision == binding.source_revision
        && edge.binding_id == binding.binding_id
}

fn valid_text(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.len() <= maximum && !value.contains('\0')
}

#[cfg(test)]
mod tests {
    use super::*;

    const WALL: u64 = 1_800_000_000_000;
    const MONO: u64 = 50_000;

    fn source() -> SourceObservation {
        SourceObservation {
            binding: TrialBinding {
                source_epoch: "native-epoch-1".into(),
                source_revision: 7,
                binding_id: "registration-7".into(),
                effective_binding: "Ctrl+Shift+R".into(),
            },
            available: true,
            registered: true,
            physical_edges_available: true,
            busy: false,
            active_capture: false,
        }
    }

    fn request(source: &SourceObservation, reservation_id: &str) -> BeginRequest {
        BeginRequest {
            reservation_id: reservation_id.into(),
            binding_id: source.binding.binding_id.clone(),
            effective_binding: source.binding.effective_binding.clone(),
            source_epoch: source.binding.source_epoch.clone(),
            source_revision: source.binding.source_revision,
            expires_at_wall_ms: WALL + 5_000,
            replaces: None,
        }
    }

    fn guard() -> ShortcutTrialGuard {
        let mut guard = ShortcutTrialGuard::new();
        guard.observe_source(Some(&source()));
        guard
    }

    fn edge(
        kind: EdgeKind,
        source: &SourceObservation,
        chord: &str,
        press: Option<&str>,
        wall: u64,
        mono: u64,
    ) -> PhysicalEdge {
        PhysicalEdge {
            source_epoch: source.binding.source_epoch.clone(),
            source_revision: source.binding.source_revision,
            binding_id: source.binding.binding_id.clone(),
            chord_id: chord.into(),
            kind,
            press_id: press.map(str::to_owned),
            wall_time_ms: wall,
            monotonic_time_ms: mono,
        }
    }

    #[test]
    fn begin_refuses_unavailable_unsupported_busy_active_stale_and_invalid_expiry() {
        let mut guard = ShortcutTrialGuard::new();
        let source = source();
        assert_eq!(
            guard.begin(&request(&source, "r1"), MONO, WALL),
            BeginOutcome::Refused(Refusal::Unavailable)
        );

        let mut unsupported = source.clone();
        unsupported.physical_edges_available = false;
        guard.observe_source(Some(&unsupported));
        assert_eq!(guard.fact(), &TrialFact::Unavailable);
        assert_eq!(
            guard.begin(&request(&source, "r1"), MONO, WALL),
            BeginOutcome::Refused(Refusal::Unavailable)
        );

        let busy = SourceObservation {
            busy: true,
            ..source.clone()
        };
        guard.observe_source(Some(&source));
        guard.observe_source(Some(&busy));
        assert_eq!(
            guard.begin(&request(&source, "r1"), MONO, WALL),
            BeginOutcome::Refused(Refusal::Busy)
        );

        let active = SourceObservation {
            active_capture: true,
            ..source.clone()
        };
        guard.observe_source(Some(&active));
        assert_eq!(
            guard.begin(&request(&source, "r1"), MONO, WALL),
            BeginOutcome::Refused(Refusal::ActiveCapture)
        );

        guard.observe_source(Some(&source));
        let mut stale = request(&source, "r1");
        stale.source_revision -= 1;
        assert_eq!(
            guard.begin(&stale, MONO, WALL),
            BeginOutcome::Refused(Refusal::StaleSource)
        );
        let mut too_long = request(&source, "r1");
        too_long.expires_at_wall_ms = WALL + MAX_TRIAL_DURATION_MS + 1;
        assert_eq!(
            guard.begin(&too_long, MONO, WALL),
            BeginOutcome::Refused(Refusal::InvalidRequest)
        );
        let mut zero = request(&source, "r1");
        zero.expires_at_wall_ms = WALL;
        assert_eq!(
            guard.begin(&zero, MONO, WALL),
            BeginOutcome::Refused(Refusal::InvalidRequest)
        );
        assert_eq!(guard.fact(), &TrialFact::Idle(source.binding));
    }

    #[test]
    fn accepted_is_reserved_only_and_matching_press_release_is_the_only_observation() {
        let source = source();
        let mut guard = guard();
        assert_eq!(
            guard.begin(&request(&source, "r1"), MONO, WALL),
            BeginOutcome::Accepted
        );
        assert!(matches!(guard.fact(), TrialFact::Reserved { .. }));
        assert_eq!(
            guard.legacy_capture_disposition("registration-7", "chord-1"),
            CaptureDisposition::Suppress
        );
        let down = edge(
            EdgeKind::Press,
            &source,
            "chord-1",
            Some("press-1"),
            WALL + 100,
            MONO + 100,
        );
        assert_eq!(
            guard.physical_edge(&down),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(matches!(guard.fact(), TrialFact::Pressing { .. }));
        let up = edge(
            EdgeKind::Release,
            &source,
            "chord-1",
            None,
            WALL + 250,
            MONO + 250,
        );
        assert_eq!(guard.physical_edge(&up), CaptureDisposition::Suppress);
        assert_eq!(
            guard.fact(),
            &TrialFact::Observed {
                binding: source.binding.clone(),
                reservation_id: "r1".into(),
                press_id: "press-1".into(),
                pressed_at_wall_ms: WALL + 100,
                released_at_wall_ms: WALL + 250,
            }
        );
        assert_eq!(
            guard.legacy_capture_disposition("registration-7", "chord-1"),
            CaptureDisposition::Dispatch
        );
    }

    #[test]
    fn duplicate_down_unrelated_registration_and_release_first_never_qualify() {
        let source = source();
        let mut first = guard();
        first.begin(&request(&source, "r1"), MONO, WALL);
        let release_first = edge(
            EdgeKind::Release,
            &source,
            "chord-1",
            None,
            WALL + 50,
            MONO + 50,
        );
        assert_eq!(
            first.physical_edge(&release_first),
            CaptureDisposition::Dispatch
        );
        assert!(matches!(first.fact(), TrialFact::Reserved { .. }));

        let mut unrelated = edge(
            EdgeKind::Press,
            &source,
            "other",
            Some("other-press"),
            WALL + 60,
            MONO + 60,
        );
        unrelated.binding_id = "other-registration".into();
        assert_eq!(
            first.physical_edge(&unrelated),
            CaptureDisposition::Dispatch
        );
        assert!(
            matches!(first.fact(), TrialFact::Unknown { .. }),
            "a changed registration invalidates the request"
        );
        assert_eq!(
            first.fact(),
            &TrialFact::Unknown {
                binding: source.binding.clone(),
                reservation_id: "r1".into()
            }
        );

        let mut second = guard();
        second.begin(&request(&source, "r2"), MONO, WALL);
        let down = edge(
            EdgeKind::Press,
            &source,
            "chord-2",
            Some("press-original"),
            WALL + 100,
            MONO + 100,
        );
        assert_eq!(
            second.physical_edge(&down),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        let duplicate = edge(
            EdgeKind::Press,
            &source,
            "chord-2",
            Some("repeat-id"),
            WALL + 120,
            MONO + 120,
        );
        assert_eq!(
            second.physical_edge(&duplicate),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(matches!(second.fact(), TrialFact::Pressing { .. }));
        let up = edge(
            EdgeKind::Release,
            &source,
            "chord-2",
            None,
            WALL + 200,
            MONO + 200,
        );
        second.physical_edge(&up);
        assert!(
            matches!(&second.fact(), TrialFact::Observed { press_id, .. } if press_id == "press-original")
        );
    }

    #[test]
    fn cli_or_ipc_capture_dispatch_is_suppressed_but_never_counts_as_physical_evidence() {
        let source = source();
        let mut guard = guard();
        guard.begin(&request(&source, "r1"), MONO, WALL);
        assert_eq!(
            guard.legacy_capture_disposition("registration-7", "chord-1"),
            CaptureDisposition::Suppress
        );
        assert!(matches!(guard.fact(), TrialFact::Reserved { .. }));
        assert_eq!(
            guard.fact(),
            &TrialFact::Reserved {
                binding: source.binding.clone(),
                reservation_id: "r1".into(),
                expires_at_wall_ms: WALL + 5_000,
            }
        );
    }

    #[test]
    fn cancel_and_expiry_before_press_are_terminal_and_never_observed() {
        let source = source();
        let mut cancelled = guard();
        cancelled.begin(&request(&source, "cancelled"), MONO, WALL);
        assert_eq!(
            cancelled.cancel("cancelled", MONO + 1),
            CancelOutcome::Cancelled
        );
        assert!(matches!(cancelled.fact(), TrialFact::Cancelled { .. }));
        let after_cancel = edge(
            EdgeKind::Press,
            &source,
            "chord-c",
            Some("press-c"),
            WALL + 20,
            MONO + 20,
        );
        assert_eq!(
            cancelled.physical_edge(&after_cancel),
            CaptureDisposition::SuppressUntilPhysicalRelease,
            "a later press cannot prove the retired chord was released"
        );

        let mut expired = guard();
        expired.begin(&request(&source, "expired"), MONO, WALL);
        assert_eq!(
            expired.advance(MONO + 5_000),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(matches!(expired.fact(), TrialFact::Expired { .. }));
        let after_expiry = edge(
            EdgeKind::Press,
            &source,
            "chord-e",
            Some("press-e"),
            WALL + 6_000,
            MONO + 6_000,
        );
        assert_eq!(
            expired.physical_edge(&after_expiry),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(!matches!(expired.fact(), TrialFact::Observed { .. }));
    }

    #[test]
    fn cancel_expiry_and_registration_loss_while_held_keep_capture_suppressed_until_matching_up() {
        let source = source();
        let down = edge(
            EdgeKind::Press,
            &source,
            "held-chord",
            Some("press-held"),
            WALL + 10,
            MONO + 10,
        );

        let mut cancelled = guard();
        cancelled.begin(&request(&source, "cancel-held"), MONO, WALL);
        cancelled.physical_edge(&down);
        assert_eq!(
            cancelled.cancel("cancel-held", MONO + 20),
            CancelOutcome::UnknownWhileHeld
        );
        assert_eq!(
            cancelled.legacy_capture_disposition("registration-7", "held-chord"),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(
            matches!(cancelled.fact(), TrialFact::Unknown { reservation_id, .. } if reservation_id == "cancel-held")
        );
        let up = edge(
            EdgeKind::Release,
            &source,
            "held-chord",
            None,
            WALL + 30,
            MONO + 30,
        );
        assert_eq!(cancelled.physical_edge(&up), CaptureDisposition::Suppress);
        assert!(!cancelled.has_unresolved_press());
        assert_eq!(
            cancelled.legacy_capture_disposition("registration-7", "held-chord"),
            CaptureDisposition::Suppress,
            "untimed dispatch remains fail-closed after release"
        );
        assert!(
            matches!(cancelled.fact(), TrialFact::Unknown { .. }),
            "release clears suppression, not unknown history"
        );

        let mut expired = guard();
        expired.begin(&request(&source, "expire-held"), MONO, WALL);
        expired.physical_edge(&down);
        assert_eq!(
            expired.advance(MONO + 5_000),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(
            matches!(expired.fact(), TrialFact::Unknown { reservation_id, .. } if reservation_id == "expire-held")
        );
        assert_eq!(
            expired.legacy_capture_disposition("registration-7", "held-chord"),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        let up_after_expiry = edge(
            EdgeKind::Release,
            &source,
            "held-chord",
            None,
            WALL + 5_010,
            MONO + 5_010,
        );
        assert_eq!(
            expired.physical_edge(&up),
            CaptureDisposition::SuppressUntilPhysicalRelease,
            "a release that occurred before expiry cannot retire the tombstone"
        );
        assert!(expired.has_unresolved_press());
        assert_eq!(
            expired.physical_edge(&up_after_expiry),
            CaptureDisposition::Suppress
        );
        assert!(!expired.has_unresolved_press());
        assert_eq!(
            expired.legacy_capture_disposition("registration-7", "held-chord"),
            CaptureDisposition::Suppress,
            "expiry tombstone suppresses untimed legacy callbacks"
        );
        assert!(matches!(expired.fact(), TrialFact::Unknown { .. }));

        let mut rebound = guard();
        rebound.begin(&request(&source, "rebound-held"), MONO, WALL);
        rebound.physical_edge(&down);
        let replacement = SourceObservation {
            binding: TrialBinding {
                source_epoch: "native-epoch-2".into(),
                source_revision: 1,
                binding_id: "registration-8".into(),
                effective_binding: "Alt+Shift+R".into(),
            },
            ..source.clone()
        };
        assert_eq!(
            rebound.observe_source_at(Some(&replacement), MONO + 20),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(
            matches!(rebound.fact(), TrialFact::Unknown { reservation_id, .. } if reservation_id == "rebound-held")
        );
        let mut old_release = up.clone();
        old_release.source_epoch = replacement.binding.source_epoch.clone();
        old_release.source_revision = replacement.binding.source_revision;
        old_release.binding_id = replacement.binding.binding_id.clone();
        assert_eq!(
            rebound.physical_edge(&old_release),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(rebound.has_unresolved_press());
        assert_eq!(rebound.physical_edge(&up), CaptureDisposition::Suppress);
        assert!(!rebound.has_unresolved_press());
        assert!(
            matches!(rebound.fact(), TrialFact::Unknown { .. }),
            "a release after invalidation cannot become observed"
        );
    }

    #[test]
    fn source_reconnect_invalidates_reserved_identity_and_keeps_retirement_guarded() {
        let mut guard = guard();
        let source = source();
        guard.begin(&request(&source, "r1"), MONO, WALL);
        let disconnected = SourceObservation {
            available: false,
            ..source.clone()
        };
        assert_eq!(
            guard.observe_source_at(Some(&disconnected), MONO + 1),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert_eq!(
            guard.fact(),
            &TrialFact::Unknown {
                binding: source.binding.clone(),
                reservation_id: "r1".into()
            }
        );

        let reconnected = SourceObservation {
            binding: TrialBinding {
                source_epoch: "native-epoch-2".into(),
                source_revision: 1,
                binding_id: "registration-8".into(),
                effective_binding: "Ctrl+Alt+R".into(),
            },
            ..source.clone()
        };
        guard.observe_source_at(Some(&reconnected), MONO + 2);
        let stale = request(&source, "r2");
        assert_eq!(
            guard.begin(&stale, MONO + 1, WALL + 1),
            BeginOutcome::Refused(Refusal::RetirementUnconfirmed)
        );
        let replaces = terminal_identity(guard.fact()).expect("source loss is terminal unknown");
        assert_eq!(
            guard.begin(
                &BeginRequest {
                    replaces: Some(replaces),
                    ..request(&reconnected, "r3")
                },
                MONO + 3,
                WALL + 3
            ),
            BeginOutcome::Refused(Refusal::RetirementUnconfirmed),
            "without a producer watermark the retirement tombstone cannot be dropped"
        );
        assert_eq!(
            guard.fact(),
            &TrialFact::Unknown {
                binding: source.binding.clone(),
                reservation_id: "r1".into()
            }
        );
    }

    #[test]
    fn release_timestamp_before_press_is_suppressed_but_never_reported_observed() {
        let source = source();
        let mut guard = guard();
        guard.begin(&request(&source, "time-order"), MONO, WALL);
        let down = edge(
            EdgeKind::Press,
            &source,
            "time-chord",
            Some("press-time"),
            WALL + 100,
            MONO + 100,
        );
        guard.physical_edge(&down);
        let up = edge(
            EdgeKind::Release,
            &source,
            "time-chord",
            None,
            WALL + 99,
            MONO + 200,
        );
        assert_eq!(
            guard.physical_edge(&up),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(guard.has_unresolved_press());
        assert!(guard.has_unconfirmed_retirement());
        assert_eq!(
            guard.fact(),
            &TrialFact::Unknown {
                binding: source.binding,
                reservation_id: "time-order".into()
            }
        );
    }
}

#[cfg(test)]
mod extra_safety_tests {
    use super::*;

    const WALL: u64 = 1_800_000_000_000;
    const MONO: u64 = 50_000;

    fn source() -> SourceObservation {
        SourceObservation {
            binding: TrialBinding {
                source_epoch: "epoch".into(),
                source_revision: 1,
                binding_id: "registration".into(),
                effective_binding: "Ctrl+Shift+R".into(),
            },
            available: true,
            registered: true,
            physical_edges_available: true,
            busy: false,
            active_capture: false,
        }
    }

    fn edge(source: &SourceObservation, kind: EdgeKind, wall: u64, mono: u64) -> PhysicalEdge {
        PhysicalEdge {
            source_epoch: source.binding.source_epoch.clone(),
            source_revision: source.binding.source_revision,
            binding_id: source.binding.binding_id.clone(),
            chord_id: "chord".into(),
            kind,
            press_id: (kind == EdgeKind::Press).then(|| "press".into()),
            wall_time_ms: wall,
            monotonic_time_ms: mono,
        }
    }

    #[test]
    fn source_unavailability_does_not_publish_stale_idle_and_refreshes_idle_binding() {
        let old = source();
        let mut guard = ShortcutTrialGuard::new();
        guard.observe_source(Some(&old));
        let mut new = old.clone();
        new.binding.source_revision += 1;
        new.binding.binding_id = "registration-2".into();
        guard.observe_source(Some(&new));
        assert_eq!(guard.fact(), &TrialFact::Idle(new.binding));
        guard.observe_source(None);
        assert_eq!(guard.fact(), &TrialFact::Unavailable);
    }

    #[test]
    fn expired_reservation_retains_input_ownership_without_watermark() {
        let source = source();
        let mut guard = ShortcutTrialGuard::new();
        guard.observe_source(Some(&source));
        let mut request = BeginRequest {
            reservation_id: "old".into(),
            binding_id: source.binding.binding_id.clone(),
            effective_binding: source.binding.effective_binding.clone(),
            source_epoch: source.binding.source_epoch.clone(),
            source_revision: source.binding.source_revision,
            expires_at_wall_ms: WALL + 100,
            replaces: None,
        };
        assert_eq!(guard.begin(&request, MONO, WALL), BeginOutcome::Accepted);
        guard.advance(MONO + 100);
        request.reservation_id = "new".into();
        request.expires_at_wall_ms = WALL + 200;
        request.replaces = Some(
            terminal_identity(guard.fact()).expect("explicit advance created expired terminal"),
        );
        assert_eq!(
            guard.begin(&request, MONO + 100, WALL + 100),
            BeginOutcome::Refused(Refusal::RetirementUnconfirmed),
            "an expiry terminal is retained while queued input has no watermark"
        );
        assert!(
            matches!(guard.fact(), TrialFact::Expired { reservation_id, .. } if reservation_id == "old")
        );
    }

    #[test]
    fn backwards_monotonic_release_retains_suppression_and_never_observes() {
        let source = source();
        let mut guard = ShortcutTrialGuard::new();
        guard.observe_source(Some(&source));
        let request = BeginRequest {
            reservation_id: "r".into(),
            binding_id: source.binding.binding_id.clone(),
            effective_binding: source.binding.effective_binding.clone(),
            source_epoch: source.binding.source_epoch.clone(),
            source_revision: source.binding.source_revision,
            expires_at_wall_ms: WALL + 1_000,
            replaces: None,
        };
        assert_eq!(guard.begin(&request, MONO, WALL), BeginOutcome::Accepted);
        guard.physical_edge(&edge(&source, EdgeKind::Press, WALL + 10, MONO + 10));
        assert_eq!(
            guard.physical_edge(&edge(&source, EdgeKind::Release, WALL + 20, MONO + 9)),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(
            matches!(guard.fact(), TrialFact::Unknown { reservation_id, .. } if reservation_id == "r")
        );
    }
}

// These guard regressions exercise safety without claiming native callback integration.
#[cfg(test)]
#[path = "trial_admission_races.rs"]
mod trial_admission_races;
#[cfg(test)]
#[path = "trial_malformed_edges.rs"]
mod trial_malformed_edges;
#[cfg(test)]
#[path = "trial_rearm.rs"]
mod trial_rearm;

#[cfg(test)]
#[path = "trial_retirement.rs"]
mod trial_retirement;
