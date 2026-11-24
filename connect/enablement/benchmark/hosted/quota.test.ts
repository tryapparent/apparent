import assert from "node:assert/strict";
import test from "node:test";
import { readCpuQuota } from "./quota.ts";

const root = "/sys/fs/cgroup";
const fixture = (parentControls: string, childLimit?: string) => {
  const files = new Map<string, string>([
    ["/proc/self/cgroup", "0::/system.slice/runner.service"],
    [root + "/cgroup.controllers", "cpu io memory"],
    [root + "/system.slice/cgroup.controllers", "cpu io memory"],
    [root + "/system.slice/cpu.max", "200000 100000"],
    [root + "/system.slice/cgroup.subtree_control", parentControls],
    [root + "/system.slice/runner.service/cgroup.controllers", "io memory"],
  ]);
  if (childLimit)
    files.set(root + "/system.slice/runner.service/cpu.max", childLimit);
  return async (path: string) => files.get(path);
};

test("reads nested limits and accepts the cgroup v2 root without cpu.max", async () => {
  assert.deepEqual(await readCpuQuota(fixture("cpu io", "100000 100000")), {
    limits: ["100000 100000", "200000 100000"],
    groups: [
      { path: "/system.slice/runner.service", maximum: "100000 100000" },
      { path: "/system.slice", maximum: "200000 100000" },
      { path: "/", maximum: null },
    ],
  });
});

test("requires a readable limit for delegated CPU controllers", async () => {
  await assert.rejects(
    readCpuQuota(fixture("cpu io")),
    /controller is enabled/,
  );
  const quota = await readCpuQuota(fixture("io"));
  assert.deepEqual(quota.limits, ["200000 100000"]);
  assert.equal(quota.groups[0].maximum, null);
});
