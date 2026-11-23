import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const prefix = "connect/client/typescript/src/renewal/";

export function buildRenewal(destination: string): Promise<void> {
  return buildBend(root, "connect", destination, undefined, prefix);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination) throw new Error("Expected an embedded renewal output path");
  await bendScratch(async (scratch) => {
    await buildRenewal(scratch);
    const kernel = readFileSync(
      join(scratch, "credential-renewal.mjs"),
      "utf8",
    );
    const exported = "export default {";
    if (kernel.split(exported).length !== 2)
      throw new Error("Expected one default export from Bend");
    const host = readFileSync(join(root, prefix, "transition.ts"), "utf8");
    writeFileSync(
      destination,
      kernel.replace(exported, "const policy = {") +
        "\n" +
        stripTypeScriptTypes(host).replace(/^import policy .*$/m, ""),
    );
  });
}
