# Native shortcut trial safety

`trial.rs` preserves one non-recording reservation, its original registration
selectors and one terminal predecessor. The native owner must serialize coherent
source observation, expiry advancement, GUI revision fencing and admission.
Only trusted physical press/release callbacks qualify observation. Dispatch
acceptance, IPC commands and missing events do not.

Cancellation, expiry and source invalidation retain a bounded input tombstone.
Matching presses stay suppressed until a trusted matching release; callbacks
whose occurrence precedes that release remain suppressed even if delivered later.
Untimed callbacks for the retired registration fail closed. Malformed or stale
releases cannot clear held ownership, and queued edges keep their original
admitted selectors rather than a refreshed GUI revision. Terminal trial evidence
is never rewritten to idle or observed by cleanup.

A release can permit a later ordinary capture shortcut; it does not prove queue
retirement for another trial. Rearm after cancellation, expiry or invalidation
remains refused until the native producer can prove both a callback delivery
watermark and authoritative held state for the exact registration and chord.
The current Carbon and command-notification routes do not provide that proof.
Only an already observed press/release pair permits exact terminal replacement,
with a fresh reservation ID and current coherent selectors.

This is an internal std-only safety mechanism, compiled and tested with the root
application. No OS callbacks, GUI commands, public shortcut-trial capability,
Record/Onboarding activation or installed route are wired by this slice. The
separate prepared transport and Carbon source stay on their existing branch until
their integration and Linux/Mac physical-input gates pass. Actual source admission,
callback normalization, interception, queue ordering and platform proof remain
required before any usable native trial claim.
