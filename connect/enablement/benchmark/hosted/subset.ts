import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function cpuList(spec: string) {
  assert.match(spec, /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
  return spec
    .split(",")
    .flatMap((range) => {
      const [first, last = first] = range.split("-").map(Number);
      assert.ok(
        Number.isSafeInteger(last) && last >= first && last - first < 4096,
      );
      return Array.from(
        { length: last - first + 1 },
        (_, index) => first + index,
      );
    })
    .sort((a, b) => a - b);
}

export function completeSubsets(topology: { cpu: number; siblings: string }[]) {
  const allowed = topology.map(({ cpu }) => cpu).sort((a, b) => a - b);
  const candidates = new Map<string, number[]>();
  for (const { cpu, siblings } of topology) {
    const cpus = cpuList(siblings);
    assert.ok(
      cpus.includes(cpu) && cpus.every((member) => allowed.includes(member)),
    );
    for (const member of cpus) {
      const peer = topology.find((row) => row.cpu === member);
      assert.deepEqual(cpuList(peer!.siblings), cpus);
    }
    if (cpus.length < allowed.length) candidates.set(cpus.join(","), cpus);
  }
  assert.ok(
    candidates.size > 1,
    "Runner lacks distinct complete visible SMT subsets",
  );
  return [...candidates.values()];
}

export function replayAffinity(group: string, expected: number[]) {
  const directory = join("/sys/fs/cgroup", group);
  const effective = cpuList(
    readFileSync(join(directory, "cpuset.cpus.effective"), "utf8").trim(),
  );
  const status = readFileSync("/proc/self/status", "utf8");
  const allowed = cpuList(
    /^Cpus_allowed_list:\s*([0-9,-]+)$/m.exec(status)?.[1] ?? "",
  );
  assert.deepEqual(
    effective,
    expected,
    "Replay cgroup did not enforce the selected subset",
  );
  assert.deepEqual(
    allowed,
    expected,
    "Replay supervisor did not inherit the selected subset",
  );
  return {
    effective,
    allowed,
    visibleCores: 1,
    logicalCapacity: effective.length,
  };
}

export async function withInjectedCpu<T>(cpu: number, run: () => Promise<T>) {
  const child = spawn(
    "taskset",
    [
      "-c",
      String(cpu),
      process.execPath,
      fileURLToPath(import.meta.url),
      "inject",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const closed = once(child, "close");
  void closed.catch(() => {});
  try {
    const [data] = await once(child.stdout, "data", {
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(data.toString().trim(), "ready");
    const result = await run();
    assert.equal(
      child.exitCode,
      null,
      "Injected CPU process ended before the probe",
    );
    return result;
  } finally {
    child.kill("SIGTERM");
    await closed;
  }
}

if (
  process.argv[2] === "inject" &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.stdout.write("ready\n");
  const end = performance.now() + 15000;
  while (performance.now() < end) {}
}
