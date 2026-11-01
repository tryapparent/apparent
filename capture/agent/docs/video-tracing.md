# Private video-workflow traces

`apparent trace` is part of Apparent, not a separate recorder or Python tool.
It retains workflow evidence so agents can distinguish repeated CLI, skill,
controller and environment friction from confirmed product defects.

## Enable and start

The `videoTracing` experiment is **off by default**. Set
`"experiments": {"videoTracing": true}` in `~/.config/apparent/config.json`,
preserving its other keys. The next CLI invocation reads the file; no GUI restart
is needed. `APPARENT_CONFIG` selects a separate config for isolated tests.
Disabling the flag stops new trace operations, not an already admitted capture,
and does not delete retained data. It does not enable analytics or uploads.

```sh
apparent trace start whiteboard-persistence --mode live
apparent --trace TRACE_ID capture start --request-id REQUEST_ID --wait --timeout 30
apparent --trace TRACE_ID capture stop CAPTURE_ID --wait --timeout 60
apparent --trace TRACE_ID inspect /absolute/private/take.apparent
apparent --trace TRACE_ID export /absolute/private/take.apparent --out /absolute/private/share.mp4
```

Replace placeholders with exact returned IDs. Start before preparation; keep
one trace across failed takes, retries and handoffs, not one per attempt.
For a sequence of authoring commands, `export APPARENT_TRACE=TRACE_ID` attaches
them to the same trace; an explicit `--trace` overrides that environment value.
`unset APPARENT_TRACE` detaches later commands. Trace-management commands do not
trace themselves, even with this environment variable set.

Built-in authoring operations record their canonical command name, start time,
PID, elapsed command time and success/failure automatically. The trace pins the
Apparent version, OS and executable SHA-256 when started. `--trace` works before
or after the subcommand. It supports `capture`, `record`, `inspect`, `frames`,
`zoom`, `export`, `reprocess`, `retranscribe`, `recover`, `fixture`, `capture-sim`,
`decoder-check`, `encoder-check` and `skill` where those commands exist. It refuses
GUI/long-running and unrelated commands rather than tracing an unbounded app
session. Help, version and argument-parser errors exit before tracing begins.

No shell wrapper is required. Command stdout, stderr and the command's result
retain their normal contract. If a requested trace cannot start, the command
refuses **before its side effects**. If recording completion fails after the
command ran, Apparent warns on stderr but preserves the command result; a saved
capture must not look failed and invite a duplicate retry. Reconcile that trace's
unfinished event. Capture readiness and ownership rules are unchanged: an elapsed
CLI request is not the capture's entire lifetime, and a timeout does not cancel
an admitted capture. Inspect the same owned capture ID.

## Keep causes and evidence explicit

```sh
apparent trace note TRACE_ID --phase render --step export --owner skill --kind friction --text 'Observed unsupported flag; checked installed help'
apparent trace note TRACE_ID --phase render --step export --owner skill --kind recovery --text 'Used supported syntax; source unchanged'
apparent trace artifact TRACE_ID --phase prepare --step skill-source --path /absolute/path/SKILL.md --keep
apparent trace artifact TRACE_ID --phase qa --step final-video --path /absolute/private/share.mp4 --keep
apparent trace verify TRACE_ID
apparent trace end TRACE_ID --status delivered
apparent trace report TRACE_ID
apparent trace report
```

Notes cover external tools, browser/MCP actions, narration and visual QA. They do
not invent automatic timing for work Apparent did not execute. Owners (`cli`,
`skill`, `environment`, `controller`, `product`, `unknown`) are operator judgments,
not diagnoses proven by an exit code. Record a cause as unknown until evidence
separates it; recovery notes identify the workaround and its proper owner.

Register the exact skill/script, source bundle files, cues/SRT, provenance, QA
and final movie as appropriate. `artifact` hashes only an explicitly selected
regular file; it never crawls directories. Register a bundle's `apparent.json`,
`summary.md`, recording and inspected images separately. Without `--keep`, the
index references the original and **does not preserve it**. `--keep` retains a
private copy outside scratch; sources remain untouched. The per-file bound is
2 GiB. `verify` rehashes retained copies (or the original for reference-only
entries), and fails on missing or altered bytes. Hashes establish identity, not
content quality or permission to share.

## Reports, crashes and privacy

Reports contain versioned JSON, ordered events, command attempts and explicit
friction grouped by operation/phase/step/owner. Reports distinguish modes:
`live`, `observer`, `explainer`, `synthetic-test`, `historical`. A repeated
operation may be an intentional probe, not a retry. Overlapping command durations
can double-count time; they exclude agent thinking and untraced external tools.
Different builds, recording lengths or cache states are not controlled benchmarks.

A killed CLI process leaves a running event; `end` refuses unfinished attempts.
Inspect actual owned processes/capture state first, then
`apparent trace resolve TRACE_ID --event EVENT_ID --text 'Observed reconciliation'`.
Resolution records interruption without stopping a process, inventing elapsed
time or claiming success. Never resolve an attempt still executing. End states
are `delivered`, `blocked`, `abandoned`. Delivered is an operator assertion, not
whole-video inspection or proof of playable delivery. Historical imports retain
known observations/artifacts without reconstructed timings. Synthetic tests are
not native video-production results.

Storage is `~/.local/share/apparent/workflow-traces` on both supported platforms;
`APPARENT_TRACE_ROOT` selects a separate private store for testing. Directories
are 0700, data 0600. Updates serialize concurrent CLI writers and publish complete
JSON atomically. No argv, error text, command output, environment, transcripts or
capture paths are collected automatically. Explicit notes, labels, paths and
artifacts are **not redacted**: keep secrets out. Nothing is sent over the network,
automatically pruned, added to a bundle, copied to the clipboard or uploaded.
Do not publish the store or reports. Selected retained movies consume local disk.

The superseded standalone `apparent-trace` prototype is not required or invoked.
Its existing private SQLite store remains untouched; there is no automatic import
that would invent native timings or silently copy private recordings.

Verification: Rust `tracing::` and CLI parser/gating tests, plus
`APPARENT_TEST_BINARY=/absolute/path/to/apparent python3 -m unittest discover -s capture/agent/scripts/tests -p test_workflow_tracing.py -v`.
These prove local CLI/storage behavior, not native recording, visual QA or Mac
runtime. Platform proof must be recorded separately before release.
