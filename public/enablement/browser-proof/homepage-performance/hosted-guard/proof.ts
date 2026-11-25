import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  evaluateInterference,
  hostedSampler,
  scopeCommand,
} from "./interference.ts";

const [mode, scope] = process.argv.slice(2);
assert(scope);

if (mode === "witness") {
  const sample = hostedSampler(scope);
  const before = sample();
  const deadline = performance.now() + 850;
  while (performance.now() < deadline) Math.sqrt(Math.random());
  console.log(JSON.stringify(evaluateInterference(before, sample())));
} else {
  assert.equal(mode, "prove");
  const capture = () =>
    JSON.parse(
      execFileSync(
        "sh",
        scopeCommand(scope, process.execPath, [
          fileURLToPath(import.meta.url),
          "witness",
          scope,
        ]),
        { encoding: "utf8", timeout: 8_000 },
      ),
    ) as ReturnType<typeof evaluateInterference>;
  const isolated = capture();
  assert(isolated.benchmarkCpuUs > 300_000, "Missing in-scope CPU activity");
  const worker = spawn(
    process.execPath,
    [
      "-e",
      `
    const end = performance.now() + 2500;
    process.stdout.write("started");
    while (performance.now() < end) Math.sqrt(Math.random());
  `,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const exited = once(worker, "exit");
  let injected;
  try {
    const [started] = await once(worker.stdout, "data");
    assert.equal(String(started), "started");
    injected = capture();
  } finally {
    const [status] = await exited;
    assert.equal(status, 0, "Synthetic outside worker failed");
  }
  console.log(JSON.stringify({ isolated, injected }, null, 2));
  assert.equal(
    injected.checks.unrelatedCpu,
    false,
    "Injected outside CPU was not rejected",
  );
  assert(!injected.passed);
}
