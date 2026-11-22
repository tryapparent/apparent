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

`--jobs` accepts immutable `gh run view ID --json databaseId,headSha,attempt,jobs`
snapshots or equivalent REST snapshots (`runId` accepted). Queue starts at job
creation, ending at allocation or cutoff. REST `started_at == created_at` with
`runner_id:0` and empty steps counts as queue time. Pre-allocation cancellation
ends the queue at completion. Missing allocation or zero-date completion leaves
the corresponding clock unknown. Inspect step clocks for install/build/test costs.

Live reads use `--github-repo tryapparent/apparent --ci-run-limit 12` (1–40).
The oldest pre-window queued/waiting run per SHA keeps priority. Repeats fill
spare slots after other pending runs and completions. Unsampled run/attempt/SHA
identities have `listing-only` coverage and unknown job activity. Completions
prefer the newest run per head before repeats. `--ci-exact-attempt
RUN_ID/ATTEMPT/FULL_HEAD_SHA` reserves one slot even on failure, verifies attempt
metadata and excludes that route from ordinary sampling. Coverage reports caps,
identity mismatch, cutoff and access gaps. The window clips measured time.

Detailed zero-job snapshots retain identity, status, age and page coverage in
`analysis.joblessSnapshots`. Creation age supplies no admission, runner demand
or critical-path evidence and stays out of costs, including legacy `preJobWaits`.

`format` ranks observed operations and identified actions by **total** per
clock, showing whether mixed/unresolved time could overturn the ranking.
Exact `arithmetic` uses clipped spans: count × mean = total. Inspect longest
source references and frequent short calls. Rounded fields serve legacy readers.

The scanner reads literal commands without executing them or reporting raw
arguments. It ignores prose, patch text and inert heredoc content. Three whole
preparation lines are recognized: an assignment from
`$(mktemp -d /tmp/apparent-dev-<job>-XXXXXX)`, a quoted `test` comparing
`$(git rev-parse origin/main)` with `$(git rev-parse HEAD^)`, and
`test -z "$(git status --porcelain)"`. Dynamic and unsupported substitutions
stay unknown. A test-and-push workflow stays mixed. Waits inherit launch intent
through exact session/cell IDs. Mixed envelopes have no per-phase durations.

Compare eligible push waits using count × mean = total with matching clocks,
windows and call mixes. Track classification coverage and any measured analyst
effort separately. Identical-record replay verifies attribution; wait, build
and delivery savings require separate evidence.

CI ranks queue totals by requested runner and execution by job and step, with
exact run/attempt/SHA/job/step references. Distinguish full queue age from
clipped occupancy. Missing CI input or clocks stay unknown. Use provider
evidence to assign capacity, concurrency, dependency or approval causes.

Async spans include p50/p95 and end at terminal observation. Missing endpoints,
incomplete calls and unsupported providers stay unknown. Original timestamps
and stable IDs deduplicate rollover items. Review overhead is separate.
Polls, tool envelopes, process spans and hosted runner time overlap and cannot
be added. Critical path and blocked threads require original dependency context.

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
Later CI comparisons record detail-bearing attempts, jobless and listing-only
counts, list/job requests, and separate read and analysis times. Match windows,
limits and exact focus. Retain null or negative results.

Regression command:

```sh
node --experimental-strip-types --test enablement/timing/census.test.ts enablement/timing/operations.test.ts \
  enablement/timing/review/*.test.ts enablement/timing/review/tests/*.test.ts
```

Carried rerun jobs can have a new ID and creation time after original execution.
A unique earlier match by run/SHA, name, runner, clocks, conclusion and steps
retains original attribution. Supply earlier attempts to resolve provenance.
Unmatched prior execution is terminal with unknown queue and execution clocks.
