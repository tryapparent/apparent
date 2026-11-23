import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../shared/enablement/bend/build.ts";

export const root = fileURLToPath(new URL("../../../../", import.meta.url));

export function assembleZoom(destination: string) {
  const worker = readFileSync(join(root, "agent/zoom/worker.ts"), "utf8");
  writeFileSync(
    join(destination, "zoom-worker.mjs"),
    stripTypeScriptTypes(worker),
  );
}

export function assembleHandoffLine(compiled: string, destination: string) {
  const kernel = readFileSync(join(compiled, "handoff-line.mjs"), "utf8");
  if (kernel.split("export default {").length !== 2)
    throw Error("Expected one Agent handoff policy export");
  writeFileSync(
    destination,
    `${kernel.replace("export default {", "const kernel = {")}
export function handoffLine(kind, clock, number, text, suffix) {
  return kernel.line({ $: kind }, clock, number, text, suffix);
}
export function windowSuffix(observations) {
  const windows = JSON.parse(observations).reduceRight((tail, observation) => ({
    $: "Con",
    head: observation ? { $: "Known", id: observation.id, app: observation.app, title: observation.title ?? "" } : { $: "Unknown" },
    tail,
  }), { $: "Nil" });
  return kernel.window_suffix(windows);
}
`,
  );
}

export async function buildHandoffLine(destination: string) {
  await bendScratch(async (compiled) => {
    await buildBend(root, "agent", compiled, undefined, "agent/context/");
    assembleHandoffLine(compiled, destination);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  await buildBend(root, "agent", destination, undefined, "agent/zoom/");
  assembleZoom(destination);
}
