# Enablement review and dispatch preparation

Offline TypeScript tools for the six-hour analysis. T3 owns thread snapshots,
worktree binding, dispatch and scheduling; these tools never execute history,
launch work, modify CI policy or certify a native/release result.

Use the Codex-local `development-bottleneck-review` and
`enablement-improvement-dispatch` skills for judgment and transport. Source
references and raw snapshots are private. Create a private per-job
`/tmp/apparent-dev-<job>-<run>/` first; output files are exclusive and mode0600.
Small checkpoint state belongs to the invoking skill's runtime file, never Git.

## Collect and rank

```sh
node --experimental-strip-types enablement/timing/review/index.ts collect \
  --input "$HOME/.codex/sessions" --workspace /absolute/project/worktrees \
  --exclude-workspace /absolute/review/worktree \
  --from 2026-11-15T10:56:25Z --to 2026-11-15T14:31:03Z \
  --threads /private/job/threads.json --jobs /private/job/jobs.json \
  --out /private/job/aggregate.json
node --experimental-strip-types enablement/timing/review/index.ts format \
  --input /private/job/aggregate.json --out /private/job/timing.md
node --experimental-strip-types enablement/timing/review/index.ts chart \
  --input /private/job/aggregate.json --out /private/job/timing.html
```

The optional thread input is an array of supported `t3_thread_read` structured
responses (or objects wrapping them as `structuredContent`). Preserve each
page's thread/item IDs and pagination state. `reachedTail` and `hasRequestStart`
identify the captured edges; neither proves that all intervening pages or later
human steering were inspected. Recover missing original context before a finding.
Every direct web/mobile human message is a review reference, not an automatic
unnecessary-message verdict. Server/delegate notices are not human steering.
Explicit human answers to UI requests are server-transported `user_message`
items with the `async-answer:runtime-request:provider:` identity (encoded in
current snapshots). They also produce references; ordinary server notices and
inherited copies do not. Classification still requires original context.
Wait keywords produce leads only, never abandoned-owner classifications.

The optional jobs input is an array of snapshots from
`gh run view ID --json databaseId,headSha,attempt,jobs`, or the same metadata
with `runId` plus REST `jobs`. Missing job creation timestamps leave queue time
unknown. Never subtract workflow creation from job start and call it runner
queue. Review individual step timestamps to distinguish install/build/test tails.
REST queued jobs can already carry `started_at == created_at`, `runner_id:0`
and empty steps. These placeholders are queue time, not runner execution.
Cancellation before allocation ends the queue at completion; unknown allocation
in incomplete CLI snapshots stays explicitly unknown. Zero-date completion
placeholders do not make an unfinished job complete.

Tool-envelope categories and repeated wrapper patterns expose exact unrounded
`arithmetic`: complete/known clipped spans × mean seconds = summed seconds.
Rank descending by **total**, including frequent short calls. Inspect longest
source references and repeated patterns to find the actual expensive operation.
The retained rounded legacy fields are presentation compatibility only.
Process groups separately summarize recovered async spans, with p50/p95. They
end at terminal observation, can include admission/reading delay, and are not
an execution-time measurement. Polling, process spans, tool envelopes and hosted
runner seconds overlap: do not add them or call them avoidable critical-path time.
Missing endpoints, incomplete calls and unsupported providers stay unknown.
Provider-original timestamps and stable call IDs prevent copied rollover items
from becoming new incidents. Review overhead is excluded and reported separately.

## Four lenses, one shortlist

The decision schema is exported from `policy.ts`. Always examine:

- `human-dependency`: avoidable information relay, factual rediscovery, approval
  repetition or “continue” prompts. Show the original authorized outcome and
  information/authority available **before** that human message. Genuine human
  judgment, consent, access, priorities and new scope remain necessary.
- `time-eater`: measured count, mean time and total, plus overlap/coverage limits.
  Estimated avoidable time is separate; long necessary proof is not automatically waste.
- `confusion-maintainability`: observed wrong turns/rework caused by contracts,
  naming, boundaries, copied examples, dependency fan-out or maintenance debt.
  A large file or similar names without an observed consequence are hypotheses.
- `feedback-gap`: missed completion, late/ambiguous feedback, stale ownership or
  claims of “done” without the accepted outcome. Preserve genuine waits/holds.

Write a JSON `Decision` with `window`, all four `examined` categories, `auditRef`
and at most three combined `findings`. Each finding requires source evidence,
consequence, cause hypothesis and alternatives, bounded scope, smallest
intervention, verification, confidence, owner audit and explicit holds inventory.
No findings is valid. Human-relay findings also require explicit judgment and
information-availability evidence; information discovered later is not proof it
was already available. Review actual producer/consumer code and original records.

## Scoped checkpoint and dispatch intent

Every state command below takes `--state /absolute/skill/runtime.json`.

| Command | Other arguments | Effect |
|---|---|---|
| `init` | `--scope repo-and-thread --since ISO` | Initialize once; never overwrite another loop's checkpoint |
| `begin` | `--run-id stable-id --end ISO` | Freeze the next interval; another review cannot take it |
| `commit` | `--run-id stable-id --decision file.json` | Validate successful analysis, advance cutoff, preserve active delivery |
| `abort` | `--run-id exact-id` | Release only that interrupted review; cutoff stays unchanged |
| `show` / `plan` | none | Inspect state or a side-effect-free dispatch plan |
| `prepare` | `--key finding-key` | Reserve one improvement with a stable transport request ID |
| `record` | `--request-id id --receipt file.json` | Retain actual `threadId`, `link` and completion `route` |
| `delivered` | `--request-id id --receipt file.json` | Record verified `mergeSha`, `checksRef`, `outcomeRef`, and benefit status |
| `benefit` | `--key finding-key --receipt file.json` | Retain later before/after count × mean = total, same clock, evidence `reference` and `comparableConditionsRef` |

Dispatch planning never sends messages. Before transport, use live supported T3
reads to verify current authority, writers, holds and completion routes. Active
owners get reuse, not a second thread or a progress nudge. Unknown ownership,
unsupported causes, holds, a previous key or an occupied slot prevent new work.
`prepare` persists before the launch. After a lost API reply, reuse that exact
request ID; do not launch another worker. Record the accepted owner/route after
reading the launched thread. A later six-hour review can advance its cutoff
while an improvement runs; it must not poll healthy watched work or duplicate it.

Locks are atomic and never stolen. An interrupted active review requires
inspection and an exact-ID abort/resume, not a timeout-based reset. Bookkeeping
delivery references require real source/outcome verification by the owner;
they are not test receipts or authority to waive publication/native gates.
Correctness delivery and measured later benefit are separate.
Delivery starts with `benefit:unmeasured`; a later `benefit` receipt contains
`before` and `after` Timing objects from `policy.ts`. Measurement need not show
a speedup: retain null/negative results and distinguish changed coverage/cache
or frequency from a controlled improvement. The tool checks arithmetic, not causality.

Regression command:

```sh
node --experimental-strip-types --test enablement/timing/census.test.ts \
  enablement/timing/review/review.test.ts
```
