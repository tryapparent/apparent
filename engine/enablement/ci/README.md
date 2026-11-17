# Engine CI

Automatic PR and main runs select non-Markdown changes under `engine/` only.
Hooks, shared/root enablement, unknown roots and workflow-only changes do not
start native production. `workflow_dispatch` explicitly qualifies the selected
revision even without an Engine delta; it does not publish.

PR native checks use Linux x64 and arm64. Main and manual qualification retain
Linux x64/arm64 and macOS Intel/Apple silicon. Only main push runs publish, after
all native jobs and the independent SDK check pass. Mac availability can delay
Engine publication, but must not be a PR admission or another stream's delivery
prerequisite. Later Mac regression detection is accepted for PR merges.

`inputs.ts` owns selection and publication continuation. Both use the same narrow
Engine input contract without a global fallback. PR merge refs compare against
their first parent. Missing history fails selection; manual qualification needs
no range. Publication requires candidate ancestry and rejects any intervening
Engine input changes, while allowing unrelated main pushes.

`artifacts.ts` requires exactly the SDK and all four native archives with matching
digests and clean candidate/platform manifests before the existing immutable
release path runs. Partial Linux-only output cannot publish. Producer qualification
and artifact upload failure remain blocking publication gates.

Run `bun test engine/enablement/ci/ci.test.ts` for focused routing, workflow and
publication contracts. These tests do not build native packages or establish
hosted execution savings. The prior `engine/tools/select.ts` donor is removed;
global coordination must consume this owner's contract rather than recreating a
broad Engine fallback. Revert workflow and owner tooling together for rollback.
