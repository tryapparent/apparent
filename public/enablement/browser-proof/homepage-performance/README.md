# Public homepage performance

The scored wait starts at Chromium's top-level navigation time origin and ends
when the browser reads the exact Apparent setup prompt back from its clipboard.
A real pointer click goes through the production Copy Prompt button. The replay
requires the visible Copied state and seeds a different clipboard value before
each attempt. The prompt is public product text. The browser's ephemeral
headless clipboard is the named substitute for a desktop OS clipboard. The
replay neither installs anything nor contacts an agent.

## Hosted scoring

Dispatch the shared performance gateway from main with stream `public` and full
`control` and `candidate` SHAs. Equal SHAs request calibration only. The gateway
calls this from its reviewed checkout on standard GitHub-hosted Ubuntu 24.04:

```sh
node public/enablement/browser-proof/homepage-performance/hosted.ts \
  "$CONTROL_CHECKOUT" "$CANDIDATE_CHECKOUT" "$EVIDENCE_DIR"
```

Supply detached absolute checkout paths, a private existing evidence directory,
and Node 22.23.0. Public provisions Bun 1.3.10 if needed and installs its pinned
Chromium with Ubuntu dependencies. Builds use Git archives in runner scratch with a tool allowlist that excludes Rust.
The adapter times two independent same-build controls and alternating probe
orders, then runs A/B/B/A serially on the same runner. Desktop and small-phone
dark replays verify candidate output. The evidence contains exact commands,
timing receipts, browser traces and waterfalls. Hosted qualification uses
guest CPU attribution, observed steal, throttling and unrelated I/O.
Total guest CPU PSI and vCPU topology remain diagnostic. Hypervisor host
PSI is unavailable.

To recompute the single-job comparison from an extracted artifact:

```sh
node public/enablement/browser-proof/homepage-performance/campaign.ts \
  "$EVIDENCE_DIR/public/comparison-ledger.json" --compare-only
```

This evaluates all matched guards and the local speed decision. It records no
active effort and cannot trigger campaign stop. Keep Clanker scores historical.

Use the [hosted campaign ledger](hosted-campaign/README.md) to combine matched jobs
and evaluate the shipped stop rule.

## Local diagnostic replay

Build the standard Public package using Node 22 and the locked dependencies.
These commands work in a private checkout or Git archive. Keep diagnostic
outputs outside the Pages artifact.

```sh
cd public/site
bun install --cwd .. --frozen-lockfile
../node_modules/.bin/playwright-core install chromium
npm run build
node ../enablement/site-build/package-apparent.mjs
```

From the repository root, the owner command serves the supplied package on an
ephemeral loopback port, drives Chromium, verifies the waits and emits raw
milliseconds, a score and the absolute receipt path.

```sh
node public/enablement/browser-proof/homepage-performance/homepage.ts \
  --artifact public/site/dist-apparent --revision "$(git rev-parse HEAD)" \
  --output "$JOB/public-proof" --runs 5 --mode quiet \
  --control "$JOB/control-one.json" --control "$JOB/control-two.json"
```

Use a fresh private output directory and set `JOB` to its path. On Clanker, use
the private per-job directory prescribed by the host instructions. Use two
independent quiet invocations of the same frozen build to produce the
control receipts referenced above. Use a separate `--mode calibrate` invocation
to interleave detailed and quiet observations in alternating order. Each context measures a cold
navigation with a new browser context before a warm reload in the same
context. Browser startup and seeding at a separate loopback origin precede the
timer. The warm reload reuses the normal browser HTTP cache subject to ETag
revalidation. The action includes a fixed automation protocol and excludes
human dwell. A standalone qualified run without `--control` uses itself as the
reference and gives 100. The mean of both frozen quiet medians is 100 for the
campaign. Lower is faster.

The receipt contains the package SHA-256, source SHA supplied by the caller,
probe SHA-256, Chromium version, Linux runtime, CPU affinity, viewport, theme, endpoint
checks, browser process CPU, end-of-wait sampled aggregate PSS, transfer
bytes, and total artifact bytes. Build the artifact from the named revision
and preserve the build provenance with the receipt. The loopback server reads
the package into memory before timing and uses HTTP/1.1, gzip for text,
conditional GET and byte ranges for video. DNS, edge/CDN latency, compression
negotiation and the Pages worker are outside this timing path. The destination
tests under `../../pages` cover the actual compiled Pages worker. An external
GitHub stars GET receives a fixed count. The exact YouTube demo embed and Bunny
terminal font stylesheet are blocked. Chromium cannot resolve other external
hosts and the fixture rejects unexpected HTTPS requests. No analytics are
sent. This scenario does not measure availability, playback or layout from
those providers.

