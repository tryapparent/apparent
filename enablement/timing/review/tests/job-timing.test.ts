import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectJobs } from "../snapshots.ts";
import { chart } from "../format.ts";

const from = "2026-11-15T00:00:00Z",
  to = "2026-11-15T06:00:00Z";
const carriedRuns = JSON.parse(
  readFileSync(
    new URL("../carried-jobs.fixture.json", import.meta.url),
    "utf8",
  ),
);
const jobFrom = Date.parse("2026-11-16T07:20:00Z"),
  jobTo = Date.parse("2026-11-16T07:30:00Z");
test("producer carried completion is terminal and attributes execution once to the original attempt", () => {
  const partial = inspectJobs([carriedRuns[1]], jobFrom, jobTo);
  assert.equal(partial.unfinishedJobs, 0);
  assert.equal(partial.jobs.length, 1);
  assert.equal(partial.jobs[0].runnerSeconds, null);
  assert.equal(partial.jobs[0].queueSeconds, null);
  assert.equal(partial.jobs[0].provenance, "unknown-prior-execution");
  for (const runs of [
    carriedRuns,
    [...carriedRuns].reverse(),
    [...carriedRuns, ...carriedRuns],
  ]) {
    const result = inspectJobs(runs, jobFrom, jobTo);
    assert.equal(result.unfinishedJobs, 0);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].id, "43823181821:1:133150747097");
    assert.equal(result.jobs[0].runnerSeconds, 29);
    assert.equal(result.jobs[0].queueSeconds, 2);
  }
  assert.equal(
    inspectJobs(carriedRuns, Date.parse("2026-11-16T07:21:00Z"), jobTo).jobs[0]
      .runnerSeconds,
    18,
  );
  assert.equal(
    inspectJobs(carriedRuns, Date.parse("2026-11-16T07:25:00Z"), jobTo).jobs
      .length,
    0,
  );
});

test("carried provenance requires a unique matching earlier execution, never just the name", () => {
  const [original, carried] = structuredClone(carriedRuns);
  const inspect = (runs: unknown[]) => inspectJobs(runs, jobFrom, jobTo);
  const change = (patch: Record<string, unknown>) => ({
    ...original,
    jobs: [{ ...original.jobs[0], ...patch }],
  });
  for (const candidate of [
    { ...original, runId: 99 },
    { ...original, headSha: "f".repeat(40) },
    change({ runner_id: 123 }),
    change({ name: "contracts (matrix)" }),
    change({ steps: [] }),
    change({
      steps: original.jobs[0].steps.map((s: { started_at: string }) => ({
        ...s,
        completed_at: s.started_at,
      })),
    }),
  ])
    assert.equal(
      inspect([candidate, carried]).jobs.find((j) => j.attempt === 2)
        .runnerSeconds,
      null,
    );
  const ambiguous = {
    ...original,
    jobs: [...original.jobs, { ...original.jobs[0], id: 100 }],
  };
  assert.equal(
    inspect([ambiguous, carried]).jobs.find((j) => j.attempt === 2)
      .runnerSeconds,
    null,
  );
  const rerun = {
    ...carried,
    jobs: [{ ...carried.jobs[0], created_at: original.jobs[0].created_at }],
  };
  assert.equal(inspect([original, rerun]).jobs.length, 2);
  const matrix = change({ id: 200, name: "contracts (matrix)" });
  assert.equal(inspect([original, matrix, carried]).jobs.length, 2);
});

test("terminal missing clocks stay unknown while active and unallocated semantics survive", () => {
  const original = carriedRuns[0];
  for (const conclusion of ["success", "failure", "cancelled"]) {
    for (const completed_at of [null, "invalid", "0001-01-01T00:00:00Z"]) {
      const result = inspectJobs(
        [
          {
            ...original,
            jobs: [{ ...original.jobs[0], conclusion, completed_at }],
          },
        ],
        jobFrom,
        jobTo,
      );
      assert.equal(result.unfinishedJobs, 0);
      assert.equal(result.jobs[0].runnerSeconds, null);
    }
  }
  const active = {
    ...original.jobs[0],
    status: "in_progress",
    conclusion: null,
    completed_at: null,
  };
  assert.equal(
    inspectJobs([{ ...original, jobs: [active] }], jobFrom, jobTo)
      .unfinishedJobs,
    1,
  );
});

test("missing and zero-date execution starts cannot create elapsed work", () => {
  const original = carriedRuns[0];
  for (const started_at of [null, "invalid", "0001-01-01T00:00:00Z"]) {
    const result = inspectJobs(
      [{ ...original, jobs: [{ ...original.jobs[0], started_at }] }],
      jobFrom,
      jobTo,
    );
    assert.equal(result.unfinishedJobs, 0);
    assert.equal(result.jobs[0].runnerSeconds, null);
    assert.equal(result.jobs[0].queueSeconds, null);
  }
});

