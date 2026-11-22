import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectGitHub } from "../github.ts";
import { main } from "../index.ts";
import { inspectJobs } from "../snapshots.ts";

const repo = "example/repo";

const captures = JSON.parse(
  readFileSync(new URL("./queued-heads.fixture.json", import.meta.url), "utf8"),
);

for (const [snapshot, offset] of [
  [captures[0], 0],
  [captures[1], 100],
] as const) {
  test(`${snapshot.label} capture prioritizes detail diversity within the exact attempt budget`, async (t) => {
    const requests: string[][] = [];
    const read = (args: string[]) => {
      requests.push(args);
      if (args[0] === "run") return snapshot.lists[args[5]];
      const route = args[1].match(
        /^repos\/example\/repo\/actions\/runs\/(\d+)\/attempts\/(\d+)(\/jobs\?per_page=100&page=1)?$/,
      );
      assert.ok(route);
      if (!route[3]) {
        assert.equal(`${route[1]}/${route[2]}`, "8/2");
        return snapshot.exact;
      }
      const page = snapshot.jobs[`${route[1]}/${route[2]}`];
      assert.ok(page);
      return page;
    };
    const dir = mkdtempSync(join(tmpdir(), "apparent-dev-queued-heads-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const input = join(dir, "empty.jsonl"),
      output = join(dir, "aggregate.json"),
      report = join(dir, "report.md");
    writeFileSync(input, "");
    await main(
      [
        "collect",
        "--input",
        input,
        "--workspace",
        "/example",
        "--from",
        snapshot.from,
        "--to",
        snapshot.to,
        "--out",
        output,
        "--github-repo",
        repo,
        "--ci-run-limit",
        "12",
      ],
      read,
    );
    const { jobs } = JSON.parse(readFileSync(output, "utf8")) as {
      jobs: ReturnType<typeof inspectJobs> & {
        collection: ReturnType<typeof collectGitHub>["coverage"];
      };
    };
    const expected = [
      "1/1",
      "2/1",
      "7/1",
      "9/1",
      `${20 + offset}/2`,
      `${21 + offset}/1`,
      "31/1",
      `${30 + offset}/1`,
      `${32 + offset}/1`,
      `${40 + offset}/1`,
      `${42 + offset}/1`,
      `${43 + offset}/1`,
    ];
    const path = (route: string) =>
      `repos/${repo}/actions/runs/${route.replace("/", "/attempts/")}`;
    const jobRequests = (routes: string[]) =>
      routes.map((route) => ["api", `${path(route)}/jobs?per_page=100&page=1`]);
    const lists = ["queued", "in_progress", "waiting", "completed"].map(
      (status) => [
        "run",
        "list",
        "--repo",
        repo,
        "--status",
        status,
        ...(status === "completed" ? ["--created", `>=${snapshot.from}`] : []),
        "--limit",
        "100",
        "--json",
        "databaseId,headSha,attempt,status,conclusion,createdAt,updatedAt,name",
      ],
    );
    assert.deepEqual(requests, [...lists, ...jobRequests(expected)]);
    assert.deepEqual(
      jobs.collection.jobPages.map((j) => `${j.runId}/${j.attempt}`),
      expected,
    );
    assert.deepEqual(
      jobs.collection.unsampledPreWindowRepeats,
      [
        [3, 2, "a", "waiting", "03"],
        [4, 1, "b", "queued", "04"],
        [5, 1, "a", "queued", "05"],
        [6, 3, "b", "waiting", "06"],
        [8, 2, "c", "queued", "08"],
      ].map(([runId, attempt, head, status, minute]) => ({
        runId,
        attempt,
        headSha: String(head).repeat(40),
        status,
        createdAt: `2026-11-03T00:${minute}:00Z`,
        coverage: "listing-only",
      })),
    );
    assert.equal(jobs.analysis.coverage.inputJobRows, 12);
    assert.deepEqual(jobs.analysis.joblessSnapshots, []);
    assert.equal(
      jobs.jobs.find((j) => j.id === `${20 + offset}:2:${1020 + offset}`)
        .runnerSeconds,
      0,
    );
    assert.equal(
      jobs.jobs.find((j) => j.id === `${20 + offset}:2:${1020 + offset}`)
        .queueSeconds,
      21540,
    );
    assert.equal(
      jobs.jobs.find((j) => j.id === "7:1:1007").runningAtCutoff,
      true,
    );
    await main(["format", "--input", output, "--out", report]);
    const formatted = readFileSync(report, "utf8");
    assert.match(formatted, /unsampledPreWindowRepeats.*listing-only/);
    assert.ok(
      formatted.includes(
        `7:1:1007, SHA ${"c".repeat(40)}, step 3 Verify fixture`,
      ),
    );

    requests.length = 0;
    const focused = collectGitHub(
      repo,
      snapshot.from,
      snapshot.to,
      12,
      read,
      `8/2/${"c".repeat(40)}`,
    );
    assert.deepEqual(focused.coverage.exactAttempt, {
      runId: 8,
      attempt: 2,
      headSha: "c".repeat(40),
      status: "captured",
    });
    assert.ok(focused.runs.some((run) => run.databaseId === 7));
    assert.ok(
      !focused.coverage.unsampledPreWindowRepeats.some(
        (run) => run.runId === 8,
      ),
    );
    assert.deepEqual(requests.slice(0, 6), [
      ...lists,
      ["api", path("8/2")],
      ...jobRequests(["8/2"]),
    ]);
    assert.equal(requests.length, 17);
    assert.equal(
      requests.filter((a) => a[1] === `${path("8/2")}/jobs?per_page=100&page=1`)
        .length,
      1,
    );

    requests.length = 0;
    const spare = collectGitHub(repo, snapshot.from, snapshot.to, 20, read);
    const backfill = ["3/2", "4/1", "5/1", "6/3", "8/2"];
    assert.deepEqual(requests, [
      ...lists,
      ...jobRequests([...expected, `${41 + offset}/2`, ...backfill]),
    ]);
    assert.deepEqual(spare.coverage.unsampledPreWindowRepeats, []);
    assert.equal(spare.coverage.runLimitReached, false);
    const analysis = inspectJobs(
      spare.runs,
      Date.parse(snapshot.from),
      Date.parse(snapshot.to),
    ).analysis;
    assert.deepEqual(
      analysis.joblessSnapshots.map((r) => [
        `${r.runId}/${r.attempt}`,
        r.snapshotCoverage,
      ]),
      backfill
        .slice(0, 4)
        .map((route) => [
          route,
          { pages: 1, expectedJobs: 0, capturedJobs: 0, complete: true },
        ]),
    );
    assert.deepEqual(
      analysis.runningJobs
        .filter((j) => j.headSha === "c".repeat(40))
        .map((j) => j.id),
      ["7:1:1007", "8:2:1008"],
    );
  });
}
