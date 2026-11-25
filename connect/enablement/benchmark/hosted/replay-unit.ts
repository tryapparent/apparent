import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readCpuQuota, readCpuUsage } from "./quota.ts";

type UnitResult = {
  replayPath: string;
  replayCgroup: { path: string; beforeUsec: number; afterUsec: number };
};

export function runReplayUnit(
  tasksetArgs: string[],
  cwd: string,
  tmp: string,
): UnitResult {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  assert.ok(
    uid && gid !== undefined,
    "Replay unit needs the unprivileged runner account",
  );
  const name = "apparent-connect-replay-" + randomUUID() + ".service";
  const output = execFileSync(
    "sudo",
    [
      "--non-interactive",
      "systemd-run",
      "--quiet",
      "--pipe",
      "--wait",
      "--collect",
      "--expand-environment=no",
      "--service-type=exec",
      "--property=RuntimeMaxSec=90s",
      "--property=CPUAccounting=yes",
      "--unit=" + name,
      "--uid=" + uid,
      "--gid=" + gid,
      "--working-directory=" + cwd,
      "--setenv=TMPDIR=" + tmp,
      "--",
      process.execPath,
      fileURLToPath(import.meta.url),
      name,
      ...tasksetArgs,
    ],
    { encoding: "utf8", timeout: 95000 },
  );
  return JSON.parse(output) as UnitResult;
}

async function replay(
  name: string,
  tasksetArgs: string[],
): Promise<UnitResult> {
  assert.ok(process.getuid?.(), "Replay must run without root privileges");
  const {
    groups: [{ path }],
    limits,
  } = await readCpuQuota();
  assert.equal(
    basename(path),
    name,
    "Replay did not enter its dedicated cgroup",
  );
  assert.ok(
    limits.every((limit) => limit.startsWith("max ")),
    "Replay cgroup introduced a CPU quota",
  );
  const beforeUsec = await readCpuUsage(path);
  const replayPath = execFileSync("taskset", tasksetArgs, {
    encoding: "utf8",
  }).trim();
  const afterUsec = await readCpuUsage(path);
  assert.ok(
    afterUsec > beforeUsec,
    "Replay cgroup CPU counter did not advance",
  );
  return { replayPath, replayCgroup: { path, beforeUsec, afterUsec } };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [name, ...args] = process.argv.slice(2);
  assert.match(name ?? "", /^apparent-connect-replay-[0-9a-f-]{36}\.service$/);
  console.log(JSON.stringify(await replay(name, args)));
}
