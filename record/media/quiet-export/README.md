# Quiet-export policy

`src/export/quiet-export.bend` owns detector defaults, reading-time margins, semantic
timeline protection and accelerated-interval decisions. The existing real CLI
export caller consumes the worker and its compiled Bend module. Clocks cross the
worker as decimal strings and Bend receives two u32 words per timestamp.
Only timing facts cross the private held-input boundary; transcript text, paths
and user configuration are not part of the request. Input serialization stops at
16 MiB, replies at 16 KiB, with the existing process-group cleanup and ten-second
deadline. Empty observed intersections retain the cheap native no-work path.

Staging generates `export/parameters.json` from the same Bend module.
Native composition reads this finite regular resource before encoding; it does
not retain a second set of detector defaults. Rust keeps media observation,
timestamp parsing, encoding, atomic publication and the existing bounded 4×
retiming/badge primitive. Its 64-interval ceiling and supported rate are supplied
as native execution limits. Menu export and `--no-speedup` preserve recorded
timing without invoking this policy. Other export planning remains migration debt.

The real package check exercises seven synthetic exports: pacing, explicit real
time, sparse cursor samples, audible audio, protected marks, and two audio-level
controls. It checks source-clock intervals, actual durations, stream presence,
decoded pixels and unchanged source/config bytes. `--proof-dir` also retains
synthetic MP4s and contact sheets. Mac and AppImage acceptance remain separate
from headless policy proof; none of these file tests establish live capture.

Rollback restores the native caller/policy and removes the host, worker and compiled Bend module plus the
generated parameter resource from staging and prerequisite inventories together.
SDK pins, persisted schema, configuration mutation and installed controls are
unchanged. This is policy adoption, not whole-Record build independence or a
measured build-speed improvement.
