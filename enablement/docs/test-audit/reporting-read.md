# Reporting-read fixture audit

Observed while pushing the combined Record candidate `e59f95175`: the real
socket case failed at fixture `chmod` before reaching the product transport.
The valid private `TMPDIR` produced a 110-byte Unix socket path. A bounded
standalone reproduction with Node's real server created `capture.so` instead of
`capture.sock`; chmod of the requested pathname failed with `ENOENT`.

Read `prerequisites/reporting-read.ts`, its Mac Storage native caller and the
actual Electron `runtime.cjs` exchange/reporting adapter before judging the
21 test cases. Keep the socket test: it is the only case here observing the
shipped transport's real request bytes. It is not replaceable with mocked reads.

F: allocate its synthetic HOME directly under private
`/tmp/apparent-dev-reporting-read-<random>` instead of nesting inside `TMPDIR`.
The resulting socket path is 83 bytes, within both Darwin and Linux limits.
Existing ownership, 0700 directory/0600 socket modes and owned cleanup remain.
No product path policy, timeout, backoff, assertion or retry admission is relaxed.

D: remove fixture-only set/click mocks, their always-zero counters, and the unused
bridge return field. Production receives only the read callback; those mocks
were unreachable and could detect no mutation regression. Keep every read-count
check. The real socket case still requires exactly two requests, only `deadline`
and `errorReporting` keys, `errorReporting: read`, and safe-integer deadlines.
Test/support delta: -5 lines; no declarations or independent contracts removed.

| Cases | Retained contract / realistic regression |
| --- | --- |
| CommonJS native-driver load | R: the native CJS driver cannot load the shared TypeScript helper |
| transient busy | R: one-shot rejection replaces the permitted busy read; retain both observations and exact read count |
| persistent busy; overall budget cap | R: repeated busy gets fresh budgets or loses the first failure cause/observation |
| all eleven non-busy responses | R: other errors, wrong values, extra keys or invalid states poll into a false pass |
| thrown transport failure | R: original error is hidden or retried |
| pending read and later success | R: timeout is overwritten or a late result changes its receipt |
| late connected response | R: elapsed deadline is accepted before the timer callback fires |
| retry request time | R: read execution time is excluded from the original deadline |
| expired admission | R: any read is dispatched after the overall deadline |
| real socket transport | R: shared helper/adapter emits a set/other action or loses bounded native read semantics |

GREEN: all 21 cases pass under the same long `TMPDIR`. Independent review also
passed all 21 cases and found no lost guard or path portability issue. Copied
helper/runtime negative controls fail the retained tests when busy stops being
retried, an expired deadline admits a read, or the wire adapter emits `set`.
Unmodified/restored controls pass. Production was not edited.

Disposable proof: `/tmp/apparent-dev-media-package-audit-jbRFze/push.log`
(original hook failure), `reporting-pruned-green.log`, and reporting probe logs.
The source reproduction showed truncation; this was not an observed cleanup race.
The full normal hook still must pass after this repair. Other Enablement areas
remain unaudited; this is a bounded prerequisite/fixture cleanup, not lane completion.
