import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type Interval,
  measuredWait,
} from "../../../../shared/enablement/performance/measurement.ts";
import { assemble, type Part } from "../assemble.ts";
import { readMeasurements, writeMeasurementTraces } from "./measurements.ts";

const identity = {
  revision: "a".repeat(40),
  runner: "trace-test",
  runId: "trace-test-1",
  vcpus: 4,
};
const version = "apparent 0.22.15 · aaaaaaa";
const fixture = "editor-clean";
const phase = {
  p95Millicores: 2011,
  saturationMs: 0,
  cpuSeconds: 1.7182823379,
  availableMemoryMiB: 2001,
  appPssMiB: 1001,
  guestStealPercent: 0.03,
};

test("a verified probe without physical endpoints cannot produce measurement traces", async () => {
  await assert.rejects(
    writeMeasurementTraces(tmpdir(), identity, [
      {
        label: "surface",
        scope: "guest",
        part: { version, waits: { live: { ms: 9, verified: true } } },
      },
    ]),
    /Missing measured endpoints for live/,
  );
  const { receipt } = assemble(identity, [{ version }]);
  await assert.rejects(
    readMeasurements(receipt, "/missing/trace_processor"),
    /requires verified Perfetto measurement traces/,
  );
});

const traceProcessor = process.env.APPARENT_JOURNEY_TRACE_PROCESSOR;
test("Trace Processor supplies waiting and resource values and enforces provenance", {
  skip: !traceProcessor,
}, async (t) => {
  assert(traceProcessor);
  const job = await mkdtemp(join(tmpdir(), "apparent-dev-perfetto-metrics-"));
  t.after(() => rm(job, { recursive: true, force: true }));
  const span = (startUs: number, endUs: number): Interval => ({
    startUs,
    endUs,
    clock: "guest-boottime",
  });
  const parts: Part[] = [
    {
      version,
      waits: {
        "paste/editor-clean": measuredWait(150, 170, "host"),
        pill: {
          ms: 36.5,
          verified: true,
          intervals: [
            [span(1_000, 13_000), span(20_000, 41_000)],
            [span(50_000, 65_000), span(70_000, 95_000)],
          ],
        },
      },
      resources: {
        [fixture]: {
          recording: phase,
          finalization: phase,
          bundleBytes: 1023,
          peakScratchBytes: 1024,
          outputVerified: true,
          wordErrorRate: 0.004,
        },
      },
      resourceIntervals: {
        [fixture]: {
          recording: span(250_000, 450_000),
          finalization: span(450_000, 480_000),
        },
      },
    },
  ];
  const evidence = await writeMeasurementTraces(job, identity, [
    { label: "corpus", part: parts[0], scope: "guest" },
  ]);
  const { receipt } = assemble(identity, parts);
  const input = { ...receipt, measurementEvidence: evidence };
  input.waits["paste/editor-clean"].ms = 900;
  input.waits.pill.ms = 768;
  input.resources[fixture].recording.p95Millicores = 4;
  const measured = await readMeasurements(input, traceProcessor);
  assert.deepEqual(measured.waits, {
    "paste/editor-clean": { ms: 20, verified: true },
    pill: { ms: 36.5, verified: true },
  });
  assert.equal(measured.resources[fixture].recording.p95Millicores, 2011);
  assert(
    Math.abs(
      measured.resources[fixture].finalization.cpuSeconds - phase.cpuSeconds,
    ) < 1e-14,
  );
  assert.equal(measured.resources[fixture].wordErrorRate, 0.004);
  await assert.rejects(
    readMeasurements({ ...input, runId: "other-run" }, traceProcessor),
    /trace belongs to a different run/,
  );
  await assert.rejects(
    readMeasurements(
      {
        ...input,
        measurementEvidence: {
          ...evidence,
          traces: evidence.traces.slice(0, 1),
        },
      },
      traceProcessor,
    ),
    /Missing Perfetto metric/,
  );
  await writeFile(evidence.traces[0].file, "changed");
  await assert.rejects(
    readMeasurements(input, traceProcessor),
    /trace digest mismatch/,
  );
});