test("CI analysis separates three-hour allocation waits, runner execution and step costs at the cutoff", () => {
  const start = Date.parse("2026-11-17T06:00:00Z"),
    end = Date.parse("2026-11-17T10:00:00Z");
  const a = (hour: string) => `2026-11-17T${hour}:00:00Z`;
  const r = inspectJobs(
    [
      {
        databaseId: 123,
        attempt: 1,
        headSha: "a".repeat(40),
        jobs: [
          {
            id: 10,
            name: "native Mac",
            status: "queued",
            conclusion: null,
            created_at: a("05"),
            started_at: a("05"),
            runner_id: 0,
            labels: ["macos-15-intel"],
            steps: [],
          },
          {
            id: 11,
            name: "Linux verification",
            status: "completed",
            conclusion: "success",
            created_at: a("06"),
            started_at: a("07"),
            completed_at: a("09"),
            runner_id: 4,
            labels: ["ubuntu-latest"],
            steps: [
              {
                number: 1,
                name: "Install dependencies",
                status: "completed",
                started_at: a("07"),
                completed_at: a("08"),
                conclusion: "success",
              },
              {
                number: 2,
                name: "Build and test",
                status: "completed",
                started_at: a("08"),
                completed_at: a("09"),
                conclusion: "success",
              },
            ],
          },
          {
            id: 12,
            name: "running build",
            status: "in_progress",
            conclusion: null,
            created_at: a("08"),
            started_at: a("09"),
            runner_id: 5,
            steps: [
              {
                number: 1,
                name: "Compile",
                status: "in_progress",
                started_at: a("09"),
                completed_at: null,
              },
            ],
          },
        ],
      },
    ],
    start,
    end,
  );
  assert.equal(r.analysis.longestWaitingJobs[0].id, "123:1:10");
  assert.equal(r.analysis.longestWaitingJobs[0].queueAgeSeconds, 18000);
  assert.equal(r.analysis.longestWaitingJobs[0].queueSeconds, 14400);
  assert.equal(r.analysis.longestWaitingJobs[0].runnerSeconds, 0);
  assert.match(
    r.analysis.longestWaitingJobs[0].waitReason,
    /requires provider evidence/,
  );
  assert.equal(r.analysis.longestSteps[0].seconds, 3600);
  assert.equal(
    r.analysis.longestSteps.find((s) => s.name === "Compile").complete,
    false,
  );
  assert.equal(r.analysis.runningJobs[0].executionAgeSeconds, 3600);
  assert.equal(r.analysis.queueByRunner[0].totalSeconds, 14400);
  const html = chart({
    census: { window: { from: a("06"), to: a("10") }, categories: [] },
    processGroups: [],
  });
  assert.ok(html.includes("Tool envelopes"));
});

test("report makes CI coverage gaps and unresolved action attribution explicit", async () => {
  const { markdown } = await import("../format.ts");
  const data = {
    census: {
      window: { from, to },
      categories: [],
      actionRanking: {
        envelopes: {
          clock: "tool-envelope",
          candidate: {
            label: "test build",
            count: 2,
            meanSeconds: 5,
            totalSeconds: 10,
          },
          largestObserved: {
            label: "mixed",
            count: 1,
            meanSeconds: 50,
            totalSeconds: 50,
          },
          winnerEstablished: false,
          unresolvedSeconds: 50,
          ranked: [],
          limitation: "unknown attribution",
        },
      },
    },
    processGroups: [],
  };
  const text = markdown(data);
  assert.match(text, /Largest observed operation group: mixed/);
  assert.match(text, /Overall winner unresolved/);
  assert.match(text, /CI coverage missing/);
  assert.match(text, /2 × 5s = 10s/);
});

test("normal jobless workflows retain snapshot age without establishing admission wait or runner demand", async () => {
  const r = inspectJobs(
    [
      {
        databaseId: 99,
        attempt: 2,
        headSha: "a".repeat(40),
        name: "Queued workflow",
        status: "queued",
        createdAt: "2026-11-15T00:00:00Z",
        jobs: [],
      },
    ],
    Date.parse("2026-11-15T02:00:00Z"),
    Date.parse("2026-11-15T06:00:00Z"),
  );
  assert.equal(r.analysis.joblessSnapshots[0].ageSeconds, 21600);
  assert.equal(r.analysis.joblessSnapshots[0].windowAgeSeconds, 14400);
  assert.equal(r.analysis.coverage.runs, 1);
  assert.equal(
    r.analysis.queueByRunner.length,
    0,
    "no invented job/runner queue",
  );
  assert.equal(r.analysis.joblessSnapshots[0].status, "queued");
  const { markdown } = await import("../format.ts");
  const text = markdown({
    census: { window: { from, to }, categories: [] },
    processGroups: [],
    jobs: r,
  });
  assert.match(
    text,
    /run 99, attempt 2, SHA a{40}.*queued.*snapshot age 21600s.*in-window age 14400s/,
  );
  assert.doesNotMatch(text.split("## CI queue")[0], /14400|21600|admission/);
  assert.match(
    text,
    /Live admission wait, runner demand and critical-path delay are unknown/,
  );
});

