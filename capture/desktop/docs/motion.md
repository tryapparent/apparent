# Capsule motion

Read this before changing the capsule's animation (`capture/desktop/ui/lab.rs`, `capture/desktop/ui/motion.rs`, `src/native/`, `desktop/perf/pill/`).

## Capsule motion loop (`capture/desktop/ui/lab.rs`, `capture/desktop/ui/motion.rs`, `desktop/perf/pill/`)

`apparent lab pill <tap-then-area|tap-then-window|tap-then-screen|picker|finish|cancel|dismiss> [--repeat 0] [--time-scale 0.25] [--trace f.jsonl]` replays the capsule's states over a plain backdrop with a pretend recording (no capture, mic, hotkeys, ingest or sends) and quits; `--trace` (or `APPARENT_MOTION_TRACE`) writes every frame's capsule, child boxes (`chip:Area`, `lead`, `close`…), `content.blur/alpha`, `shell.width` and `phase:*` events as motion-lint JSONL.

`capture/desktop/scripts/perf/pill/record.sh <binary> <dir> [--time-scale 0.25] [scene…]` records each scene (trace + 60 fps screen clip) and runs motion-lint (`capture/desktop/scripts/perf/pill/motion-lint.config.json`). It records the real screen, so run it on the MacBook Pro under `/tmp/pro-gui.lock`, never on the Studio: `capture/desktop/scripts/perf/screen-guard.sh` refuses there, and nothing may wake a display (no `caffeinate -d`/`-u`); `bun ~/code/open-source/motion-lint/cli/motion-lint.ts baseline <before> <after> --config capture/desktop/scripts/perf/pill/motion-lint.config.json` diffs two runs, and `uv run capture/desktop/scripts/perf/pill/clips.py before.mov after.mov out [--slow 4] [--strip-at s]` stacks labelled before/after clips and a frame strip. Look at the frames too: an invisible capsule has no motion to flag.

Springs and fades live in `motion::Tune`; `apparent tune list|set <key> <v>|preset <1-5>|reset` edits `~/.config/apparent/tune.json` (`$APPARENT_TUNE`), which dev builds, the installed app included, reload within 250 ms, and `apparent tune rust` prints the values to paste into `Tune::DEFAULT`. One animation clock (`motion::now()`, scaled by `timeScale`); springs advance to now as each capsule frame draws (`step_island`).
