import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function recordMediaCommands() {
  const cwd = "record/media";
  return [
    {
      argv: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      cwd,
    },
    { argv: ["npm", "run", "build"], cwd },
    { argv: ["npm", "run", "typecheck"], cwd },
    { argv: ["npm", "test"], cwd },
  ];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  for (const { argv, cwd } of recordMediaCommands()) {
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd: resolve(root, cwd),
      env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw Error(
        `Record media command failed (${result.signal || result.status}): ${argv.join(" ")}`,
      );
    }
  }
}
