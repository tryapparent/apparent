# Hosted performance benchmarks

Scored batches run on the standard GitHub-hosted Ubuntu 24.04 x64 runner in
`tryapparent/apparent`. The workflow is manual and has no PR trigger. Use
published, reviewed commits containing only safe synthetic benchmark work.

```sh
git fetch origin main
control=$(git rev-parse origin/main)
gh workflow run performance-benchmark.yml --repo tryapparent/apparent \
  --ref main -f stream=handoff -f control="$control" -f candidate="$control"
```

Equal SHAs request same-build calibration. Pass a full candidate SHA for a
same-job calibration followed by a matched control/candidate/candidate/control
comparison. Use a control reachable from `main` and a candidate reachable from
a branch in the canonical repository. The workflow and adapter run from the
reviewed dispatch revision on `main`. Pin the workflow SHA, exact run and
attempt along with the product SHAs when citing a result.

Download the run’s `performance-evidence` artifact:

```sh
gh run download RUN_ID --repo tryapparent/apparent \
  --name performance-evidence --dir EVIDENCE_DIRECTORY
```

`gateway.json` records the reviewed entrypoint, revisions, runner image,
CPU topology and map, guest CPU counters including steal, and guest Linux
pressure before and after the adapter. The enclosing physical host and its
sibling map are outside the GitHub VM's visibility. The owner’s measured
intervals and unchanged guards govern score qualification. Missing or unusable
probes must surface as an invalid run or an explicit qualification blocker.

## Register an owner adapter

Keep the executable adapter and documentation with its value stream. Add
the reviewed route to `routes.json` and its stream ID to the workflow's
choice list in one narrow registration patch. The gateway takes no
operator-provided program, flags, runner label or artifact path.

The adapter invocation is:

```sh
node OWNER_ENTRY.ts CONTROL_CHECKOUT CANDIDATE_CHECKOUT EVIDENCE_DIRECTORY
```

The three paths are absolute. The detached product checkouts have Git history.
Equal SHAs share one checkout. The adapter runs from the workflow checkout
using Node 22.23.0. It owns any additional pinned prerequisites, build
preparation, pressure and resource gates, verified synthetic outputs,
calibration and matched repeats. Keep build outputs and scratch outside the
evidence directory. Write sanitized logs, receipts and traces underneath
that directory as the workflow uploads it even after an ordinary failure.
Exit nonzero if setup, measurement or qualification fails. Keep physical
acceptance independent and identify each effect substitute in the owner guide.
