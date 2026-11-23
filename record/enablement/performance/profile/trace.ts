import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { now } from "../fixture-clock.ts";
import { durationMs, profileConfig } from "./config.ts";

const tracebox = "/usr/local/libexec/apparent-bench-tracebox";
const config = "/etc/apparent-bench/perfetto.pbtxt";
const command = [
  tracebox,
  "--txt",
  "-c",
  config,
  "-o",
  "-",
  "--notify-fd",
  "2",
];

export async function verifyProfiler(
  out: string,
  exec: (program: string, args: string[]) => Promise<string>,
) {
  assert.equal(
    await readFile(config, "utf8"),
    profileConfig,
    "Install the benchmark's Perfetto config in the disposable guest",
  );
  try {
    await exec("sudo", ["-n", "-l", "--", ...command]);
  } catch (error) {
    throw Error(
      "The disposable guest needs the Apparent Perfetto command configured in sudoers",
      { cause: error },
    );
  }
  const profiler = await exec(tracebox, ["--version"]);
  await writeFile(
    join(out, "profile.json"),
    JSON.stringify({ profiler, fixture: "long-narration" }) + "\n",
    { flag: "wx" },
  );
}

export async function startProfile(out: string, signal: AbortSignal) {
  const trace = join(out, "long-narration.perfetto-trace");
  const log = join(out, "perfetto.log");
  const errors = openSync(log, "wx", 0o600);
  const output = openSync(trace, "wx", 0o600);
  const started = await now();
  let exited: Promise<void>;
  try {
    const child = spawn("sudo", ["-n", "--", ...command], {
      signal,
      stdio: ["ignore", output, errors],
    });
    exited = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, termination) => {
        if (code === 0) resolve();
        else reject(Error("Perfetto exited with " + (termination ?? code)));
      });
    });
    exited.catch(() => {});
  } finally {
    closeSync(output);
    closeSync(errors);
  }
  const deadline = performance.now() + 3500;
  const stoppedBeforeReady = exited.then(() => {
    throw Error("Perfetto exited before readiness");
  });
  stoppedBeforeReady.catch(() => {});
  while (true) {
    const status = (await readFile(log)).find((byte) => byte < 8);
    if (status !== undefined) {
      assert.equal(status, 0, "Perfetto data sources failed to start");
      break;
    }
    assert(
      performance.now() < deadline,
      "Perfetto did not start before Finish",
    );
    await Promise.race([stoppedBeforeReady, delay(25, undefined, { signal })]);
  }
  const armed = await now();
  return {
    async finish(clipboard: number) {
      await exited;
      assert((await stat(trace)).size > 0, "Perfetto emitted an empty trace");
      assert(
        clipboard <= started + durationMs,
        "Clipboard fell outside the Perfetto window",
      );
      await writeFile(
        join(out, "perfetto-window.json"),
        JSON.stringify({ started, armed, clipboard, durationMs }) + "\n",
        { flag: "wx" },
      );
    },
  };
}
