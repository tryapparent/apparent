import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(
  new URL("../../../capture-request/", import.meta.url),
);

export function buildCaptureRequestPackage() {
  for (const args of [
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    ["run", "build"],
  ])
    execFileSync("npm", args, { cwd: packageRoot, stdio: "inherit" });
}

if (import.meta.main) buildCaptureRequestPackage();
