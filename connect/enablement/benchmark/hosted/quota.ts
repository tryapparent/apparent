import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

const mount = "/sys/fs/cgroup";

async function read(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readCpuQuota(readFile = read) {
  const membership = await readFile("/proc/self/cgroup");
  const path = /^0::(\/[^\n]*)$/m.exec(membership ?? "")?.[1];
  assert.ok(
    path &&
      posix.normalize(path) === path &&
      (await readFile(join(mount, "cgroup.controllers"))) !== undefined,
    "Expected a visible unified cgroup v2 hierarchy",
  );

  const groups = [];
  const limits = [];
  for (let group = path; ; group = dirname(group)) {
    const directory = join(mount, group);
    assert.notEqual(
      await readFile(join(directory, "cgroup.controllers")),
      undefined,
    );
    const maximum = await readFile(join(directory, "cpu.max"));
    if (maximum !== undefined) {
      assert.match(maximum, /^(max|[1-9][0-9]*) [1-9][0-9]*$/);
      limits.push(maximum);
    } else if (group !== "/") {
      const parentControls = await readFile(
        join(mount, dirname(group), "cgroup.subtree_control"),
      );
      assert.notEqual(
        parentControls,
        undefined,
        "Missing parent controller evidence",
      );
      assert.ok(
        !parentControls?.split(/\s+/).includes("cpu"),
        "CPU controller is enabled but cpu.max is unreadable",
      );
    }
    groups.push({ path: group, maximum: maximum ?? null });
    if (group === "/") break;
  }
  return { limits, groups };
}

export async function readCpuUsage(group: string, readFile = read) {
  assert.ok(group.startsWith("/") && posix.normalize(group) === group);
  const value = await readFile(join(mount, group, "cpu.stat"));
  const match = /^usage_usec ([0-9]+)$/m.exec(value ?? "");
  assert.ok(match, "Missing hosted runner cgroup CPU usage counter");
  const usageUsec = Number(match[1]);
  assert.ok(Number.isSafeInteger(usageUsec));
  return usageUsec;
}
