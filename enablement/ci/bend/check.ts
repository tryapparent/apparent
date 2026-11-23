import "../../timing/journey/profile/coverage.test.ts";
import "../../timing/journey/profile/measurements.test.ts";
import { assemble } from "../../timing/journey/assemble.ts";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  bendScratch,
  proofOptions,
} from "../../../shared/enablement/bend/build.ts";
import { buildPerformancePolicy } from "./build.ts";
import {
  audit,
  contract,
  contractHash,
  evaluate,
} from "../../timing/journey/score.ts";
import type { Attempt, Receipt, Policy } from "../../timing/journey/score.ts";

await bendScratch(async (directory) => {
  await buildPerformancePolicy(directory, proofOptions(process.argv.slice(2)));
  const { default: policy } = (await import(
    pathToFileURL(join(directory, "journey-scoring.mjs")).href
  )) as { default: Policy };
  assert.equal(policy.should_stop(true, true, 18, 17, 180, 20, 5, 5), true);
  assert.equal(policy.should_stop(true, true, 19, 0, 180, 20, 5, 5), false);
  assert.equal(policy.should_stop(true, true, 0, 0, 180, 20, 4, 5), false);
  assert.equal(policy.should_stop(false, true, 0, 0, 180, 20, 5, 5), false);
  assert.equal(policy.within_budget(4_100_000_000, 4_000_000_000, 1, 10), true);

  const phase = {
    p95Millicores: 2000,
    saturationMs: 0,
    cpuSeconds: 1,
    availableMemoryMiB: 2000,
    appPssMiB: 1000,
    guestStealPercent: 0,
  };
  const waits = Object.fromEntries(
    contract.weights.flatMap(([id]: [string]) =>
      (
        contract.cases[id]?.map((fixture: string) => id + "/" + fixture) ?? [id]
      ).map((key: string) => [key, { ms: 1000, verified: true }]),
    ),
  );
  for (const id of contract.stopControls)
    waits["paste/" + id] = { ms: 1000, verified: true };
  const resources = Object.fromEntries(
    Object.keys(waits)
      .filter((id) => id.startsWith("paste") && id.includes("/"))
      .map((id) => [
        id.split("/")[1],
        {
          recording: { ...phase },
          finalization: { ...phase },
          bundleBytes: 1024,
          peakScratchBytes: 1024,
          outputVerified: true as const,
          wordErrorRate: 0,
        },
      ]),
  );
  const make = (runId: string, revision = "1", factor = 1): Receipt => ({
    contractHash,
    revision: revision.repeat(40),
    runner: "fixture runner",
    runId,
    vcpus: 4,
    waits: Object.fromEntries(
      Object.entries(waits).map(([id]) => [
        id,
        { ms: 1000 * factor, verified: true },
      ]),
    ),
    resources: structuredClone(resources),
  });
  const reference = [make("ref1"), make("ref2")];
  const measurement = { ms: 1, verified: true as const };
  const stamp = "apparent 0.22.14 · 1111111";
  const fromParts = assemble(reference[0], [
    { version: stamp, waits: { pill: measurement } },
    { version: stamp, waits: { copy: measurement } },
  ]);
  assert.deepEqual(Object.keys(fromParts.receipt.waits), ["pill", "copy"]);
  assert.equal(fromParts.coverage.complete, false);
  assert.throws(
    () =>
      assemble(reference[0], [
        { version: stamp, waits: { pill: measurement } },
        { version: stamp, waits: { pill: measurement } },
      ]),
    /Conflicting wait/,
  );
  assert.throws(
    () =>
      assemble(reference[0], [
        { version: "apparent 0.22.14 · 2222222", waits: { pill: measurement } },
      ]),
    /different or modified/,
  );
  const absent = make("missing");
  delete absent.waits.captions;
  delete absent.resources["review-dense"];
  assert.deepEqual(audit(absent), {
    complete: false,
    missingWaits: ["captions"],
    missingResources: ["review-dense"],
  });

  const first: Attempt = {
    hypothesis: "first gain",
    seconds: 3600,
    runs: [make("a1", "2", 0.9), make("a2", "2", 0.9)],
  };
  const slow = (index: number): Attempt => ({
    hypothesis: "probe " + index,
    seconds: 3600,
    outcome: "No verified improvement",
  });
  assert.equal(evaluate(policy, reference, []).baselineScore, 100);
  assert.equal(
    evaluate(policy, reference, [first, ...[1, 2, 3, 4].map(slow)]).stop,
    false,
  );
  assert.equal(
    evaluate(policy, reference, [first, ...[1, 2, 3, 4, 5].map(slow)]).stop,
    true,
  );
  assert.equal(
    evaluate(policy, reference, [first, ...[1, 2, 3, 4, 4].map(slow)]).stop,
    false,
  );
  const late: Attempt = {
    hypothesis: "late win",
    seconds: 3600,
    runs: [make("b1", "3", 0.8), make("b2", "3", 0.8)],
  };
  const result = evaluate(policy, reference, [
    first,
    ...[1, 2, 3, 4].map(slow),
    late,
  ]);
  assert.equal(result.stop, false);
  assert.equal(result.distinctHypothesesSinceGain, 0);
  assert.equal(result.incumbent.score, 80);

  const regression = make("c1", "4", 0.8);
  regression.waits["paste/review-dense"].ms = 5110;
  regression.resources["review-dense"].wordErrorRate = 0.03;
  regression.resources["review-dense"].bundleBytes += 24 * 1024 * 1024;
  regression.resources["review-dense"].recording.p95Millicores = 3800;
  regression.resources["review-dense"].finalization.p95Millicores = 4000;
  const rejected = evaluate(policy, reference, [
    {
      hypothesis: "review regression",
      seconds: 300,
      runs: [regression, make("c2", "4", 0.8)],
    },
  ]);
  assert.equal(rejected.incumbent.score, 100);
  const failed = rejected.experiments[0];
  assert.ok("failures" in failed);
  assert.deepEqual(failed.failures, [
    "c1 paste/review-dense clipboard regression",
    "c1 review-dense transcript word error regression",
    "c1 review-dense recording CPU p95",
    "c1 review-dense saved bundle growth",
  ]);

  const cheaper = [make("d1", "5"), make("d2", "5")];
  cheaper.forEach((receipt) => receipt.resources["review-dense"].bundleBytes--);
  const tie = evaluate(policy, reference, [
    { hypothesis: "smaller media", seconds: 3600, runs: cheaper },
  ]);
  assert.equal(tie.incumbent.revision, "5".repeat(40));
  assert.equal(tie.distinctHypothesesSinceGain, 1);
});
