## Opt-in push receipts on Clanker

Allocate a fresh UUIDv4 and a private job directory before launching a push.
Use the absolute path `<job>/<uuid>.jsonl` as the first option to the regular
push entrypoint.

```sh
node --experimental-strip-types enablement/local-tests/execution/push.ts --runner-timing /tmp/apparent-dev-example-XXXXXX/664fe34a-e702-4d0c-a7cd-2aea660df579.jsonl --jobs 3 --min-jobs 3 -- origin HEAD
```

The launcher creates a mode-0600 schema-1 JSONL file exclusively. Each row
contains only the ID, phase and local epoch milliseconds, plus the exit code
when the pre-push verification process exits normally. The launch mark is
immediately before replacing the launcher with the installed runner. The
verification span covers local selection and its selected checks, after the
hook's issue and Rust checks. A killed verification process can leave an open
phase. A skipped hook or an early rejection can leave a launch-only receipt.
Use a fresh path for every invocation, including retries. Receipt I/O failure
does not reject a push.

Pass `--runner-receipts <job>` to [review collect](../review/README.md).
Use the original same-host rollout. For exact linking the launch must be a
single printed `tools.exec_command` with a literal command as above and a
literal `yield_time_ms`, or the existing literal stored-session form. The
result must be a structured execution receipt. Use the existing read-only
stored or literal session polls for waits. The collector checks exclusive
launch ownership, phase order and timestamp bounds. Mixed commands, reused
IDs and receipts outside the supplied directory receive no phase attribution.
The summary includes the tool's observed exit code when present. Its receipt
timestamp marks when the tool returned, and includes observation delay.

The push launcher uses process replacement to keep status, signals, timeout
and cleanup with `t3-build`. The installed supervisor owns the release of the
admission gate and the exit of the process group. It does not expose either
timestamp. Direct build invocations, transport and unobserved hook phases
retain their historical coverage. Keep receipts and rollout inputs private.
Verification durations and tool waits overlap.
