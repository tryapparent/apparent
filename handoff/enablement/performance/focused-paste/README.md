# Linux Paste Last to a focused transcript draft

Dispatch the reviewed `handoff-focused-paste` route on the standard
[`ubuntu-24.04` gateway](../../../../enablement/timing/hosted/README.md).
Both product commits must be published. Equal SHAs run a four-arm
same-build calibration. Distinct SHAs run the same calibration followed by
control/candidate/candidate/control in the same job.

The adapter builds both Linux desktop revisions with the normal locked Cargo
release profile and stages the exact binaries. A bounded KVM guest boots a
minimal Ubuntu root filesystem with real Hyprland 0.56, one virtual output,
and no network device. The app uses its default XWayland hosting and actual
Wayland clipboard. The independent GTK editor uses Wayland. Shell IPC
readiness must identify the exact GUI child of the launched binary. The
synthetic editor has no submit action, and the witness counts Enter separately.

Each arm starts fresh app and editor processes. It verifies a warmup, five
normal replays, one double invocation inside the product’s 400 ms debounce,
and one clipboard replacement. `apparent shortcut paste` is the executable
behind the registered desktop hotkey. The benchmark starts before invoking
it and stops at the editor’s native text-buffer change, using the same guest
monotonic clock for both. It checks the focused editor and exact accumulated
bytes, then independently reads the actual Wayland clipboard. For the
replacement case only, an app-private helper replaces the selection during
the clipboard type query. The app must refuse paste and leave the new
clipboard intact. The fixture checks the bytes of the saved bundle manifest
and contact sheet after every attempt.

The receipt reports per-arm normal medians and ranges, maximum absolute
calibration pair spread, paired savings in milliseconds, and process CPU and
RSS. Both savings must exceed that run’s calibration spread. Each action has
absolute limits of 250 ms app CPU and 384 MiB RSS. Candidate medians may use
at most 10% more CPU plus one guest clock tick and 10% more RSS plus 16 MiB.
The dedicated hosted measurement service uses the existing Handoff guard
for unrelated runner CPU, steal, I/O pressure and throttling over the guest
run. Raw trials also retain guest counter snapshots around the action.
The guest is limited to four vCPUs, 3 GiB memory and 150 seconds, with a
separate service lifetime. The workflow artifact retains binary hashes,
console, raw trials, comparison, and interference evidence.

The endpoint covers the genuine Paste Last action through exact draft
acceptance. It bypasses physical key entry and uses a synthetic saved capture
and editor, so it does not qualify keyboard registration, recording capture,
visual attachments or another client. Keep its version and raw milliseconds
separate from the destination picker and dispatch-receipt history.
