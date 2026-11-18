import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildBend } from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

export const admissionSource = fileURLToPath(
  new URL("../../../completion/src/copy-admission.bend", import.meta.url),
);

export function buildAdmission(destination: string): Promise<void> {
  return buildBend(root, "record", destination);
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
