import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../../../", import.meta.url));
for (const args of [
  [
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix",
    "onboarding",
  ],
  ["run", "check", "--prefix", "onboarding"],
]) {
  const result = spawnSync("npm", args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