test("producer-shaped contradictory jobless records remain unknown, visible and outside cost rankings", async () => {
  const receipts = [
    { databaseId: 101, createdAt: "2026-11-11T20:34:35Z" },
    { databaseId: 102, createdAt: "2026-11-11T20:34:35Z" },
    { databaseId: 103, createdAt: "2026-11-11T20:47:52Z" },
    { databaseId: 104, createdAt: "2026-11-11T20:52:43Z" },
  ].map((run) => ({
    run: {
      ...run,
      attempt: 1,
      headSha: "b".repeat(40),
      name: "Delivery",
      status: "queued",
    },
    jobsResponse: { total_count: 0, jobs: [] },
    cancelResponse: "Cannot cancel a workflow run that is completed",
    forceResponse: {
      status: "409",
      message: "Cannot cancel a workflow run that has not been queued yet.",
    },
  }));
  const runs = receipts.map(({ run, jobsResponse }) => ({
    ...run,
    jobs: jobsResponse.jobs,
    snapshotCoverage: {
      pages: 1,
      expectedJobs: 0,
      capturedJobs: 0,
      complete: true,
    },
  }));
  const r = inspectJobs(
    [...runs, ...runs],
    Date.parse("2026-11-17T11:00:00Z"),
    Date.parse("2026-11-17T17:00:00Z"),
  );
  assert.deepEqual(
    r.analysis.joblessSnapshots.map((r) => r.runId),
    [101, 102, 103, 104],
  );
  assert.equal(r.analysis.joblessSnapshots[0].ageSeconds, 505525);
  assert.ok(
    r.analysis.joblessSnapshots.every(
      (r) => r.windowAgeSeconds === 21600 && r.snapshotCoverage.complete,
    ),
  );
  assert.equal(r.analysis.coverage.runs, 4);
  assert.equal(r.jobs.length, 0);
  assert.deepEqual(r.analysis.queueByRunner, []);
  assert.deepEqual(r.analysis.executionByJob, []);
  const { markdown } = await import("../format.ts");
  const data = {
    census: { window: { from, to }, categories: [] },
    processGroups: [],
    jobs: { ...r, collection: { runLimit: 12, runLimitReached: true } },
  };
  const text = markdown(data);
  for (const run of runs)
    assert.ok(
      text.includes(`run ${run.databaseId}, attempt 1, SHA ${run.headSha}`),
    );
  assert.match(text, /runLimitReached.*true/);
  assert.doesNotMatch(text, /86400|CI pre-job admission|4 × 21600/);
  assert.doesNotMatch(chart(data), /86400|505525|21600/);
  const legacy = markdown({
    ...data,
    jobs: {
      ...r,
      analysis: {
        ...r.analysis,
        joblessSnapshots: undefined,
        preJobWaits: r.analysis.joblessSnapshots.map((r) => ({
          ...r,
          windowSeconds: r.windowAgeSeconds,
          reason: "workflow admission wait",
        })),
      },
    },
  });
  assert.match(legacy, /run 101.*snapshot age 505525s/);
  assert.doesNotMatch(
    legacy,
    /CI pre-job admission|workflow admission wait|86400/,
  );
});

test("jobless snapshots retain partial coverage and unknown clocks, including terminal observations", () => {
  const base = {
    databaseId: 8,
    attempt: 1,
    headSha: "a".repeat(40),
    status: "completed",
    jobs: [],
    snapshotCoverage: {
      pages: 1,
      expectedJobs: 3,
      capturedJobs: 0,
      complete: false,
    },
  };
  for (const createdAt of [undefined, "invalid"]) {
    const r = inspectJobs(
      [{ ...base, createdAt }],
      Date.parse(from),
      Date.parse(to),
    );
    assert.equal(r.analysis.joblessSnapshots[0].ageSeconds, null);
    assert.equal(r.analysis.joblessSnapshots[0].windowAgeSeconds, null);
    assert.deepEqual(
      r.analysis.joblessSnapshots[0].snapshotCoverage,
      base.snapshotCoverage,
    );
    assert.equal(r.analysis.joblessSnapshots[0].status, "completed");
  }
});
