import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.argv[2];
const load = createRequire(path.join(root, "package.json"));
const { build } = load("esbuild");
const scratch = await mkdtemp(
  path.join(
    process.env.RUNNER_TEMP ?? tmpdir(),
    "apparent-dev-openrouter-policy-",
  ),
);
try {
  execFileSync(
    process.execPath,
    [
      path.resolve(root, "../../../../record/enablement/ci/bend/build.ts"),
      scratch,
      "captions",
    ],
    { stdio: "inherit" },
  );
  const entry = path.join(scratch, "openrouter.ts");
  await copyFile(
    path.resolve(root, "../../../../record/transcription/src/openrouter.ts"),
    entry,
  );
  await build({
    entryPoints: [entry],
    outfile: path.join(root, "electron/settings/openrouter.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
  });
} finally {
  await rm(scratch, { recursive: true, force: true });
}
