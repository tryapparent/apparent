# Capsule motion

Read this before changing the capsule's animation (`capture/desktop/ui/lab.rs`, `capture/desktop/ui/motion.rs`, `src/native/`, `desktop/perf/pill/`).

## Capsule motion loop (`capture/desktop/ui/lab.rs`, `capture/desktop/ui/motion.rs`, `desktop/perf/pill/`)

`apparent lab pill <tap-then-area|tap-then-window|tap-then-screen|picker|finish|cancel|dismiss> [--repeat 0] [--time-scale 0.25] [--trace f.jsonl]` replays the capsule's states over a plain backdrop with a pretend recording (no capture, mic, hotkeys, ingest or sends) and quits; `--trace` (or `APPARENT_MOTION_TRACE`) writes every frame's capsule, child boxes (`chip:Area`, `lead`, `close`…), `content.blur/alpha`, `shell.width` and `phase:*` events as motion-lint JSONL.

`capture/desktop/scripts/perf/pill/record.sh <binary> <dir> [--time-scale 0.25] [scene…]` records each scene (trace + 60 fps screen clip) and runs motion-lint (`capture/desktop/scripts/perf/pill/motion-lint.config.json`). It records the real screen, so run it on the MacBook Pro under `/tmp/pro-gui.lock`, never on the Studio: `capture/desktop/scripts/perf/screen-guard.sh` refuses there, and nothing may wake a display (no `caffeinate -d`/`-u`); `bun ~/code/open-source/motion-lint/cli/motion-lint.ts baseline <before> <after> --config capture/desktop/scripts/perf/pill/motion-lint.config.json` diffs two runs, and `uv run capture/desktop/scripts/perf/pill/clips.py before.mov after.mov out [--slow 4] [--strip-at s]` stacks labelled before/after clips and a frame strip. Look at the frames too: an invisible capsule has no motion to flag.

Springs and fades live in `motion::Tune`; `apparent tune list|set <key> <v>|preset <1-5>|reset` edits `~/.config/apparent/tune.json` (`$APPARENT_TUNE`), which dev builds, the installed app included, reload within 250 ms, and `apparent tune rust` prints the values to paste into `Tune::DEFAULT`. One animation clock (`motion::now()`, scaled by `timeScale`); springs advance to now as each capsule frame draws (`step_island`).

## Recording input visualization

The recording pill shows about one second of actual captured microphone history:
24 narrow rounded strokes in a 66×28 pt region, oldest left and newest right.
Engine reduces the existing 16 kHz mono capture PCM into overlapping 80 ms RMS
windows at 40 ms spacing (RMS × 4, bounded to 0–1). This native signal reduction
avoids moving raw PCM through presentation IPC. It opens no extra stream and
changes no permission or device selection. Quiet speech uses a power-0.55 gain
curve with a bounded 1.15 multiplier; overlapping windows give a short natural release. Silence becomes dots.
This is an amplitude display, not a speech or microphone-health verdict.

Samples older than 250 ms read as zero. A busy capture buffer is skipped rather
than blocking capture; the pill reserves its waveform footprint and shows zero.
Desktop TypeScript owns Electron gain/geometry and a 300 ms transport expiry in
`ui/frontend/src/pill/meter-policy.ts`. It never appends synthetic timer samples.
Reduced motion, from either OS media query or native readback, keeps fixed dots
and indicates current input through opacity. The retained Mac Metal/Glass adapter
projects the same signal history and gain into native raster geometry, with no
additional history buffer or animation policy. Existing inline microphone
warnings remain authoritative and independent.

Routing stays unchanged: Mac Electron controls still require non-Glass plus
`movableRecordingControls`; Glass and failed/unavailable Electron retain native
controls. Both receive the same capture history. Linux's native GPUI fallback
retains its existing meter. Rollback is the existing native fallback; removing it
still requires accepted Electron routing and platform proof. This slice moves
Electron meter policy out of the Rust coordinator into Desktop TypeScript,
without changing capture policy or preferences/persistence. Native fallback
raster geometry remains until its Electron replacement is accepted.
