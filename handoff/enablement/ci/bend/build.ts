import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { buildBend } from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

export function buildOrdering(
  destination = fileURLToPath(new URL("../../../pure/", import.meta.url)),
): Promise<void> {
  return buildBend(root, "handoff", destination);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await buildOrdering();
}
