# Tool-call census

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
count once; category matching is heuristic. Nested shell scripts and subprocesses
are not inventoried. Asynchronous launches are excluded from the short-call
subtotal because a quick return does not establish a quick build. Poll/wait time
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
