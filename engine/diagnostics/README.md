# Native exit diagnostics

Linux application launches run under `engine/diagnostics/supervisor.rs`. Its
separate process records the child's exit code or signal, core-dump flag, start
and exit times, runtime, original build/release identifiers and last recognized
recording stage. A native event loop returning during an active capture is a
failure. The monitor forwards stderr without storing or uploading its contents;
only fixed stage markers enter diagnostics. It does not produce a native stack.
CLI-only commands and macOS are not supervised.

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
