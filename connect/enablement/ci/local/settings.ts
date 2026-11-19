import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../../../native-adapter/", import.meta.url));
for (const args of [
  ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
  ["test"],
]) {
  execFileSync("npm", args, { cwd, stdio: "inherit" });
}
