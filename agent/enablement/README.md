# Agent verification

## Context experiment comparison

Build the development CLI and prepare its normal media/transcription prerequisites
first. The comparison requires Node 22.18+ and existing bundles with video; it
never selects a personal capture set, records a screen or plays audio.

On Clanker, invoke the scenario through the shared build runner:

```sh
/home/simon/.local/bin/t3-build --jobs 2 -- node --experimental-strip-types \
  agent/enablement/context-comparison.ts \
  --experiment agentContext /absolute/synthetic.apparent
```

Use `--binary /absolute/apparent` to select another already built CLI. The default
is the repository's `target/debug/apparent`; rebuild after Rust changes.
Output defaults to a private `/tmp/apparent-dev-agent-eval-*/report/` directory.
`--out` selects a fresh directory with an existing parent, outside source bundles.
All generated artifacts are disposable under the workspace's temporary-data rules.
The command prints the index path; existing output is never overwritten.

The helper reprocesses every supplied bundle twice, with and without the selected
experiment, retaining both runs' contact sheets and frames. Both text summaries
come from the baseline run's transcript so a second transcription cannot create a
false difference. Each summary points back to its original absolute bundle path.
Inspect `index.md`, both summaries and the images; this is a manual comparison,
not automatic visual acceptance. Facts recorded live, such as accessibility labels
and page events, are kept as recorded and cannot be reconstructed afterward.

The baseline uses a private copy of `APPARENT_CONFIG` (or the normal config file)
with only `experiments` removed. It preserves unrelated options and never writes
the real config or source bundles. CLI logs stay in the private temporary job.
A failed comparison is listed in the index, returns nonzero and is not retried;
other explicit inputs can still complete. Partial reports and private logs remain
for diagnosis; retry with a fresh output directory. Owned intermediate bundles/config are
removed before return. No app restart, activation, publication or release occurs.

[Test cleanup ledger](test-audit/README.md) records audit decisions, probes and limits.
