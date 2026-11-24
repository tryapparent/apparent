import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  blockContention,
  contentionSnapshot,
  cpu,
  quiet,
} from "./contention.ts";

const load = spawn(
  process.execPath,
  ["-e", "process.stdout.write('started'); for (;;) {}"],
  {
    stdio: ["ignore", "pipe", "inherit"],
  },
);
const exited = once(load, "exit");
try {
  await once(load.stdout, "data");
  const start = contentionSnapshot();
  await new Promise((done) => setTimeout(done, 700));
  const samples = blockContention(start, contentionSnapshot());
  assert(samples.some((sample) => sample.cpu === cpu && sample.busy > 0.1));
  assert(
    !quiet(samples),
    "A competing process escaped the scored contention guard",
  );
  console.log(JSON.stringify({ rejected: true, samples }));
} finally {
  load.kill("SIGKILL");
  await exited;
}
