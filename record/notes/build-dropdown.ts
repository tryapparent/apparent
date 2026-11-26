import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function buildDropdown(destination: string) {
  await bendScratch(async (scratch) => {
    await buildBend(root, "record", scratch, undefined, "record/notes/dropdown-layout.bend");
    const kernel = readFileSync(join(scratch, "dropdown-layout.mjs"), "utf8");
    const placement = readFileSync(new URL("./placement.ts", import.meta.url), "utf8");
    writeFileSync(join(destination, "dropdown-layout.mjs"), [
      kernel,
      stripTypeScriptTypes(placement),
    ].join("\n"));
  });
}
