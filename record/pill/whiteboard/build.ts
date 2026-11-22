import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

export function assembleWhiteboard(compiled: string, destination: string) {
  const kernel = readFileSync(join(compiled, "whiteboard-edit.mjs"), "utf8");
  if (kernel.split("export default {").length !== 2)
    throw Error("Expected one Whiteboard policy export");
  writeFileSync(
    destination,
    kernel.replace("export default {", "const kernel = {") +
      `
export function whiteboardEdit(event, visible, active, point, strokes, points) {
  return JSON.stringify(kernel.edit({ $: "Board" + event }, visible, active, point, strokes, points));
}
`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination) throw Error("Expected Whiteboard policy output path");
  await bendScratch(async (compiled) => {
    await buildBend(
      root,
      "record",
      compiled,
      undefined,
      "record/pill/whiteboard/",
    );
    assembleWhiteboard(compiled, destination);
  });
}
