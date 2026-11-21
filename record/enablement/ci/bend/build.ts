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

export function buildBloom(destination: string): Promise<void> {
  return buildRecordModule(
    destination,
    "soft-bloom.mjs",
    "record/pill/soft-bloom.bend",
  );
}

async function buildRecordModule(
  destination: string,
  module: string,
  prefix?: string,
): Promise<void> {
  await bendScratch(async (scratch) => {
    await buildBend(root, "record", scratch, undefined, prefix);
    mkdirSync(destination, { recursive: true });
    copyFileSync(join(scratch, module), join(destination, module));
  });
}

async function buildMedia(destination: string): Promise<void> {
  await bendScratch(async (scratch) => {
    await buildBend(root, "record", scratch);
    for (const [folder, module] of [
      ["assembly", "frame-limits.mjs"],
      ["export", "quiet-export.mjs"],
    ]) {
      const output = join(destination, folder);
      mkdirSync(output, { recursive: true });
      copyFileSync(join(scratch, module), join(output, module));
    }
    copyFileSync(
      join(scratch, "quiet-export.mjs"),
      join(root, "record/media/src/export/quiet-export.mjs"),
    );
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [destination, mode, ...extra] = process.argv.slice(2);
  if (
    !destination ||
    extra.length ||
    (mode && mode !== "media" && mode !== "captions" && mode !== "bloom" && mode !== "lip")
  )
    throw new Error(
      "Usage: node record/enablement/ci/bend/build.ts <destination> [media|captions|bloom|lip]",
    );
  if (mode === "media") await buildMedia(resolve(destination));
  else if (mode === "captions")
    await buildRecordModule(
      resolve(destination),
      "caption-admission.mjs",
      "record/transcription/",
    );
  else if (mode === "lip")
    await buildRecordModule(
      resolve(destination),
      "lip-policy.mjs",
      "record/settings/lip-policy.bend",
    );
  else if (mode === "bloom") await buildBloom(resolve(destination));
  else await buildAdmission(resolve(destination));
}
