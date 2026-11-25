import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBend } from "../../../shared/enablement/bend/build.ts";
import {
  evaluateInJob,
  phases,
  type Block,
  type Experiment,
  type HillClimb,
  type Pair,
  type Phase,
} from "./score.ts";
import { traceReceipt, type Probe } from "./trace.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../..");
const fixture = join(here, "fixture.json");
const probe = join(here, "probe.py");
const blockSize = 9;
const hz = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }));
const ns = () => Number(process.hrtime.bigint());
const hashFile = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const median = (values: number[]) =>
  values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const pluginFiles = [
  "__init__.py",
  "adapter.py",
  "evidence.py",
  "process.py",
  "plugin.yaml",
  "skills/recordings/SKILL.md",
];

type Baseline = {
  revision: string;
  build: string;
  binary: string;
  cpu: number;
  sibling: number;
  runner: string;
  runtime: string;
  reference: Pair;
  traceBlocks: Pair;
};

function git(args: string[]) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
}

function buildDigest(directory: string) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        pluginFiles.map((file) => [file, hashFile(join(directory, file))]),
      ),
    )
    .digest("hex");
}

function snapshotRevision(directory: string, revision: string) {
  for (const file of pluginFiles) {
    const destination = join(directory, file);
    mkdirSync(resolve(destination, ".."), { recursive: true, mode: 0o700 });
    const bytes = git(["show", revision + ":hermes/" + file]);
    if (existsSync(destination))
      assert(readFileSync(destination).equals(bytes));
    else writeFileSync(destination, bytes, { flag: "wx" });
  }
}

function fsSnapshot(directory: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        assert(entry.isFile(), "Unexpected synthetic workspace entry " + path);
        return [path, hashFile(path)];
      }),
  );
}

function cpuCounters(cpu: number) {
  const row = readFileSync("/proc/stat", "utf8")
    .split("\n")
    .find((line) => line.startsWith("cpu" + cpu + " "));
  assert(row, "CPU is unavailable");
  const fields = row.trim().split(/\s+/).slice(1, 9).map(Number);
  const total = fields.reduce((sum, field) => sum + field, 0);
  return { busy: total - fields[3], total };
}

function interference(
  start: ReturnType<typeof cpuCounters>,
  end: ReturnType<typeof cpuCounters>,
  ownMs: number,
) {
  const unrelated = Math.max(0, ((end.busy - start.busy) * 1000) / hz - ownMs);
  return {
    unrelatedMs: unrelated,
    totalMs: ((end.total - start.total) * 1000) / hz,
  };
}

const [mode, jobArg, binaryArg, cpuArg, target, hypothesis, secondsArg] =
  process.argv.slice(2);
assert(
  ["prepare", "baseline", "compare", "status"].includes(mode) &&
    jobArg &&
    isAbsolute(jobArg),
  "Usage: node hermes/enablement/performance/run.ts prepare JOB | baseline JOB CLI CPU MAIN_SHA | compare JOB CLI CPU PLUGIN_DIR HYPOTHESIS ACTIVE_SECONDS | status JOB",
);
const job = realpathSync(jobArg);
assert((statSync(job).mode & 0o077) === 0, "Expected a private job directory");
const baselineFile = join(job, "baseline.json");
const ledger = join(job, "experiments");
mkdirSync(ledger, { recursive: true, mode: 0o700 });

const comparisonModule = join(job, "policy/comparison.mjs");
const journeyModule = join(job, "policy/journey-scoring.mjs");
if (mode === "prepare" || (mode === "baseline" && !existsSync(baselineFile))) {
  process.env.RUNNER_TEMP = job;
  if (!existsSync(comparisonModule))
    await buildBend(
      root,
      "shared",
      join(job, "policy"),
      undefined,
      "shared/enablement/performance/comparison.bend",
    );
  if (!existsSync(journeyModule))
    await buildBend(root, "enablement", join(job, "policy"));
  assert.ok(existsSync(comparisonModule) && existsSync(journeyModule));
}
if (mode === "prepare") process.exit(0);
const { contractHash, hillClimb } = JSON.parse(
  execFileSync(
    process.execPath,
    [join(root, "enablement/timing/journey/run.ts"), "contract"],
    { encoding: "utf8" },
  ),
) as { contractHash: string; hillClimb: HillClimb };
const evidenceHash = createHash("sha256")
  .update(
    JSON.stringify([
      contractHash,
      hashFile(comparisonModule),
      hashFile(journeyModule),
      hashFile(probe),
      hashFile(fixture),
      hashFile(fileURLToPath(import.meta.url)),
      hashFile(join(here, "score.ts")),
      hashFile(join(here, "trace.ts")),
    ]),
  )
  .digest("hex");

