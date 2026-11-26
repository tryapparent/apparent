import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(
  new URL("../../../../capture/desktop/ui/frontend/", import.meta.url),
);
const fixtureTest = fileURLToPath(
  new URL("../../settings/recording-fixture.test.ts", import.meta.url),
);
const smoke = fileURLToPath(
  new URL(
    "../../../../composition/settings/enablement/recording.smoke.ts",
    import.meta.url,
  ),
);
const run = (program: string, args: string[]) =>
  execFileSync(program, args, { cwd: frontend, stdio: "inherit" });

if (process.argv[2] === "--prepare") {
  run("npm", ["ci", "--no-audit", "--no-fund"]);
  run(process.execPath, ["node_modules/electron/install.js"]);
  run("sudo", [
    "apt-get",
    "install",
    "-y",
    "--no-install-recommends",
    "x11-utils",
  ]);
  run("npx", ["--no-install", "playwright", "install-deps", "chromium"]);
} else {
  run(process.execPath, ["--experimental-strip-types", "--test", fixtureTest]);
  run("npm", ["run", "typecheck:onboarding-renderer"]);
  run("npm", ["run", "build"]);
  run(process.execPath, [
    "--experimental-strip-types",
    "--test",
    "--test-concurrency=1",
    smoke,
  ]);
}
