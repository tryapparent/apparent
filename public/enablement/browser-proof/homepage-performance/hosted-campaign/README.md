# Public hosted campaign scoring

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
