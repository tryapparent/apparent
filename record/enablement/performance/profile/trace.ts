import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { now } from "../fixture-clock.ts";
import {
  durationMs,
  guestProfileConfig,
  hostProfileConfig,
  laneDurationMs,
  laneSizeLimit,
  profileConfig,
} from "./config.ts";

const tracebox = "/usr/local/libexec/apparent-bench-tracebox";
const configurations = {
  finish: ["perfetto.pbtxt", profileConfig],
  guest: ["guest.pbtxt", guestProfileConfig],
  host: ["host.pbtxt", hostProfileConfig],
} as const;
type Scope = keyof typeof configurations;

function invocation(scope: Scope) {
  const config = join("/etc/apparent-bench", configurations[scope][0]);
  return [tracebox, "--txt", "-c", config, "-o", "-", "--notify-fd", "2"];
}

export async function verifyProfiler(
  out: string,
  exec: (program: string, args: string[]) => Promise<string>,
  scope: Scope = "finish",
) {
  const command = invocation(scope);
  const config = command[3];
  for (const path of [tracebox, dirname(tracebox), config, dirname(config)]) {
    assert.equal(
      await realpath(path),
      path,
      "Use an absolute provisioned Perfetto path",
    );
    const entry = await stat(path);
    assert(
      entry.uid === 0 && (entry.mode & 0o022) === 0,
      "Unsafe Perfetto provisioning: " + path,
    );
  }
  assert.equal(
    await readFile(config, "utf8"),
    configurations[scope][1],
    "Install the benchmark Perfetto configuration for " + scope,
  );
  await exec("sudo", ["-n", "-l", "--", ...command]);
  const profiler = await exec(tracebox, ["--version"]);
  await writeFile(
    join(out, "profile.json"),
    JSON.stringify({ profiler, scope }) + "\n",
    {
      flag: "wx",
      mode: 0o600,
    },
  );
}

export async function recordProfile(
  out: string,
  name: string,
  command: string[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const trace = join(out, name + ".perfetto-trace");
  const log = join(out, name + ".perfetto.log");
  const started = await now();
  const errors = openSync(log, "wx", 0o600);
  const child = (() => {
    try {
      const output = openSync(trace, "wx", 0o600);
      try {
        return spawn(command[0], command.slice(1), {
          stdio: ["ignore", output, errors],
        });
      } finally {
        closeSync(output);
      }
    } finally {
      closeSync(errors);
    }
  })();
  let finished = false;
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      finished = true;
      reject(error);
    });
    child.once("close", (code, termination) => {
      finished = true;
      if (code === 0) resolve();
      else reject(Error("Perfetto exited with " + (termination ?? code)));
    });
  });
  const stoppedBeforeReady = exited.then(() => {
    throw Error("Perfetto exited before readiness");
  });
  stoppedBeforeReady.catch(() => {});
  const interrupt = () => {
    child.kill("SIGINT");
  };
  signal?.addEventListener("abort", interrupt, { once: true });
  try {
    const ready = AbortSignal.any([
      AbortSignal.timeout(3500),
      ...(signal ? [signal] : []),
    ]);
    while (true) {
      ready.throwIfAborted();
      const status = (await readFile(log)).find((byte) => byte < 8);
      if (status !== undefined) {
        assert.equal(status, 0, "Perfetto data sources failed to start");
        break;
      }
      await Promise.race([
        stoppedBeforeReady,
        delay(25, undefined, { signal: ready }),
      ]);
    }
    const armed = await now();
    return {
      started,
      armed,
      async finish(stop: boolean) {
        const ended = await now();
        try {
          if (stop)
            assert(
              !finished && child.exitCode === null && child.kill("SIGINT"),
              "Perfetto ended before the benchmark lane",
            );
          await exited;
          const { size } = await stat(trace);
          assert(size > 0, "Perfetto emitted an empty trace");
          return { started, armed, ended, size };
        } finally {
          signal?.removeEventListener("abort", interrupt);
        }
      },
      async cancel() {
        signal?.removeEventListener("abort", interrupt);
        interrupt();
        await exited.catch(() => {});
      },
    };
  } catch (error) {
    signal?.removeEventListener("abort", interrupt);
    interrupt();
    await exited.catch(() => {});
    throw error;
  }
}

export async function startProfile(out: string, signal: AbortSignal) {
  const trace = await recordProfile(
    out,
    "long-narration",
    ["sudo", "-n", "--", ...invocation("finish")],
    signal,
  );
  return {
    async finish(clipboard: number) {
      const { started, armed } = await trace.finish(false);
      assert(
        clipboard <= started + durationMs,
        "Clipboard fell outside the Perfetto window",
      );
      await writeFile(
        join(out, "perfetto-window.json"),
        JSON.stringify({ started, armed, clipboard, durationMs }) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    },
  };
}

export async function startLaneProfile(
  out: string,
  scope: "guest" | "host",
  signal?: AbortSignal,
) {
  await mkdir(out, { recursive: true, mode: 0o700 });
  const trace = await recordProfile(
    out,
    "lane",
    ["sudo", "-n", "--", ...invocation(scope)],
    signal,
  );
  return {
    cancel: trace.cancel,
    async finish() {
      const bounds = await trace.finish(true);
      assert(
        bounds.ended < bounds.started + laneDurationMs,
        "Perfetto duration limit reached",
      );
      assert(bounds.size < laneSizeLimit, "Perfetto file limit reached");
      await writeFile(
        join(out, "lane-window.json"),
        JSON.stringify({ ...bounds, clock: "linux-boottime-ms", scope }) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    },
  };
}
