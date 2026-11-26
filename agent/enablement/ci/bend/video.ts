import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBend } from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
export function assembleVideo(destination: string) {
  for (const name of ["plan", "media", "inspect", "voice", "video"]) {
    const source = readFileSync(
      join(root, "agent/video", name + ".ts"),
      "utf8",
    );
    writeFileSync(
      join(destination, name + ".mjs"),
      stripTypeScriptTypes(source)
        .replaceAll('from "./plan.ts"', 'from "./plan.mjs"')
        .replaceAll('from "./media.ts"', 'from "./media.mjs"')
        .replaceAll('from "./inspect.ts"', 'from "./inspect.mjs"')
        .replaceAll('from "./voice.ts"', 'from "./voice.mjs"'),
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  await buildBend(root, "agent", destination, undefined, "agent/video/");
  assembleVideo(destination);
}
