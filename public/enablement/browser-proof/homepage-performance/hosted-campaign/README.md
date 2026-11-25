# Public hosted campaign scoring

Equal-SHA dispatches capture post-build idle guest CPU PSI and an unscored
A/B/B/A harness diagnostic on the same Chromium and package. Each replay
contains quiet and detailed cold/warm observations with real clipboard
verification. Its receipt separates the timed navigation from observer work.
B waits outside each measured interval for two consecutive 200 ms samples at
or below 2% CPU pressure, capped at six samples. Diagnostics stay outside the
scored campaign.

Hosted replay seats the harness and Chromium in a dedicated guest cgroup.
Root and cgroup CPU counters attribute CPU separately from unrelated work.
An accepted block allows at most one quarter of one CPU outside that group
over each measured wait, plus measured counter-read uncertainty. Observed
negative lag between the guest and scope counters has its own bound of one
guest clock accounting unit per logical CPU, plus measured read uncertainty.
This bound does not increase the positive unrelated CPU allowance. Observed
guest steal or cgroup throttling rejects the block. The guest-minus-cgroup
I/O pressure lower bound must stay within 2% plus counter-read uncertainty.
Total guest CPU PSI is diagnostic in hosted receipts. The local replay keeps
its 2% aggregate CPU PSI gate. Calibration also captures a real cgroup proof
with a bounded synthetic CPU worker outside the benchmark scope.

To score the hosted campaign across jobs, use the downloaded and independently
verified evidence directories in a ledger beside the artifacts:

```json
{
  "calibration": "run-100/attempt-1",
  "unscoredEffort": [],
  "experiments": [
    {
      "hypothesis": "One specific performance change",
      "effort": [{"start": "2026-11-24T19:00:00Z", "end": "2026-11-24T19:10:00Z"}],
      "evidence": "run-101/attempt-1"
    }
  ]
}
```

```sh
node public/enablement/browser-proof/homepage-performance/campaign.ts "$JOB/hosted-ledger.json"
```

Each bracket supplies its own exact runner identity, same-build repeats and
render proofs. The browser version, viewport, scenario and probe must match the
frozen calibration. The candidate's campaign score is the incumbent score
multiplied by the matched B/A ratio from that job. Both individual pairs and
the aggregate must clear the larger of the frozen and same-job repeat
variation in campaign speed units. The receipt retains each raw millisecond
measurement and the job-local score. Resource guards use the paired A samples
and the same-job calibration allowances. Count only active effort from the
ledger. A timing or infrastructure failure belongs in diagnostics. A qualified
bracket that fails a resource guard stays in the ledger as a rejected idea.

The synthetic regression for cross-job normalization and stop inputs is
`node --test public/enablement/browser-proof/homepage-performance/campaign.test.ts`.