Linux CPU pressure over 2% during any measured wait disqualifies its entire
cold/warm block. Calibration also requires both probe modes in the block to
qualify. Use an otherwise quiet host, keep CPU affinity constant across runs,
and run builds and browser experiments sequentially. `--max-blocks 25` allows
bounded replacement of rejected blocks. The command uses the first requested
number of eligible blocks and keeps every observation in the receipt.
Rejected blocks have no score and cannot count as hypotheses.
Process CPU excludes the harness and includes only Chromium processes still
present at the sample. PSS is a sample, not a time-series peak.

## Trace and frame pacing

Detailed mode emits a Chromium trace and a standalone HTML waterfall per
attempt. Use `--mode trace --runs 1` for diagnosis or `--mode calibrate` to
measure trace overhead in paired observations. Only the quiet path feeds the
campaign. The waterfall uses the trusted click User Timing mark to align
Chromium's trace clock to the document clock. It shows Navigation and Resource
Timing, renderer parsing, script, style/layout, paint, observed UI action and
independent clipboard readback. A mutually exclusive partition lists every
active label with overlap and uninstrumented time. Nested browser slices can
overlap by design. Resource Timing exposes entries that finished by collection
time, and renderer spans represent the main thread. Full Chromium tracing
retains other processes and threads. The browser's FCP, heading visibility,
Copied locator and exact clipboard are separate observations. Locator delivery
and verification introduce scheduling delay. Inspect the screenshot and
Chrome trace for visual evidence rather than inferring presentation from the
DOM check alone.

After both navigation waits in a detailed context, the probe scrolls to the
first packaged feature demo. It verifies the themed scene and decoded image,
then requires advancing video frame callbacks and the visible change produced
by the bundled demo. Frame-pacing summaries share the existing motion probe's
percentiles and hitch counters. The demo uses the built page's own playback
and scroll behavior. Its independent diagnostic includes authored animation
delays. Use `--size phone` or `--size small-phone` and `--theme dark` to check
responsive variants. The mobile check verifies the actual semantic sketch
that the product shows in place of desktop animation.

## Campaign ledger

Supply the two quiet/calibrated control receipt paths, followed by experiments
with absolute A/B/B/A receipt paths. A is the current incumbent and B is the
single candidate. Each experiment includes its independently verified quality
evidence and actual active-effort intervals. Log investigation time that
should count toward the windows without counting as a hypothesis under
`unscoredEffort`. Preserve incomplete, invalid and build-only results in the
operator evidence and omit them from `experiments`. Use nonoverlapping ISO
timestamps for effort. Leave gaps for time blocked on capacity, builds and
approvals.

```json
{
  "controls": ["/path/control-one.json", "/path/control-two.json"],
  "unscoredEffort": [],
  "experiments": [
    {
      "hypothesis": "One specific performance change",
      "effort": [{ "start": "2026-11-24T19:00:00Z", "end": "2026-11-24T19:10:00Z" }],
      "runs": ["/path/a.json", "/path/b.json", "/path/b-repeat.json", "/path/a-repeat.json"],
      "qualityEvidence": "/path/quality-check.json"
    }
  ]
}
```

```sh
node public/enablement/browser-proof/homepage-performance/campaign.ts "$JOB/ledger.json"
```

The scorer uses the shared Bend comparison contract and the shipped journey
Bend policy for speed, material gains and the stop decision. A candidate must
clear the frozen same-build speed variation in aggregate and in both matched
repeats. Guardrails cover clipboard correctness, browser CPU, sampled PSS,
loopback transfer, package size and warm latency. Per-metric cost allowances
use the larger of 10% of the two reference medians or their absolute
same-build difference. The stop receipt reports the qualified frontier, noise,
elapsed active effort, complete window rates, early mean, cutoff and distinct
tested ideas since the last gain. Calibration, detailed trace and device
checks do not enroll a new CI gate.
