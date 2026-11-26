# Native exit diagnostics

Linux application launches run under `engine/diagnostics/supervisor.rs`. Its
separate process records the child's exit code or signal, core-dump flag, start
and exit times, runtime, original build/release identifiers and last recognized
recording stage. A native event loop returning during an active capture is a
failure. The monitor forwards stderr without storing or uploading its contents;
only fixed stage markers enter diagnostics. It does not produce a native stack.
CLI-only commands and macOS are not supervised.

`native_exit.last_finish_phase` records the latest observed Finish milestone:
source shutdown, bundle setup, bundle building, publication, or return from the
bundle finalizer. The milestone is process-wide and can reflect overlapping
Finish workers. Return records that the finalizer returned either result.
A missing milestone is unknown. The new field does not affect error grouping.

`native_exit.recent_steps` preserves up to eight allowlisted checkpoint
transitions with monotonic milliseconds since observation began. It lives on
the exception and has no separate ingestion or session identity. Phase and
step history are cleared when the reporting generation changes.

For Linux SIGKILL, `native_exit.cgroup_oom_kill_increased` is an optional
boolean comparing the local OOM kill counter of the cgroup observed for the
recorder at consent admission with the same counter at exit. The cgroup may
contain other processes, and the recorder may move to a different group.
The boolean describes only the observed group over the sampling interval.
When the counter is unavailable the field is null. The cgroup path, counter
value, and kernel log are kept out of the report.

With reporting enabled, private `native-errors/*.json` files beside config retain
pending native diagnostics across crashes and failed delivery. Live setting
changes apply within one second; a consent generation change discards prior
stage context. Consent is checked again before delivery. Relaunch retries at most
four pending records, keeps at most sixteen inactive records and expires them
after seven days. Each record has a stable event UUID for retry deduplication.
PID start times prevent a live recorder or a reused PID being mistaken for a
crash. If both monitor and recorder disappear, the next launch reports an
interrupted supervision with unknown exit status, not a claimed signal.

Engine owns the native process/durability mechanism. The existing native reporting
adapter injects consent, transport and cooperative-shutdown capabilities; Engine
does not import product implementations. The Linux launch path is the adoption
point; rollback removes that supervision call and its module while retaining the
existing reporter. Settings persistence and in-process reporting remain existing
native debt; this safety repair introduces no new preference or UI workflow.

macOS Sparkle download error 2001 can include a single underlying NSError. The
existing consent-gated updater report records that cause as
`updater.sparkle_cause` with an allowlisted domain category and numeric code.
Sparkle can omit the cause or use another generic 2001 for an HTTP failure.
The report includes neither descriptions nor HTTP status parsed from text.
The outer error fingerprint remains stable across the added evidence.
