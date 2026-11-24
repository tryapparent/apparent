import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

const [control, candidate, evidence, ...extra] = process.argv.slice(2);
assert.ok(
  control &&
    candidate &&
    evidence &&
    !extra.length &&
    [control, candidate, evidence].every(isAbsolute),
);
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const work = mkdtempSync("/tmp/apparent-dev-handoff-hosted-");
const temp = join(work, "tmp");
mkdirSync(temp, { mode: 0o700 });
const env: NodeJS.ProcessEnv = {
  ...process.env,
  TMPDIR: temp,
  RUNNER_TEMP: temp,
};
delete env.WAYLAND_DISPLAY;
delete env.DBUS_SESSION_BUS_ADDRESS;
function build(root: string) {
  const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(join(root, "APPARENT_BENCH_REVISION"), revision + "\n");
  const cwd = join(root, "capture/desktop/ui/frontend");
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd,
    env,
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["node_modules/electron/install.js"], {
    cwd,
    env,
    stdio: "inherit",
  });
  execFileSync("npm", ["run", "build"], { cwd, env, stdio: "inherit" });
  return revision;
}
const controlSha = build(control);
const candidateSha = candidate === control ? controlSha : build(candidate);
const frontend = join(control, "capture/desktop/ui/frontend");
execFileSync(
  "npx",
  ["--no-install", "playwright", "install-deps", "chromium"],
  {
    cwd: frontend,
    env,
    stdio: "inherit",
  },
);

function measure(mode: "baseline" | "compare") {
  const previous = new Set(readdirSync(work));
  const result = spawnSync(
    "xvfb-run",
    [
      "-a",
      process.execPath,
      "composition/pill/enablement/focused-handoff.ts",
      mode,
      work,
      control,
      ...(mode === "compare" ? [candidate] : []),
    ],
    { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const target = join(evidence, mode);
  mkdirSync(target, { mode: 0o700 });
  writeFileSync(join(target, "stdout.log"), result.stdout ?? "");
  writeFileSync(join(target, "stderr.log"), result.stderr ?? "");
  const batches = readdirSync(work).filter(
    (name) => !previous.has(name) && name.startsWith(mode + "-"),
  );
  for (const batch of batches) {
    const source = join(work, batch);
    for (const item of readdirSync(source, { withFileTypes: true }))
      if (item.isFile() && /\.(json|txt)$/.test(item.name))
        copyFileSync(join(source, item.name), join(target, item.name));
  }
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || "Handoff driver failed");
  assert.equal(batches.length, 1, "Expected one benchmark batch");
  const receipt = JSON.parse(
    readFileSync(join(target, "comparison.json"), "utf8"),
  );
  assert.equal(receipt.control.revision, controlSha);
  assert.equal(
    receipt.candidate.revision,
    mode === "baseline" ? controlSha : candidateSha,
  );
  assert.equal(receipt.qualified, true, "Handoff guard rejected the receipt");
  console.log(
    JSON.stringify({
      mode,
      score: receipt.score,
      repeats: receipt.repeats,
      sameBuildSpeedNoise: receipt.sameBuildSpeedNoise,
    }),
  );
}
measure("baseline");
if (candidateSha !== controlSha) measure("compare");
