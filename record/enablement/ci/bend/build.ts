import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

export const admissionSource = fileURLToPath(
  new URL("../../../completion/src/copy-admission.bend", import.meta.url),
);

export function buildAdmission(destination: string): Promise<void> {
  return buildRecordModule(destination, "copy-admission.mjs");
}

async function buildRecordModule(
  destination: string,
  module: string,
  source?: string,
): Promise<void> {
  await bendScratch(async (scratch) => {
    await buildBend(root, "record", scratch);
    mkdirSync(destination, { recursive: true });
    copyFileSync(join(scratch, module), join(destination, module));
    if (source) copyFileSync(join(scratch, module), join(source, module));
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [destination, mode, ...extra] = process.argv.slice(2);
  if (!destination || extra.length || (mode && mode !== "quiet-export"))
    throw new Error(
      "Usage: node record/enablement/ci/bend/build.ts <destination> [quiet-export]",
    );
  if (mode === "quiet-export")
    await buildRecordModule(
      resolve(destination),
      "quiet-export.mjs",
      join(root, "record/media/src/export"),
    );
  else await buildAdmission(resolve(destination));
}
