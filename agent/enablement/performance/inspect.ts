import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname, release } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  benchmarkComparison,
  type Matched,
} from "../../../shared/enablement/performance/comparison.ts";
import {
  cpu,
  siblings,
  idle,
  contentionSnapshot,
  blockContention,
  quiet,
} from "./contention.ts";
import { demoFixtures, fingerprint, loadFixtures } from "./fixtures.ts";
import { loadLedger, stopDecision } from "./stop.ts";
import { assertHosted, throttlingCounters } from "./hosted-environment.ts";
import { probe } from "./trace.ts";

const hosted = process.env.APPARENT_AGENT_HOSTED === "1";
if (hosted) assertHosted();

const [
  controlPath,
  candidatePath,
  work,
  fixtureManifest,
  ledgerPath,
  ...extra
] = process.argv.slice(2);
assert(
  !extra.length &&
    [controlPath, candidatePath, work].every(
      (path) => path && isAbsolute(path),
    ),
  "Usage: node inspect.ts CONTROL_BINARY CANDIDATE_BINARY /tmp/apparent-dev-JOB-RUN [SYNTHETIC_FIXTURES.json|-] [LEDGER.json]",
);
assert(hosted || !ledgerPath, "Campaign ledgers require a hosted replay");
assert(/^\/tmp\/apparent-dev-[^/]+$/.test(work) && realpathSync(work) === work);
const workspace = statSync(work);
assert(
  workspace.isDirectory() &&
    workspace.uid === process.getuid?.() &&
    (workspace.mode & 0o077) === 0,
  "The work directory must be private and owned by the runner",
);
const job = mkdtempSync(join(work, "inspect-"));
const home = join(job, "home");
const temp = join(job, "tmp");
for (const path of [home, temp]) mkdirSync(path, { mode: 0o700 });
const env = {
  PATH: process.env.PATH,
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  HOME: home,
  XDG_CONFIG_HOME: join(home, "config"),
  XDG_CACHE_HOME: join(home, "cache"),
  XDG_DATA_HOME: join(home, "data"),
  APPARENT_CONFIG: join(home, "config", "apparent", "config.json"),
  APPARENT_DESKTOP_REPORTING: "0",
  APPARENT_REPORTING_ENVIRONMENT: "synthetic",
  TMPDIR: temp,
};
const run = (path: string, args: string[]) =>
  execFileSync(path, args, {
    cwd: job,
    env,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
const binaryDigest = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function inventory(path: string) {
  const version = run(path, ["--version"]).trim();
  const abbreviated = version.match(/ · ([0-9a-f]{7,40})$/)?.[1];
  assert(
    abbreviated,
    "Build must identify a clean source revision: " + version,
  );
  const revision = hosted
    ? process.env.APPARENT_AGENT_BUILD_REVISIONS?.split(",").find((sha) =>
        sha.startsWith(abbreviated),
      )
    : execFileSync(
        "git",
        ["rev-parse", "--verify", abbreviated + "^{commit}"],
        {
          cwd: new URL("../../../", import.meta.url),
          encoding: "utf8",
        },
      ).trim();
  assert(revision, "The binary does not identify an admitted revision");
  assert(/^[0-9a-f]{40}$/.test(revision));
  return {
    path,
    version,
    revision,
    sha256: binaryDigest(path),
  };
}
const control = inventory(realpathSync(controlPath));
const candidate =
  control.path === realpathSync(candidatePath)
    ? control
    : inventory(realpathSync(candidatePath));
const fixtures = loadFixtures(
  fixtureManifest && fixtureManifest !== "-"
    ? JSON.parse(readFileSync(fixtureManifest, "utf8"))
    : demoFixtures(job, (bundle) => {
        run(control.path, ["demo", "--out", bundle]);
      }),
  (path) => {
    run("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      "-threads",
      "1",
      "-i",
      path,
      "-f",
      "null",
      "-",
    ]);
  },
);

const ledger = ledgerPath && loadLedger(ledgerPath, fixtures, control);

function prewarm(bundle: string) {
  readFileSync(join(bundle, "apparent.json"));
}
const affinity = {
  hostname: hostname(),
  kernel: release(),
  node: process.version,
  cpu,
  siblings,
};
const median = (numbers: number[]) =>
  numbers.toSorted((a, b) => a - b)[Math.floor(numbers.length / 2)];
type Fixture = (typeof fixtures)[number];
const summaryDigests = new Map<string, string>();
function attempt(path: string, fixture: Fixture, prefix: string[] = []) {
  const id = randomUUID();
  const [command, ...args] = [...prefix, path, "inspect", fixture.bundle];
  const startNs = process.hrtime.bigint();
  const child = spawnSync(command, args, {
    cwd: job,
    env,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const endNs = process.hrtime.bigint();
  if (child.error) throw child.error;
  assert.equal(child.status, 0, child.stderr);
  const sha256 = fixture.verify(child.stdout);
  if (!summaryDigests.has(fixture.name))
    summaryDigests.set(fixture.name, sha256);
  assert.equal(
    sha256,
    summaryDigests.get(fixture.name),
    "Summary bytes differ for " + fixture.name,
  );
  return {
    id,
    pid: child.pid,
    ms: Number(endNs - startNs) / 1e6,
    clock: "linux-monotonic",
    startNs: String(startNs),
    endNs: String(endNs),
    stdoutBytes: Buffer.byteLength(child.stdout),
    stdoutSha256: sha256,
  };
}

const binaries = [control, candidate, candidate, control] as const;
type Wait = ReturnType<typeof attempt>;
type Contention = Awaited<ReturnType<typeof idle>>;
const rounds: {
  binary: string;
  before: Contention;
  during: Contention;
  after: Contention;
  throttling?: number[];
  cases: { name: Fixture["name"]; waits: Wait[] }[];
}[] = [];
let qualifiedHost = false;
try {
  for (const binary of binaries) {
    for (const fixture of fixtures) {
      prewarm(fixture.bundle);
      attempt(binary.path, fixture);
    }
    const initialThrottling = hosted ? throttlingCounters() : undefined;
    const before = await idle();
    const blockStart = contentionSnapshot();
    const cases = fixtures.map((fixture) => ({
      name: fixture.name,
      waits: Array.from({ length: 11 }, () => attempt(binary.path, fixture)),
    }));
    await new Promise((done) => setTimeout(done, 500));
    const during = blockContention(blockStart, contentionSnapshot());
    const after = await idle();
    const finalThrottling = hosted ? throttlingCounters() : undefined;
    assert.equal(initialThrottling?.length, finalThrottling?.length);
    const throttling = finalThrottling?.map(
      (count, index) => count - initialThrottling![index],
    );
    rounds.push({
      binary: binary.sha256,
      before,
      during,
      after,
      throttling,
      cases,
    });
  }
  qualifiedHost = rounds.every(
    ({ before, during, after, throttling }) =>
      quiet([...before, ...during, ...after]) &&
      (throttling?.every((count) => count === 0) ?? true),
  );
  writeFileSync(
    join(job, "quiet.json"),
    JSON.stringify(
      { control, candidate, affinity, qualifiedHost, rounds },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  writeFileSync(
    join(job, "failure.json"),
    JSON.stringify(
      { control, candidate, affinity, rounds, error: String(error) },
      null,
      2,
    ) + "\n",
  );
  throw error;
}

const perFixture = fixtures.map(
  (fixture, index) =>
    rounds.map((round) =>
      median(round.cases[index].waits.map(({ ms }) => ms)),
    ) as Matched<number>,
);
const composite = rounds.map(
  (_, index) =>
    perFixture.reduce((sum, times) => sum + times[index], 0) /
    perFixture.length,
) as Matched<number>;
const resources = binaries.map((binary) =>
  fixtures.map((fixture) => {
    const path = join(job, randomUUID() + ".time");
    const wait = attempt(binary.path, fixture, [
      "/usr/bin/time",
      "-o",
      path,
      "-f",
      "%M %O",
    ]);
    const [peakRssKiB, outputBlocks] = readFileSync(path, "utf8")
      .trim()
      .split(" ")
      .map(Number);
    assert([peakRssKiB, outputBlocks].every(Number.isFinite));
    const { cpuMs, stdout }: { cpuMs: number; stdout: string } = JSON.parse(
      run("bun", [
        new URL("./process-cpu.ts", import.meta.url).pathname,
        binary.path,
        fixture.bundle,
      ]),
    );
    assert(Number.isFinite(cpuMs) && cpuMs > 0);
    assert.equal(fixture.verify(stdout), wait.stdoutSha256);
    return { name: fixture.name, id: wait.id, cpuMs, peakRssKiB, outputBlocks };
  }),
);
type DiagnosticWait = Wait & { case: Fixture["name"] };
const diagnostics: {
  binary: string;
  before: DiagnosticWait[];
  observed: Awaited<ReturnType<typeof probe<DiagnosticWait>>>;
  after: DiagnosticWait[];
  overhead: {
    name: Fixture["name"];
    unprobedMs: number[];
    probedMs: number;
    overheadMs: number;
  }[];
  coldIndex: {
    name: Fixture["name"];
    method: string;
    residencyVerified: boolean;
    medianMs: number;
    waits: Wait[];
  }[];
}[] = [];
for (const binary of control.sha256 === candidate.sha256
  ? [control]
  : [control, candidate]) {
  const directory = join(job, binary.sha256);
  mkdirSync(directory, { mode: 0o700 });
  const sample = () =>
    fixtures.flatMap((fixture) =>
      Array.from({ length: 7 }, () => ({
        case: fixture.name,
        ...attempt(binary.path, fixture),
      })),
    );
  const before = sample();
  const observed = await probe(binary.path, directory, before.length, sample);
  const after = sample();
  const coldIndex = fixtures
    .filter(
      ({ bundle }) =>
        bundle.startsWith(job + "/") ||
        (hosted && bundle.startsWith(work + "/")),
    )
    .map((fixture) => {
      const index = join(fixture.bundle, "apparent.json");
      run("sync", ["-d", index]);
      const waits = Array.from({ length: 7 }, () => {
        run("dd", ["if=" + index, "iflag=nocache", "count=0", "status=none"]);
        return attempt(binary.path, fixture);
      });
      return {
        name: fixture.name,
        method: "owned-manifest-posix-fadvise-dontneed",
        residencyVerified: false,
        medianMs: median(waits.map(({ ms }) => ms)),
        waits,
      };
    });
  const overhead = fixtures.map(({ name }) => {
    const times = (rows: typeof before) =>
      median(rows.filter((row) => row.case === name).map(({ ms }) => ms));
    const unprobedMs = [times(before), times(after)];
    const probedMs = times(observed);
    return {
      name,
      unprobedMs,
      probedMs,
      overheadMs: probedMs - (unprobedMs[0] + unprobedMs[1]) / 2,
    };
  });
  diagnostics.push({
    binary: binary.sha256,
    before,
    observed,
    after,
    overhead,
    coldIndex,
  });
}
const budgets: { metric: string; fixture: string; limit: number[] }[] =
  fixtures.flatMap((_, index) => {
    const baselines = [resources[0][index], resources[3][index]];
    return [resources[1][index], resources[2][index]].flatMap((row) => {
      const peakRssKiB = Math.max(
        ...baselines.map((reference) => reference.peakRssKiB),
      );
      return [
        {
          metric: "peakRssKiB",
          fixture: row.name,
          limit: [row.peakRssKiB, peakRssKiB, Math.max(2048, peakRssKiB / 10)],
        },
        {
          metric: "outputBlocks",
          fixture: row.name,
          limit: [row.outputBlocks, 0],
        },
      ];
    });
  });
for (const [index, { name }] of fixtures.entries()) {
  const reference = Math.max(
    resources[0][index].cpuMs,
    resources[3][index].cpuMs,
  );
  for (const round of [resources[1], resources[2]]) {
    budgets.push({
      metric: "processCpuMs",
      fixture: name,
      limit: [round[index].cpuMs, reference, Math.max(0.5, reference / 10)],
    });
  }
}
const comparison = await benchmarkComparison(
  [composite, ...perFixture],
  budgets.map(({ limit }) => [limit[0], limit[1], limit[2]]),
);
const guards = budgets.map(({ metric, fixture, limit }, index) => ({
  metric,
  fixture,
  limit,
  passed: comparison.permitted[index],
}));
for (const fixture of fixtures)
  assert.deepEqual(fingerprint(fixture.bundle), fixture.fingerprint);
for (const binary of new Set([control, candidate]))
  assert.equal(
    binaryDigest(binary.path),
    binary.sha256,
    "Binary changed during the benchmark",
  );
assert.deepEqual(readdirSync(temp), [], "Inspect left scratch files");
assert(!existsSync(env.APPARENT_CONFIG), "Inspect wrote configuration");
const { controlMeanMs } = comparison.timings[0];
const score =
  control.sha256 === candidate.sha256 ? 100 : comparison.timings[0].score;
const referenceRepeats: [number, number] = [
  (100 * composite[0]) / controlMeanMs,
  (100 * composite[3]) / controlMeanMs,
];
const qualified = qualifiedHost && guards.every(({ passed }) => passed);
const sameBuild = control.sha256 === candidate.sha256;
const stop = await stopDecision(
  ledger ? ledger.repeats : referenceRepeats,
  ledger ? hosted : hosted && qualified && sameBuild,
  ledger ? ledger.experiments : [],
);
const invalidReasons = [
  ...(!qualifiedHost
    ? [
        "CPU contention, guest steal, or cgroup throttling invalidated a scored block",
      ]
    : []),
  ...guards
    .filter(({ passed }) => !passed)
    .map(({ metric, fixture }) => metric + " over budget for " + fixture),
];
const receipt = {
  schema: 1,
  job,
  control,
  candidate,
  affinity,
  venue: hosted ? "github-hosted-ubuntu-24.04" : "local-diagnostic",
  score: qualified && hosted ? score : null,
  qualified,
  invalidReasons,
  timing: comparison.timings[0],
  cases: fixtures.map(({ name, fingerprint, images }, index) => ({
    name,
    fingerprint,
    images,
    ...comparison.timings[index + 1],
  })),
  repeatScores: [
    (100 * composite[1]) / controlMeanMs,
    (100 * composite[2]) / controlMeanMs,
  ],
  rounds,
  resources,
  guards,
  stop,
  ...(ledger ? { frozenControl: ledger.reference } : {}),
};
const withoutScore = <T extends { score: number }>({
  score: _score,
  ...raw
}: T) => raw;
const report = hosted
  ? { ...receipt, diagnostics }
  : {
      ...receipt,
      timing: withoutScore(receipt.timing),
      cases: receipt.cases.map(withoutScore),
      repeatScores: null,
      diagnostics,
    };
writeFileSync(
  join(job, "receipt.json"),
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
if (!qualified) process.exitCode = 1;
