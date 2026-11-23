import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { now } from "../fixture-clock.ts";

const durationMs = 25000;

export async function startProfile(
  tracebox: string,
  executable: string,
  out: string,
  signal: AbortSignal,
) {
  const config = join(out, "perfetto.pbtxt");
  const trace = join(out, "long-narration.perfetto-trace");
  const ready = join(out, "perfetto.ready");
  await writeFile(
    config,
    `
duration_ms: ${durationMs}
buffers { size_kb: 32768 fill_policy: DISCARD }
data_sources {
  config {
    name: "linux.perf"
    perf_event_config {
      timebase {
        counter: SW_CPU_CLOCK
        frequency: 99
        timestamp_clock: PERF_CLOCK_MONOTONIC
      }
      callstack_sampling { scope { target_cmdline: ${JSON.stringify(executable)} } }
    }
  }
}
data_sources {
  config {
    name: "linux.ftrace"
    ftrace_config {
      ftrace_events: "sched/sched_switch"
      ftrace_events: "sched/sched_waking"
    }
  }
}
data_sources {
  config {
    name: "linux.process_stats"
    process_stats_config { scan_all_processes_on_start: true }
  }
}
`,
    { flag: "wx" },
  );
  await writeFile(ready, "", { flag: "wx" });
  const errors = openSync(join(out, "perfetto.log"), "wx", 0o600);
  const output = openSync(trace, "wx", 0o600);
  const started = await now();
  let exited: Promise<void>;
  try {
    const child = spawn(
      "sudo",
      [
        "-n",
        "--",
        "sh",
        "-c",
        'exec "$1" --txt -c "$2" -o - --notify-fd 3 3>"$3"',
        "profile",
        tracebox,
        config,
        ready,
      ],
      { signal, stdio: ["ignore", output, errors] },
    );
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
    const status = await readFile(ready);
    if (status.length) {
      assert.equal(status[0], 0, "Perfetto data sources failed to start");
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
