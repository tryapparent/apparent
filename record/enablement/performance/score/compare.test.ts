import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("focused scoring reads native report shapes and rejects unqualified evidence", (t) => {
  const job = mkdtempSync(join(tmpdir(), "apparent-dev-focused-proof-"));
  t.after(() => rmSync(job, { force: true, recursive: true }));
  const compare = fileURLToPath(new URL("./run.ts", import.meta.url));
  const phase = {
    p95Millicores: 3000,
    cpuSeconds: 2,
    saturationMs: 0,
    appPssMiB: 700,
    availableMemoryMiB: 2000,
    guestStealPercent: 0,
  };
  const reports = [1000, 600, 800, 1400].map((ms, i) => {
    const startUs = 1000 + 10000000 * i;
    const span = { clock: "host", startUs, endUs: startUs + 1000 * ms };
    const half = { ...span, endUs: startUs + 500 * ms };
    return {
      version:
        i === 0 || i === 3
          ? "apparent 1.0 · 1234567"
          : "apparent 1.0 · 7654321",
      waits: {
        "paste-22-to-33/threshold-27": {
          ms,
          verified: true,
          intervals: [[span]],
        },
        live: {
          ms,
          verified: true,
          intervals: [
            [half, half],
            [half, half],
          ],
        },
        pill: {
          ms,
          verified: true,
          intervals: [
            [half, half],
            [half, half],
          ],
        },
      },
      resources: {
        "threshold-27": {
          outputVerified: true,
          wordErrorRate: 0.01,
          recording: { ...phase, p95Millicores: i === 2 ? 3700 : 3000 },
          finalization: { ...phase, p95Millicores: 4000 },
        },
      },
      stages: { "threshold-27": { stopMs: 40 } },
    };
  });
  const files = reports.map((report, i) => {
    const file = join(job, i + ".json");
    writeFileSync(file, JSON.stringify(report));
    return file;
  });
  const run = (lane: string, paths = files) =>
    spawnSync(
      process.execPath,
      ["--experimental-strip-types", compare, lane, ...paths],
      {
        encoding: "utf8",
        env: { ...process.env, TMPDIR: job },
      },
    );
  const start = run("start");
  assert.equal(start.status, 0, start.stderr);
  const startReport = JSON.parse(start.stdout);
  assert.equal(startReport.score, 58.33);
  assert.equal(startReport.visiblePill.score, 58.33);
  const stop = run("stop");
  assert.equal(stop.status, 0, stop.stderr);
  const stopReport = JSON.parse(stop.stdout);
  assert.deepEqual(stopReport.timing.pairedDeltaMs, [-400, -600]);
  assert.equal(stopReport.stages[0].stopMs, 40);
  assert.deepEqual(stopReport.failures, [
    "Run 3 exceeded the recording CPU budget",
  ]);
  assert.match(
    run("stop", [files[0], files[1], files[1], files[3]]).stderr,
    /four independent/,
  );
  reports[0].resources["threshold-27"].recording.guestStealPercent = 5.01;
  writeFileSync(files[0], JSON.stringify(reports[0]));
  const contended = run("stop");
  assert.equal(contended.status, 1);
  assert.match(contended.stderr, /CPU contention exceeded 5%/);
});
