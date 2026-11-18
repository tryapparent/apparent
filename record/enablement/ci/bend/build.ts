import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  prepareBend,
  run,
} from "../../../../shared/enablement/bend/toolchain.ts";

export const admissionSource = fileURLToPath(
  new URL("../../../completion/src/copy-admission.bend", import.meta.url),
);

export async function buildAdmission(destination: string): Promise<void> {
  mkdirSync(destination, { recursive: true });
  const scratch = mkdtempSync(
    join(process.env.RUNNER_TEMP ?? "/tmp", "apparent-dev-bend-build-"),
  );
  const staging = mkdtempSync(join(destination, ".copy-admission-"));
  try {
    const output = join(staging, "copy-admission.mjs");
    const compile = await prepareBend(scratch, { runtime: "node" });
    compile(admissionSource, output);
    run(process.execPath, ["--check", output], scratch);
    renameSync(output, join(destination, "copy-admission.mjs"));
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3)
    throw new Error(
      "Usage: node record/enablement/ci/bend/build.ts <destination>",
    );
  await buildAdmission(resolve(process.argv[2]));
}
