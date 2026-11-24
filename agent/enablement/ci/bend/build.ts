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
function list(items) {
  return items.reduceRight((tail, head) => ({ $: "Con", head, tail }), { $: "Nil" });
}
function observed(observation) {
  return observation ? { $: "Known", id: observation.id, app: observation.app, title: observation.title ?? "" } : { $: "Unknown" };
}
function compactCircle(text) {
  if (!/^“[^“”\\r\\n]+”(, “[^“”\\r\\n]+”){1,2}$/.test(text)) return text;
  const labels = [];
  for (let group = kernel.group_labels(list(text.match(/“[^“”]+”/g))); group.$ === "Con"; group = group.tail) {
    const { label, count } = group.head;
    labels.push(count > 1 ? label + " ×" + count : label);
  }
  return labels.join(", ");
}
export function handoffLine(kind, clock, number, text, suffix, compact = false) {
  const render = compact ? kernel.compact_line : kernel.line;
  return render({ $: kind }, clock, number, compact && kind === "Circle" ? compactCircle(text) : text, suffix);
}
export function windowSuffix(observations) {
  return kernel.window_suffix(list(JSON.parse(observations).map(observed)));
}
export function windowAgrees(observations) {
  return kernel.windows_agree(list(JSON.parse(observations).map(observed))) ? "yes" : "";
}
export function windowHeading(observations) {
  const [previous, current] = JSON.parse(observations);
  const window = observed(current);
  return kernel.window_heading(kernel.same_window(observed(previous), window), window, current.app.toLowerCase());
}
export function keepFrameHead(compact, scene, empty) {
  return kernel.keep_frame_head(compact, scene, empty) ? "yes" : "";
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
