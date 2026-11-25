import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { benchmarkComparison } from "../../../../shared/enablement/performance/comparison.ts";
import { schedulerPressureUs } from "../fixtures/host-pressure.ts";
import {
  attempt,
  bytesPerFrame,
  locate,
  type Setup,
  shutDown,
  watchDisplay,
  width,
} from "./attempt.ts";

const fixture = "record-pill-xvfb-v1";
const maxSchedulerPressurePercent = 5;

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function median(values: number[]) {
  assert.ok(values.length);
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

async function measure(setup: Setup, output: string) {
  const time = performance.now();
  const pressure = schedulerPressureUs();
  const display = watchDisplay();
  const attempts: Awaited<ReturnType<typeof attempt>>[] = [];
  const usage = process.cpuUsage();
  try {
    for (const mode of ["cold", "warm"] as const) {
      for (let i = 0; i < 3; i++) {
        attempts.push(
          await attempt(setup, mode, join(output, `${mode}-${i}`), display),
        );
      }
    }
  } finally {
    await shutDown(display.child);
  }
  const wait = (mode: "cold" | "warm") =>
    median(
      attempts
        .filter((row) => row.mode === mode)
        .map(({ rawMs }) => {
          assert.ok(rawMs !== null && rawMs > 0);
          return rawMs;
        }),
    );
  return {
    setup,
    attempts,
    observerNodeCpu: process.cpuUsage(usage),
    observerMaxRssKiB: process.resourceUsage().maxRSS,
    schedulerPressurePercent:
      (schedulerPressureUs() - pressure) / ((performance.now() - time) * 10),
    hostSha256: await sha256(setup.host),
    rendererEntrySha256: await sha256(setup.renderer),
    electronSha256: await sha256(setup.runtime),
    coldMs: wait("cold"),
    warmMs: wait("warm"),
  };
}

const args = process.argv.slice(2);
if (args[0] !== "--xvfb-child") {
  const [control, output, candidate] = args;
  assert.ok(
    control && output && args.length <= 3,
    "Usage: startup.ts CONTROL_BUILD NEW_RESULTS [CANDIDATE_BUILD]",
  );
  mkdirSync(output, { mode: 0o700 });
  const privateDisplay = mkdtempSync(join(tmpdir(), "apparent-dev-xvfb-"));
  const authority = join(privateDisplay, "display.xauth");
  try {
    const child = spawnSync(
      "xvfb-run",
      [
        "-a",
        "-f",
        authority,
        "-s",
        `-screen 0 ${width}x320x24 -nolisten tcp`,
        process.execPath,
        process.argv[1],
        "--xvfb-child",
        authority,
        ...[control, output, ...(candidate ? [candidate] : [])].map((path) =>
          resolve(path),
        ),
      ],
      {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
        },
        stdio: "inherit",
      },
    );
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  } finally {
    rmSync(privateDisplay, { recursive: true, force: true });
  }
} else {
  const [, authority, control, output, candidate] = args;
  assert.match(process.env.DISPLAY ?? "", /^:\d+$/);
  assert.ok(authority);
  assert.equal(process.env.XAUTHORITY, authority);
  const controlSetup = locate(control);
  const candidateSetup = candidate ? locate(candidate) : undefined;
  assert.ok(
    !candidateSetup ||
      Boolean(controlSetup.lib) === Boolean(candidateSetup.lib),
    "Both builds must use the same package layout",
  );
  const runs: Awaited<ReturnType<typeof measure>>[] = [];
  const order = candidate
    ? ["control", "candidate", "candidate", "control"]
    : ["control", "control"];
  for (const [index, arm] of order.entries()) {
    const build =
      arm === "candidate" && candidateSetup ? candidateSetup : controlSetup;
    const directory = join(output, "run-" + index);
    mkdirSync(directory, { mode: 0o700 });
    const run = await measure(build, directory);
    writeFileSync(
      join(directory, "receipt.json"),
      JSON.stringify(run, null, 2),
      { mode: 0o600 },
    );
    runs.push(run);
  }
  const [a, b, c = b, d = b] = runs;
  const maxSampleGapMs = 50;
  const complete = runs.every((run) =>
    run.attempts.every(
      ({ visible }) =>
        visible.sampleGapMs <= maxSampleGapMs &&
        visible.evidenceBytes === bytesPerFrame,
    ),
  );
  const eligible =
    complete &&
    runs.every(
      (run) => run.schedulerPressurePercent <= maxSchedulerPressurePercent,
    );
  const pressureLimit = runs.map(
    ({ schedulerPressurePercent }): [number, number] => [
      schedulerPressurePercent,
      maxSchedulerPressurePercent,
    ],
  );
  const resourceLimits = [];
  if (candidate) {
    for (const mode of ["cold", "warm"]) {
      for (const key of ["cpuTicks", "pssKiB"] as const) {
        const [first, after, repeat, last] = [a, b, c, d].map((run) =>
          median(
            run.attempts
              .filter((row) => row.mode === mode)
              .map((row) => row.resources[key]),
          ),
        );
        const baseline = Math.max(first, last);
        const allowance = Math.max(
          baseline * 0.1,
          key === "cpuTicks" ? 4 : 32 * 1024,
        );
        resourceLimits.push({
          mode,
          key,
          candidate: [after, repeat],
          baseline,
          allowance,
        });
      }
    }
  }
  const comparison = await benchmarkComparison(
    [
      [a.coldMs, candidate ? b.coldMs : a.coldMs, c.coldMs, d.coldMs],
      [a.warmMs, candidate ? b.warmMs : a.warmMs, c.warmMs, d.warmMs],
    ],
    [
      ...pressureLimit,
      ...resourceLimits.flatMap(
        ({ candidate, baseline, allowance }): [number, number, number][] =>
          candidate.map((value) => [value, baseline, allowance]),
      ),
    ],
  );
  let overhead;
  if (!candidate && eligible) {
    const at = performance.now();
    const pressure = schedulerPressureUs();
    const observations: (Awaited<ReturnType<typeof attempt>> & {
      alwaysOn: boolean;
    })[] = [];
    for (const mode of ["cold", "warm"] as const) {
      for (const [index, alwaysOn] of [true, false, false, true].entries()) {
        const display = alwaysOn ? watchDisplay() : undefined;
        try {
          const row = await attempt(
            controlSetup,
            mode,
            join(output, `overhead-${mode}-${index}`),
            display,
          );
          observations.push({ ...row, alwaysOn });
        } finally {
          if (display) await shutDown(display.child);
        }
      }
    }
    const pressurePercent =
      (schedulerPressureUs() - pressure) / ((performance.now() - at) * 10);
    overhead = {
      pressurePercent,
      eligible: pressurePercent <= maxSchedulerPressurePercent,
      observations,
      ackMs: Object.fromEntries(
        ["cold", "warm"].map((mode) => {
          const pairs = observations
            .filter((row) => row.mode === mode)
            .map((row) => row.inputToAckMs);
          return [
            mode,
            {
              alwaysOn: [pairs[0], pairs[3]],
              lateObserver: [pairs[1], pairs[2]],
              pairedDeltaMs: [pairs[0] - pairs[1], pairs[3] - pairs[2]],
            },
          ];
        }),
      ),
    };
  }
  const qualified =
    eligible &&
    comparison.permitted.every(Boolean) &&
    (overhead?.eligible ?? true);
  const timing = comparison.timings.map((measurement, index) => ({
    ...measurement,
    score: qualified ? measurement.score : null,
    sameBuildRepeatGapMs: candidate
      ? null
      : Math.abs(index === 0 ? a.coldMs - b.coldMs : a.warmMs - b.warmMs),
  }));
  const report = {
    fixture,
    coverage:
      "Real Electron pill and React renderer on Xvfb. Capture state and native window admission are fixture messages. No physical shortcut, portal, media, or Hyprland pin.",
    order,
    eligible: qualified,
    timingOrder: ["cold", "warm"],
    timing,
    overhead,
    runs,
    guards: {
      maxSchedulerPressurePercent,
      maxSampleGapMs,
      frameEvidenceComplete: complete,
      pressurePermitted: comparison.permitted.slice(0, runs.length),
      resourcesPermitted: comparison.permitted.slice(runs.length),
      resourceLimits,
    },
  };
  writeFileSync(
    join(output, "comparison.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      fixture,
      eligible: qualified,
      timingOrder: report.timingOrder,
      timing,
      guards: report.guards,
      receipt: join(output, "comparison.json"),
    }),
  );
  if (!qualified) process.exitCode = 1;
}
