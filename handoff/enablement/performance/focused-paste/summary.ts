import assert from "node:assert/strict";

type Row = {
  batch: string;
  index: number;
  kind: string;
  build: string;
  endpointMs: number;
  appCpuMs: number;
  appRssKiB: number;
  draftSha256: string;
  clipboardSha256: string;
  durableInputs: string[];
};

function stats(values: number[]) {
  assert.equal(values.length, 5);
  assert.ok(values.every(Number.isFinite));
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[2], range: [sorted[0], sorted[4]] };
}

export function summarize(
  raw: string,
  version: string,
  control: string,
  candidate: string,
) {
  assert.equal(version, "handoff-linux-focused-transcript-draft-v1");
  const [environment, ...rows] = raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(environment.version, version);
  assert.deepEqual(environment.revisions, { control, candidate });
  const equal = control === candidate;
  assert.equal(rows.length, equal ? 32 : 64);
  const measure = (batch: string, builds: string[]) =>
    builds.map((build, index) => {
      const arm = rows.filter(
        (row: Row) => row.batch === batch && row.index === index,
      ) as Row[];
      assert.deepEqual(
        arm.map((row) => row.kind),
        [
          "warmup",
          "normal",
          "normal",
          "normal",
          "normal",
          "normal",
          "rapid",
          "clipboard-change",
        ],
      );
      assert.ok(arm.every((row) => row.build === build));
      const normal = arm.filter((row) => row.kind === "normal");
      return {
        build,
        endpointMs: stats(normal.map((row) => row.endpointMs)),
        appCpuMs: stats(normal.map((row) => row.appCpuMs)),
        appRssKiB: stats(normal.map((row) => row.appRssKiB)),
        receipts: arm.map(
          ({ draftSha256, clipboardSha256, durableInputs }) => ({
            draftSha256,
            clipboardSha256,
            durableInputs,
          }),
        ),
      };
    });
  const calibration = measure("calibration", Array(4).fill("control"));
  const comparison = equal
    ? null
    : measure("comparison", ["control", "candidate", "candidate", "control"]);
  const pairs = [
    [0, 1],
    [3, 2],
  ];
  const variation = Math.max(
    ...pairs.map(([a, b]) =>
      Math.abs(
        calibration[a].endpointMs.median - calibration[b].endpointMs.median,
      ),
    ),
  );
  const receipts = calibration[0].receipts;
  for (const arm of [...calibration, ...(comparison ?? [])])
    assert.deepEqual(arm.receipts, receipts);
  const pairedSavings = comparison?.map((arm) => arm.endpointMs.median);
  const gains =
    pairedSavings &&
    pairs.map(
      ([before, after]) => pairedSavings[before] - pairedSavings[after],
    );
  const resourceGuards =
    comparison &&
    pairs.map(([before, after]) => ({
      cpu:
        comparison[after].appCpuMs.median <=
        comparison[before].appCpuMs.median * 1.1 +
          1000 / environment.ticksPerSecond,
      rss:
        comparison[after].appRssKiB.median <=
        comparison[before].appRssKiB.median * 1.1 + 16 * 1024,
    }));
  return {
    version,
    control,
    candidate,
    variationMs: variation,
    pairedSavingsMs: gains,
    calibration,
    comparison,
    resourceGuards,
    qualified:
      equal ||
      (gains!.every((gain) => gain > variation) &&
        resourceGuards!.every((guard) => guard.cpu && guard.rss)),
  };
}
