# Tool-call census

For the recurring four-lens analysis, scoped checkpoint and improvement-dispatch
preparation, use [review/index.ts](review/README.md). It reuses this census rather
than creating another timing authority. Every timing row exposes exact
`count × meanSeconds = totalSeconds` arithmetic; rank by total and keep tool
envelopes, async spans, hosted execution and critical-path delay distinct.

Timing `*.test.ts` files are discovered recursively by the canonical shared
contract inventory. New tests need no registration edit in `local-tests/run.ts`.

Read retained Codex rollout JSONL without a server, credentials, Rust, Electron
or extra dependencies. Stream files; write only the aggregate JSON to stdout:

```sh
node --experimental-strip-types enablement/timing/census.ts \
  --input "$HOME/.codex/sessions/2026/11" \
  --workspace-prefix /path/to/project/worktrees \
  --exclude-workspace /path/to/investigating/worktree \
  --from 2026-11-11T13:17:43Z --to 2026-11-11T16:17:43Z \
  > /tmp/apparent-dev-your-job-run/census.json
node --experimental-strip-types --test enablement/timing/census.test.ts
```

Create a private per-job temporary directory first. Inputs contain private
commands, arguments and output: keep them local. The report emits categories,
counts, normalized wrapper fingerprints and times; no command text or output.
Fingerprints use a fresh random salt per execution, grouping within that report
only. Treat reports as private operational data even with pseudonymous labels.
Scan files containing calls begun before the window as well as files created
inside it. Include all relevant dates and registered workspace roots. Report
provider/root/date coverage separately; Codex logs cannot prove an all-provider
or all-thread census. Malformed lines and orphan results are reported.

Rank categories by cumulative tool time and inspect `shortToolSeconds` and
`shortCompletedCalls` for frequent calls below five minutes. Fingerprints identify
repeat wrapper intent, **not redundant work**: inspect the owning thread's changed
inputs, results and acceptance before recommending omitted verification. Batches
count once; category matching is heuristic. A standalone `timeout` launch of a
single-quoted `bash -c` loop over literal numeric IDs is classified as one CI
observer when its only work is `gh run watch` with a literal repository and
polling interval and the loop aggregates the exit status. The matcher accepts
the observed flag order and optional literal `/tmp` log redirection. Dynamic
arguments and mixed or arbitrary nested shell bodies are outside this rule.
Attribution uses the existing exact process and cell links. Individual jobs and
nested shell phases have no separate timing rows. Asynchronous launches are
excluded from the short-call subtotal because a quick return does not establish
a quick build. Poll/wait time
is separate; it can overlap the same build and is not additive CPU work.
`correlatedProcesses` joins unbatched launches to terminal polls when a numeric
session ID survives in both records. Its observed span is an upper bound that
includes time before the terminal poll; hidden/dynamic IDs remain uncorrelated.

Elapsed times pair call/result timestamps, including transport and service
overhead. Completed durations are clipped to the window. Missing results are
censored at the cutoff; unmatched calls from before the window are counted as
unknown, not presumed active. `activeAtCutoff` includes later-completed calls.
Summed tool-seconds include concurrency;
`observedToolUnionSeconds` measures wall-clock coverage, not critical-path delay.
Run admission/queue time is unavailable and never inferred. Unsupported provider
schemas require an explicit adapter, not guessed timestamps. Use existing
`command.ts` timing receipts when command-phase runtime is required.

## Opt-in test diff report

Compare two committed trees from the repository root:

```sh
node --experimental-strip-types enablement/timing/test-diff.ts \
  --base "$(git merge-base origin/main HEAD)" --head HEAD
```

The JSON report lists added, removed, renamed and modified candidate suite
files using JS/TS test and spec names, Python `test_*.py` and Rust `tests/*.rs`.
It also surfaces other changed paths from the [audit inventory](../docs/test-audit/inventory.md),
which can include inline tests, support files and false positives. An added
file is a review lead. Changes to cases inside existing files, runner
registration and independent regression coverage need review at the owning
test boundary.

Fixture footprint is the before/after size of changed Git blobs and their net
byte delta. It covers regular files in fixture, mock and testdata directories
and files with fixture names, excluding Markdown and candidate suite files.
Git-detected renames show both paths. Inline data, generated or downloaded
fixtures, and runtime storage use are outside this estimate.

Optionally pass `--timing /absolute/path/to/timing.jsonl` with existing
`APPARENT_TIMING_FILE` observations. Use exact base/head SHAs in the receipts
and keep the invocation and environment details with the source file. For a
direct run under `command.ts`, set `GITHUB_SHA` on the wrapper to the commit
actually tested. Start rows, invalid rows and rows without a matching revision
are counted separately. Absent observations mean timing is unavailable.
Durations cover the recorded commands, which can include setup, parallel work
or retries. Compare like commands under like conditions before drawing cost
conclusions. This command is for review and runs outside CI and admission.
