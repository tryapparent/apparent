import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { schedulerPressureUs } from "../fixtures/host-pressure.ts";

const args = process.argv.slice(2);
assert.equal(
  args.length,
  6,
  "Usage: native/start.ts TEMPLATE USER APPIMAGE SHA256 MODEL PRIVATE_JOB",
);
const job = realpathSync(args[5]);
assert.match(job, /^\/tmp\/apparent-dev-[a-zA-Z0-9_-]+$/);
const stat = statSync(job);
assert.ok(stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o700);
const runner = fileURLToPath(
  new URL(
    "../../../../enablement/timing/journey/native/run.ts",
    import.meta.url,
  ),
);
const report = fileURLToPath(new URL("../start-report.ts", import.meta.url));

async function execute(
  script: string,
  parameters: string[],
  stdout: number | "inherit",
) {
  const child = spawn(process.execPath, [script, ...parameters], {
    env: {
      ...process.env,
      APPARENT_BENCH_SURFACE: "picker-skipped",
      APPARENT_BENCH_MEDIA: "1",
    },
    stdio: ["ignore", stdout, "inherit"],
  });
  const interrupt = () => child.kill("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await new Promise<void>((done, fail) => {
      child.once("error", fail);
      child.once("exit", (status, signal) => {
        if (status === 0) done();
        else fail(Error(script + " exited with " + (signal ?? status)));
      });
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

const pressure = openSync(join(job, "host-pressure.tsv"), "wx", 0o600);
const sample = () =>
  writeSync(
    pressure,
    `${process.hrtime.bigint() / 1000n}\t${schedulerPressureUs()}\n`,
  );
let timer: ReturnType<typeof setInterval> | undefined;
try {
  sample();
  timer = setInterval(sample, 500);
  await execute(runner, args, "inherit");
} finally {
  clearInterval(timer);
  closeSync(pressure);
}

const path = join(job, "start.json");
const output = openSync(path, "wx", 0o600);
try {
  await execute(report, [join(job, "vm")], output);
} finally {
  closeSync(output);
}
console.log(path);
const result = JSON.parse(readFileSync(path, "utf8"));
for (const { name, resources } of result.directTakes) {
  if (resources.hostCpuPressurePercent > 5 || resources.guestStealPercent > 5) {
    console.error(name + " exceeded the 5% CPU contention limit");
    process.exitCode = 2;
  }
}
