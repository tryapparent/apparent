# Failed-head completion receipts

`verification.yml` keeps manual Linux verification and separately handles
`workflow_run: completed`. A same-repository PR with an unsuccessful Actions
workflow receives a bot comment when each current workflow attempt finishes,
including later successful workflows. T3's existing PR comment watch can deliver
that event after it has already reported an early failure; no T3 fork or polling
service is involved. Green heads rely on the ordinary check watch.

The notification job checks out its trusted default-branch workflow revision,
never PR code or artifacts. Only that job can write PR comments. It validates the
head/repository, ignores superseded runs, rechecks open PRs and deduplicates each
run/attempt. The contract test inventories all PR orchestrators and their names.

Receipts describe one completed workflow, not complete CI or merge/release
admission. They cover same-repository PR Actions workflows, not fork PRs,
external checks, other PRs, main publication, deployments or capacity recovery.
API failures fail the notification job. Existing admission checks remain required.
The listener becomes active only after the workflow lands on the default branch;
unit tests and workflow syntax checks do not establish hosted delivery.
