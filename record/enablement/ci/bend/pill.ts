import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

export function assemblePill(compiled: string, destination: string): void {
  const kernel = readFileSync(join(compiled, "pill-state.mjs"), "utf8");
  const exported = "export default {";
  if (kernel.split(exported).length !== 2)
    throw new Error("Expected one default export from Bend");
  const host = readFileSync(join(root, "record/pill/host.ts"), "utf8");
  const presentation = readFileSync(
    join(root, "record/pill/presentation.ts"),
    "utf8",
  );
  writeFileSync(
    destination,
    [
      kernel.replace(exported, "const kernel = {"),
      stripTypeScriptTypes(presentation),
      stripTypeScriptTypes(host).replace(/^import \{ presentation \}.*$/m, ""),
      "export const openPill = () => nativePill(kernel);",
      "export const { dispatchNative, presentNative } = openPill();",
    ].join("\n"),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination) throw new Error("Expected a pill output path");
  await bendScratch(async (compiled) => {
    await buildBend(root, "record", compiled, undefined, "record/pill/");
    assemblePill(compiled, destination);
  });
}
