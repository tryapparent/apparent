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
  writeFileSync,
} from "node:fs";
import { hostname, release } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  benchmarkComparison,
  type Matched,
} from "../../../shared/enablement/performance/comparison.ts";
import { demoFixtures, fingerprint, loadFixtures } from "./fixtures.ts";
import { loadLedger, stopDecision } from "./stop.ts";
import { probe } from "./trace.ts";

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
assert(/^\/tmp\/apparent-dev-[^/]+$/.test(work) && realpathSync(work) === work);
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
function inventory(path: string) {
  const version = run(path, ["--version"]).trim();
  const abbreviated = version.match(/ · ([0-9a-f]{7,40})$/)?.[1];
  assert(
    abbreviated,
    "Build must identify a clean source revision: " + version,
  );
  const revision = execFileSync(
    "git",
    ["rev-parse", "--verify", abbreviated + "^{commit}"],
    {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8",
    },
  ).trim();
  assert(/^[0-9a-f]{40}$/.test(revision));
  return {
    path,
    version,
    revision,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
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

const cpuList = readFileSync("/proc/self/status", "utf8").match(
  /^Cpus_allowed_list:\s+(.+)$/m,
)?.[1];
assert(
  cpuList && /^\d+$/.test(cpuList),
  "Pin this benchmark to one quiet CPU with taskset",
);
const cpu = Number(cpuList);
const siblings = readFileSync(
  "/sys/devices/system/cpu/cpu" + cpu + "/topology/thread_siblings_list",
  "utf8",
)
  .trim()
  .split(",")
  .flatMap((range) => {
    const [first, last = first] = range.split("-").map(Number);
    return Array.from(
      { length: last - first + 1 },
      (_, index) => first + index,
    );
  });
function counters() {
  const lines = readFileSync("/proc/stat", "utf8").split("\n");
  return siblings.map((id) => {
    const line = lines.find((entry) => entry.startsWith("cpu" + id + " "));
    assert(line, "CPU went offline");
    return line.trim().split(/\s+/).slice(1, 9).map(Number);
  });
}
async function idle() {
  const before = counters();
  await new Promise((done) => setTimeout(done, 700));
  return counters().map((after, index) => {
    const elapsed = after.map((value, i) => value - before[index][i]);
    const total = elapsed.reduce((sum, value) => sum + value, 0);
    return { cpu: siblings[index], busy: total ? 1 - elapsed[3] / total : 1 };
  });
}
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
  after: Contention;
  cases: { name: Fixture["name"]; waits: Wait[] }[];
}[] = [];
let qualifiedHost = false;
try {
  for (const binary of binaries) {
    for (const fixture of fixtures) {
      prewarm(fixture.bundle);
      attempt(binary.path, fixture);
    }
    const before = await idle();
    const cases = fixtures.map((fixture) => ({
      name: fixture.name,
      waits: Array.from({ length: 11 }, () => attempt(binary.path, fixture)),
    }));
    const after = await idle();
    rounds.push({ binary: binary.sha256, before, after, cases });
  }
  qualifiedHost = rounds.every(({ before, after }) =>
    [...before, ...after].every(({ busy }) => busy <= 0.1),
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
    return { name: fixture.name, id: wait.id, peakRssKiB, outputBlocks };
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
    .filter(({ bundle }) => bundle.startsWith(job + "/"))
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
const cpuMsByFixture = Object.fromEntries(
  fixtures.map(({ name }) => [
    name,
    diagnostics.map(({ observed }) =>
      median(
        observed
          .filter((row) => row.case === name)
          .map(({ trace }) => trace.cpuMs),
      ),
    ),
  ]),
);
for (const [fixture, [controlCpu, candidateCpu = controlCpu]] of Object.entries(
  cpuMsByFixture,
)) {
  budgets.push({
    metric: "tracedCpuMs",
    fixture,
    limit: [candidateCpu, controlCpu, Math.max(0.5, controlCpu / 10)],
  });
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
assert.deepEqual(readdirSync(temp), [], "Inspect left scratch files");
assert(!existsSync(env.APPARENT_CONFIG), "Inspect wrote configuration");
const { controlMeanMs } = comparison.timings[0];
const score =
  control.sha256 === candidate.sha256 ? 100 : comparison.timings[0].score;
const referenceRepeats: [number, number] = [
  (100 * composite[0]) / controlMeanMs,
  (100 * composite[3]) / controlMeanMs,
];
const ledger = ledgerPath && loadLedger(ledgerPath, fixtures);
const qualified = qualifiedHost && guards.every(({ passed }) => passed);
const sameBuild = control.sha256 === candidate.sha256;
const stop = await stopDecision(
  ledger ? ledger.repeats : referenceRepeats,
  ledger ? true : qualified && sameBuild,
  ledger ? ledger.experiments : [],
);
const invalidReasons = [
  ...(!qualifiedHost
    ? ["CPU or SMT sibling exceeded 10% busy around a scored block"]
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
  score: qualified ? score : null,
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
  cpuMsByFixture,
  guards,
  stop,
  ...(ledger ? { frozenControl: ledger.reference } : {}),
};
const report = { ...receipt, diagnostics };
writeFileSync(
  join(job, "receipt.json"),
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
if (!qualified) process.exitCode = 1;
