import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bendScratch } from "../../../../shared/enablement/bend/build.ts";

test("chains colocated hosted brackets and applies the canonical four-window stop", async () => {
  await bendScratch(async (directory) => {
    const commits = [..."abcdef1"].map((digit) => digit.repeat(40));
    const [control, winner, ...others] = commits;
    function json(path: string, data: unknown) {
      writeFileSync(path, JSON.stringify(data));
    }
    function job(
      name: string,
      run: string,
      a: string,
      b: string,
      noise: [number, number],
      timings: number[],
      browser = "153.0.8010.12",
    ) {
      const root = join(directory, name);
      const publicDirectory = join(root, "public");
      mkdirSync(publicDirectory, { recursive: true });
      const workflowSha = "f".repeat(40);
      json(join(root, "gateway.json"), {
        stream: "public",
        entry: "public/enablement/browser-proof/homepage-performance/hosted.ts",
        run,
        attempt: "1",
        control: a,
        candidate: b,
        workflowSha,
        node: "22.23.0",
        runnerImage: "synthetic",
        after: { cpuPressure: "some avg10=0.00 total=2" },
      });
      json(join(publicDirectory, "platform.json"), {
        imageOS: "ubuntu24",
        imageVersion: "synthetic",
        node: "v22.23.0",
        runId: run,
        runAttempt: "1",
        control: a,
        candidate: b,
        reviewed: workflowSha,
        affinity: "0-3",
      });
      function replay(
        label: string,
        revision: string,
        ms: number,
        mode = "quiet",
        mobile = false,
      ) {
        const folder = join(publicDirectory, label);
        mkdirSync(folder);
        const runId = randomUUID();
        const receipt = join(folder, runId + ".json");
        json(receipt, {
          qualified: true,
          mode,
          revision,
          runId,
          packageSha256: revision.padEnd(64, "0"),
          packageBytes: 1024,
          compatible: {
            scenario: "synthetic-public",
            probeSha256: "f".repeat(64),
            detailed: mode === "trace",
            runner: {
              host: "synthetic-runner-" + run,
              kernel: "synthetic-kernel-" + run,
              browser,
              node: "v22.23.0",
              mobile,
              viewport: mobile
                ? { width: 320, height: 852 }
                : { width: 1280, height: 860 },
              theme: mobile ? "dark" : "light",
              affinity: "0-3",
            },
          },
          receipts: ["cold", "warm"].map((navigation) => ({
            navigation,
            detailed: false,
            eligible: true,
            verified: true,
            verifiedMs: navigation === "cold" ? ms : 90,
            cpuPressurePercent: 0,
            chromiumCpuMs: 38,
            sampledChromiumPssKiB: 1024,
            pageTiming: { document: { transferBytes: 1024 }, resources: [] },
          })),
          probeOverheadMs: mode === "calibrate" ? 3 : null,
          demos: [
            {
              evidence: mobile
                ? { mobileSketchVisible: true }
                : { changed: true },
            },
          ],
        });
        if (mode !== "quiet")
          writeFileSync(
            join(folder, "waterfall.html"),
            "<p>Synthetic test</p>",
          );
        return relative(publicDirectory, receipt);
      }
      const controls = [
        replay("noise-first", a, noise[0]),
        replay("noise-second", a, noise[1]),
      ];
      replay("control-overhead", a, noise[0], "calibrate");
      const experiments =
        a === b
          ? []
          : [
              {
                hypothesis: "Synthetic " + name,
                effort: [],
                runs: ["a-first", "b-first", "b-repeat", "a-repeat"].map(
                  (label, index) =>
                    replay(
                      label,
                      index === 0 || index === 3 ? a : b,
                      timings[index],
                    ),
                ),
                qualityEvidence: replay(
                  "candidate-desktop",
                  b,
                  timings[1],
                  "trace",
                ),
              },
            ];
      if (a !== b) replay("candidate-small-dark", b, timings[1], "trace", true);
      json(join(publicDirectory, "comparison-ledger.json"), {
        controls,
        experiments,
        unscoredEffort: [],
      });
      return name;
    }

    const calibration = job("baseline", "100", control, control, [99, 101], []);
    const entries = [
      job("gain", "101", control, winner, [198, 202], [200, 180, 180, 200]),
      job(
        "wide-noise",
        "102",
        winner,
        others[0],
        [285, 315],
        [300, 285, 285, 300],
      ),
      job(
        "one-repeat",
        "103",
        winner,
        others[1],
        [240, 240],
        [240, 180, 240, 240],
      ),
      ...others
        .slice(2)
        .map((candidate, index) =>
          job(
            "tie-" + index,
            String(104 + index),
            winner,
            candidate,
            [240, 240],
            [240, 240, 240, 240],
          ),
        ),
    ];
    const start = Date.UTC(2026, 0, 1);
    const time = (minutes: number) =>
      new Date(start + minutes * 60_000).toISOString();
    const experiments = entries.map((evidence, index) => ({
      hypothesis: evidence,
      effort: [{ start: time(index * 10), end: time((index + 1) * 10) }],
      evidence,
    }));
    const ledger = join(directory, "ledger.json");
    const score = () =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL("campaign.ts", import.meta.url)), ledger],
        { encoding: "utf8" },
      );
    const unscoredEffort = [
      { start: time(entries.length * 10), end: time(240) },
    ];
    json(ledger, { calibration, experiments, unscoredEffort });
    const result = score();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.controlMs, 100);
    assert.equal(report.hostedCalibration.probeOverheadMs, 3);
    assert.equal(report.incumbent.revision, winner);
    assert.equal(report.incumbent.score, 90);
    assert.equal(report.experiments[0].controlMeanMs, 200);
    assert.equal(report.experiments[0].candidateMeanMs, 180);
    assert.deepEqual(
      report.experiments.map((row: { accepted: boolean }) => row.accepted),
      [true, false, false, false, false, false],
    );
    assert.equal(report.completeWindows, 4);
    assert.equal(report.distinctHypothesesSinceGain, 5);
    assert.deepEqual(report.latestCompleteRates, [0, 0]);
    assert.equal(report.stop, true);

    const mismatched = job(
      "changed-browser",
      "110",
      control,
      winner,
      [198, 202],
      [200, 180, 180, 200],
      "154.0.8010.12",
    );
    json(ledger, {
      calibration,
      unscoredEffort: [],
      experiments: [{ ...experiments[0], evidence: mismatched }],
    });
    const rejected = score();
    assert.notEqual(rejected.status, 0);
    assert.match(
      rejected.stderr,
      /Hosted browser, scenario and probe must match/,
    );
  });
});
