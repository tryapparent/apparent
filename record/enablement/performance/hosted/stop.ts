import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForQuietStart } from "../fixtures/host-pressure.ts";
import {
  apt,
  command,
  cpuSample,
  hostCounters,
  json,
  openJob,
  receipt,
  sha256,
  stageRevision,
  stealSince,
} from "./job.ts";
import { cpuNumbers, stopReplayCpus } from "./stop-affinity.ts";
import { fixture, model } from "./stop-input.ts";
import { waterfall } from "./waterfall.ts";

const job = openJob("stop");
const topology = hostCounters().topology;
const allowed = /^Cpus_allowed_list:\s+([0-9,-]+)$/m.exec(
  readFileSync("/proc/self/status", "utf8"),
)?.[1];
assert.ok(allowed, "Missing runner CPU affinity");
assert.equal(topology.length, 4, "Expected four standard runner vCPUs");
const affinity = stopReplayCpus(topology, allowed);
const pinned = command(
  "taskset",
  ["--cpu-list", affinity, "cat", "/proc/self/status"],
  { capture: true, env: job.env },
);
const observed = /^Cpus_allowed_list:\s+(\S+)$/m.exec(pinned)?.[1];
assert.ok(observed, "Missing pinned process CPU affinity");
assert.deepEqual(cpuNumbers(observed), cpuNumbers(affinity));
receipt(join(job.evidence, "stop-affinity.json"), {
  topology,
  allowed,
  replayCpuList: affinity,
  verifiedCpuList: observed,
});
apt("xvfb", "xauth", "weston", "ffmpeg", "espeak-ng", "time");
const target = join(job.scratch, "cargo-target");
const packaging = join(job.scratch, "appimage-packaging");
const env = {
  ...job.env,
  CARGO_TARGET_DIR: target,
  RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(process.env.HOME!, ".rustup"),
  APPARENT_APPIMAGE_OUT: packaging,
  APPARENT_REPORTING_ENVIRONMENT: "synthetic",
};
command("rustup", ["toolchain", "install", "1.99.1", "--profile", "minimal"], {
  env,
});

async function build(
  checkout: string,
  revision: string,
  lane: string,
  install: boolean,
) {
  const cwd = stageRevision(checkout, revision, job, lane);
  const options = { cwd, env: { ...env, GITHUB_SHA: revision } };
  if (install)
    command(
      "bash",
      ["capture/desktop/scripts/linux/appimage/dependencies.sh"],
      options,
    );
  symlinkSync(target, join(cwd, "target"), "dir");
  const desktop = join(cwd, "capture/desktop/ui/frontend");
  command("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    ...options,
    cwd: desktop,
  });
  command(process.execPath, ["node_modules/electron/install.js"], {
    ...options,
    cwd: desktop,
  });
  command(
    process.execPath,
    ["--experimental-strip-types", "enablement/prerequisites/native.ts"],
    options,
  );
  command("cargo", ["+1.99.1", "build", "--release", "--locked"], options);
  command(
    "bash",
    [
      "capture/desktop/scripts/linux/appimage/appimage.sh",
      join(target, "release/apparent"),
    ],
    options,
  );
  const appdir = join(job.scratch, lane + "-appdir");
  const appimage = join(packaging, "Apparent-x86_64.AppImage");
  const hash = await sha256(appimage);
  renameSync(join(packaging, "AppDir"), appdir);
  const version = command(join(appdir, "AppRun"), ["--version"], {
    ...options,
    capture: true,
  });
  assert.ok(
    version.endsWith(" · " + revision.slice(0, 7)),
    "Unexpected packaged build identity " + version,
  );
  receipt(join(job.evidence, lane + "-build.json"), {
    revision,
    version,
    appImageSha256: hash,
  });
  return appdir;
}

const english = await model(job);
const input = await fixture(job);
const control = await build(
  job.control,
  job.revisions.control,
  "control",
  true,
);
const candidate = job.calibrationOnly
  ? undefined
  : await build(job.candidate, job.revisions.candidate, "candidate", false);