function priorExperiments() {
  return readdirSync(ledger)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) =>
      read<Experiment & { directory: string }>(join(ledger, name)),
    );
}

if (mode === "status") {
  const baseline = read<Baseline>(baselineFile);
  assert(
    baseline.runner === evidenceHash,
    "Benchmark contract changed after baseline",
  );
  writeSync(
    1,
    JSON.stringify(
      evaluateInJob(
        job,
        hillClimb,
        baseline.reference,
        baseline.build,
        priorExperiments(),
      ),
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

assert(binaryArg && isAbsolute(binaryArg) && target && /^\d+$/.test(cpuArg));
const binary = realpathSync(binaryArg);
const binaryHash = hashFile(binary);
const cpu = Number(cpuArg);
const siblings = readFileSync(
  "/sys/devices/system/cpu/cpu" + cpu + "/topology/thread_siblings_list",
  "utf8",
)
  .trim()
  .split(",")
  .flatMap((range) => {
    const [first, last = first] = range.split("-").map(Number);
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  })
  .filter((thread) => thread !== cpu);
assert(
  siblings.length <= 1,
  "The contention policy supports a single SMT sibling",
);
const sibling = siblings[0];
const home = join(job, "fixture-home");
const tmp = join(home, "tmp");
mkdirSync(tmp, { recursive: true, mode: 0o700 });
const bundle = join(home, "synthetic.apparent");
const env = {
  HOME: home,
  TMPDIR: tmp,
  APPARENT_CONFIG: join(home, "config.json"),
  PATH: "/usr/bin:/bin",
  LC_ALL: "C.UTF-8",
};
const runtime = execFileSync(
  "python3",
  [
    "-B",
    "-c",
    "import PIL, sys; print(sys.version.split()[0] + '/' + PIL.__version__)",
  ],
  { env, cwd: home, encoding: "utf8", timeout: 5000 },
).trim();
const version = execFileSync(binary, ["--version"], {
  env,
  cwd: home,
  encoding: "utf8",
  timeout: 5000,
}).trim();
if (!existsSync(bundle))
  execFileSync("python3", ["-B", probe, "fixture", fixture, bundle], {
    env,
    cwd: home,
    timeout: 5000,
  });

function measure(directory: string, traced: boolean): Block {
  const id = randomUUID();
  const build = buildDigest(directory);
  const diskBefore = fsSnapshot(home);
  const start = cpuCounters(cpu);
  const siblingStart = sibling === undefined ? null : cpuCounters(sibling);
  let totalCpuMs = 0;
  const runtimes = new Set<string>();
  const attempts = Array.from({ length: blockSize }, () => {
    const launchNs = ns();
    const raw = execFileSync(
      "taskset",
      [
        "-c",
        String(cpu),
        "python3",
        "-B",
        probe,
        "probe",
        fixture,
        bundle,
        directory,
        binary,
        traced ? "trace" : "plain",
      ],
      { env, cwd: home, encoding: "utf8", timeout: 30000 },
    );
    const receivedNs = ns();
    const result = JSON.parse(raw) as Probe;
    totalCpuMs += result.totalCpuMs;
    runtimes.add(result.pythonVersion + "/" + result.pillowVersion);
    assert.deepEqual(
      result.attempts.map((row) => row.phase),
      phases,
    );
    const launch = randomUUID();
    return result.attempts.map((row) =>
      traceReceipt(row, launch + "/" + row.phase, launchNs, receivedNs),
    );
  }).flat();
  const contention = interference(start, cpuCounters(cpu), totalCpuMs);
  const siblingContention =
    siblingStart === null
      ? null
      : interference(siblingStart, cpuCounters(sibling), 0);
  const diskAfter = fsSnapshot(home);
  const diskUnchanged =
    JSON.stringify(diskBefore) === JSON.stringify(diskAfter);
  const contentionOk = [contention, siblingContention].every(
    (row) =>
      row === null || (row.totalMs > 0 && row.unrelatedMs / row.totalMs <= 0.1),
  );
  const results = new Set(attempts.map((row) => row.verification.resultSha256));
  const qualified =
    diskUnchanged &&
    contentionOk &&
    results.size === 1 &&
    runtimes.size === 1 &&
    runtimes.has(runtime) &&
    attempts.every(
      (row) =>
        row.verification.transcriptVerified &&
        row.verification.interactionVerified &&
        row.verification.pixelsVerified,
    );
  function aggregate(phase: Phase) {
    const rows = attempts.filter((row) => row.phase === phase);
    return {
      wait: median(rows.map((row) => row.ms)),
      resources: {
        cpuMs: median(rows.map((row) => row.resources.cpuMs)),
        pluginPeakRssKiB: Math.max(
          ...rows.map((row) => row.resources.pluginPeakRssKiB),
        ),
        descendantPeakRssKiB: Math.max(
          ...rows.map((row) => row.resources.descendantPeakRssKiB),
        ),
      },
    };
  }
  const cold = aggregate("cold");
  const warm = aggregate("warm");
  const block = {
    id,
    waits: { cold: cold.wait, warm: warm.wait },
    resources: { cold: cold.resources, warm: warm.resources },
    result: [...results][0],
  };
  write(join(job, id + ".json"), {
    ...block,
    build,
    binaryHash,
    version,
    evidenceHash,
    qualified,
    traced,
    contention,
    siblingContention,
    cpu,
    sibling,
    runtimes: [...runtimes],
    diskUnchanged,
    attempts,
  });
  console.error(
    JSON.stringify({
      id,
      traced,
      qualified,
      waits: block.waits,
      contention,
      siblingContention,
    }),
  );
  assert(qualified, "Unqualified block " + id + ". See the preserved receipt.");
  return block;
}

const control = join(job, "control");
if (mode === "baseline") {
  assert(!existsSync(baselineFile), "The control is already frozen");
  assert.match(target, /^[0-9a-f]{40}$/);
  assert(
    version.endsWith(" · " + target.slice(0, 7)),
    "Apparent CLI does not identify itself as the clean control revision",
  );
  snapshotRevision(control, target);
  const a = measure(control, false);
  const t = measure(control, true);
  const t2 = measure(control, true);
  const a2 = measure(control, false);
  assert(
    [t, t2, a2].every((row) => row.result === a.result),
    "Inconsistent baseline outputs",
  );
  const baseline: Baseline = {
    revision: target,
    build: buildDigest(control),
    binary: binaryHash,
    cpu,
    sibling: sibling ?? -1,
    runner: evidenceHash,
    runtime,
    reference: [a, a2],
    traceBlocks: [t, t2],
  };
  write(baselineFile, baseline);
  const overheadMs = Object.fromEntries(
    phases.map((phase) => [
      phase,
      [t.waits[phase] - a.waits[phase], t2.waits[phase] - a2.waits[phase]],
    ]),
  );
  console.log(
    JSON.stringify(
      {
        baseline,
        overheadMs,
        ...evaluateInJob(job, hillClimb, [a, a2], baseline.build, []),
      },
      null,
      2,
    ),
  );
} else {
  const baseline = read<Baseline>(baselineFile);
  assert(
    baseline.binary === binaryHash &&
      baseline.runner === evidenceHash &&
      baseline.runtime === runtime &&
      baseline.cpu === cpu &&
      baseline.sibling === (sibling ?? -1),
    "Candidate must use the frozen CLI, tooling and CPU",
  );
  assert(hypothesis?.trim() && /^[1-9]\d*$/.test(secondsArg));
  const candidatePath = realpathSync(target);
  const build = buildDigest(candidatePath);
  const history = priorExperiments();
  const previous = evaluateInJob(
    job,
    hillClimb,
    baseline.reference,
    baseline.build,
    history,
  );
  const incumbent =
    previous.incumbent.build === baseline.build
      ? control
      : history.find((entry) => entry.build === previous.incumbent.build)
          ?.directory;
  assert(incumbent && buildDigest(incumbent) === previous.incumbent.build);
  assert(
    build !== previous.incumbent.build,
    "A candidate must change the current incumbent",
  );
  const activeBeforeRunSeconds = Number(secondsArg);
  const started = ns();
  const entry: Experiment & {
    directory: string;
    activeBeforeRunSeconds: number;
    benchmarkSeconds?: number;
  } = {
    hypothesis,
    seconds: activeBeforeRunSeconds,
    build,
    directory: candidatePath,
    activeBeforeRunSeconds,
  };
  try {
    const a = measure(incumbent, false);
    const b = measure(candidatePath, false);
    const b2 = measure(candidatePath, false);
    const a2 = measure(incumbent, false);
    assert(
      buildDigest(candidatePath) === build,
      "Candidate changed during collection",
    );
    entry.control = [a, a2];
    entry.candidate = [b, b2];
  } catch (error) {
    entry.outcome = String(error);
  }
  entry.benchmarkSeconds = Math.ceil((ns() - started) / 1e9);
  entry.seconds += entry.benchmarkSeconds;
  const next = evaluateInJob(
    job,
    hillClimb,
    baseline.reference,
    baseline.build,
    [...history, entry],
  );
  write(
    join(ledger, String(history.length + 1).padStart(5, "0") + ".json"),
    entry,
  );
  console.log(JSON.stringify(next, null, 2));
  if (entry.outcome) process.exitCode = 1;
}
