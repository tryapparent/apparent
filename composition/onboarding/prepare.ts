import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = new URL("../../", import.meta.url);
function run(owner: string, args: string[]) {
  const result = spawnSync("npm", args, {
    cwd: fileURLToPath(new URL(owner, root)),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const owner of [
  "onboarding/",
  "connect/native-adapter/",
  "composition/onboarding/",
]) {
  run(owner, [
    "ci",
    "--install-links=false",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  if (owner === "onboarding/") run(owner, ["run", "build"]);
}
run("composition/onboarding/", ["run", "typecheck"]);
run("composition/onboarding/", ["run", "build"]);
