import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import {
  buildBend,
  type proofOptions,
} from "../../../../shared/enablement/bend/build.ts";

export const root = fileURLToPath(new URL("../../../../", import.meta.url));

export async function stageZoom(
  destination: string,
  proof?: ReturnType<typeof proofOptions>,
) {
  await buildBend(root, "agent", destination, proof);
  const worker = readFileSync(join(root, "agent/zoom/worker.ts"), "utf8");
  writeFileSync(
    join(destination, "zoom-worker.mjs"),
    stripTypeScriptTypes(worker),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await stageZoom(process.argv[2]);
