import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountingHierarchy,
  allowedCpuList,
} from "../fixtures/host-accounting.ts";
import { command } from "./job.ts";

export function runInMeasurementScope(
  entry: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  output?: string,
) {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  assert.ok(uid && gid, "Benchmark process must run as an unprivileged user");
  for (const path of accountingHierarchy().hierarchy) {
    const quota = join(path, "cpu.max");
    if (existsSync(quota))
      assert.match(
        readFileSync(quota, "utf8"),
        /^max \d+\s*$/,
        "Runner CPU quota prevents an equivalent scope",
      );
  }
  const unit = "apparent-record-bench-" + randomUUID() + ".scope";
  const invocation = [
    "-n",
    "/usr/bin/systemd-run",
    "--scope",
    "--quiet",
    "--collect",
    "--unit=" + unit,
    "--property=CPUAccounting=yes",
    "--",
    "/usr/bin/setpriv",
    "--reuid=" + uid,
    "--regid=" + gid,
    "--init-groups",
    "--no-new-privs",
    "/usr/bin/env",
    "-i",
    ...Object.entries({
      ...env,
      APPARENT_RECORD_HOSTED_SCOPE: unit,
      APPARENT_RECORD_HOST_CPU_LIST: allowedCpuList(),
    })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => key + "=" + value),
    process.execPath,
    entry,
    ...args,
  ];
  const outputFd =
    output === undefined ? undefined : openSync(output, "wx", 0o600);
  try {
    command("sudo", invocation, { outputFd });
  } finally {
    if (outputFd !== undefined) closeSync(outputFd);
  }
}