const runner = fileURLToPath(new URL("../local/stop.ts", import.meta.url));

function retain(source: string, evidence: string) {
  if (!existsSync(source)) return;
  mkdirSync(evidence, { mode: 0o700 });
  for (const name of [
    "fixture.json",
    "raw.json",
    "comparison.json",
    "weston.log",
  ]) {
    if (!existsSync(join(source, name))) continue;
    if (name === "comparison.json") {
      receipt(join(evidence, name), {
        ...json(join(source, name)),
        raw: "raw.json",
      });
    } else copyFileSync(join(source, name), join(evidence, name));
  }
  for (const arm of readdirSync(source).filter((name) =>
    /^arm-[0-3]$/.test(name),
  )) {
    mkdirSync(join(evidence, arm), { mode: 0o700 });
    for (const name of ["reprocess.log", "resources.tsv", "clipboard.txt"]) {
      if (existsSync(join(source, arm, name)))
        copyFileSync(join(source, arm, name), join(evidence, arm, name));
    }
  }
}

type WaterfallAttempt = {
  trace: {
    host: { name: string; fromMs: number; toMs: number }[];
    timeline?: { spans: { name: string; startMs: number; endMs: number }[] };
  };
};

function retainWaterfall(evidence: string) {
  const rawPath = join(evidence, "raw.json");
  if (!existsSync(rawPath)) return;
  const raw = json(rawPath);
  waterfall(
    join(evidence, "waterfall.html"),
    "Hosted Record Stop",
    "Each arm has its own host clock from replay launch to verified clipboard. Engine panels start at that arm's replay cutoff.",
    raw.trials.flatMap(({ trace }: WaterfallAttempt, index: number) => {
      const arm = "Arm " + (index + 1);
      const host = { label: arm + " · host", rows: trace.host };
      if (!trace.timeline) return [host];
      const rows = trace.timeline.spans.map(({ name, startMs, endMs }) => ({
        name,
        fromMs: startMs,
        toMs: endMs,
      }));
      return [host, { label: arm + " · replay cutoff", rows }];
    }),
  );
}

async function run(label: string, other?: string) {
  const quiet = await waitForQuietStart(AbortSignal.timeout(46_000), [
    "cpu",
    "io",
  ]);
  receipt(join(job.evidence, label + "-quiet.json"), { windows: quiet });
  const output =
    mkdtempSync("/tmp/apparent-dev-record-hosted-stop-") + "-results";
  const evidence = join(job.evidence, label);
  const before = hostCounters();
  const ticks = cpuSample();
  try {
    command(
      process.execPath,
      [
        runner,
        "--hosted-fixture",
        control,
        input,
        english,
        output,
        ...(other ? [other] : []),
      ],
      {
        env: {
          ...job.env,
          APPARENT_STOP_BENCH_SPANS: "1",
          APPARENT_STOP_BENCH_CPUS: affinity,
        },
      },
    );
  } finally {
    receipt(join(job.evidence, label + "-host.json"), {
      before,
      after: hostCounters(),
      stealPercent: stealSince(ticks, cpuSample()),
    });
    retain(output, evidence);
    retainWaterfall(evidence);
  }
  assert.ok(json(join(job.evidence, label + "-host.json")).stealPercent <= 5);
  const report = json(join(output, "comparison.json"));
  assert.equal(report.qualified, true);
  assert.equal(report.transcription, "whole-file");
  assert.equal(report.timingEndpoint, "replay-launch-to-verified-clipboard");
  if (!other) assert.equal(report.timing.score, 100);
}

await run("baseline");
if (candidate) await run("comparison", candidate);
receipt(join(job.evidence, "record-run.json"), {
  lane: "stop",
  qualified: true,
  revisions: job.revisions,
  hostedRun: {
    provider: "github-hosted",
    image: "ubuntu-24.04",
    id: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  },
  baseline: "baseline/comparison.json",
  comparison: candidate ? "comparison/comparison.json" : null,
  cpuAffinity: "stop-affinity.json",
});
