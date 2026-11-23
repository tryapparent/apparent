import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";

export async function hash(file: string) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest("hex");
}

export async function hashInputs(repo: string) {
  const paths = execFileSync(
    "git",
    [
      "ls-files",
      "enablement/timing/journey",
      "record/enablement/performance",
      "shared/enablement/performance",
      "onboarding/enablement/performance.ts",
      "composition/settings/enablement/performance.ts",
      "composition/pill/enablement/handoff-timing.ts",
      "connect/enablement/benchmark",
      "capture/desktop/scripts/linux/gui",
    ],
    { cwd: repo, encoding: "utf8" },
  ).trim();
  return Object.fromEntries(
    await Promise.all(
      paths
        .split("\n")
        .map(async (file) => [file, await hash(join(repo, file))]),
    ),
  );
}
