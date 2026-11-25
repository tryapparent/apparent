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
  const layout = { $: kind };
  return compact
    ? kernel.compact_line(layout, clock, number, kind === "Circle" ? compactCircle(text) : text)
    : kernel.line(layout, clock, number, text, suffix);
}
export function windowSuffix(observations) {
  return kernel.window_suffix(list(JSON.parse(observations).map(observed)));
}
export function windowAgrees(observations) {
  return kernel.windows_agree(list(JSON.parse(observations).map(observed))) ? "yes" : "";
}
export function nearbyWindow(observations, keepTitle = false) {
  const [previous, current] = JSON.parse(observations);
  const window = observed(current);
  const browser = kernel.browser_suffix(current.app.toLowerCase());
  const title = kernel.shorten_title(window.title, browser).trim();
  const site = title.split(/\\s[|•/–—-]\\s/u).at(-1).trim();
  return kernel.nearby_window(kernel.same_window(observed(previous), window), { ...window, title }, site, browser, keepTitle);
}
export function keepFrameHead(compact, scene, empty) {
  return kernel.keep_frame_head(compact, scene, empty) ? "yes" : "";
}
export function agreedPage(pages) {
  return kernel.agreed_page(list(JSON.parse(pages)));
}
export function pageScope(pathEmpty, nearby) {
  return kernel.page_scope(pathEmpty, nearby);
}
export function samePage(url, scope, otherUrl, otherScope) {
  return kernel.same_page(url, scope, otherUrl, otherScope) ? "yes" : "";
}
export function joinPageClicks(text, other) {
  return kernel.join_page_clicks(text, other) ? "yes" : "";
}
export function pageHeading(url, scope) {
  return kernel.page_heading(url, scope);
}
export function pageLine(clock, text, heading) {
  return heading === "" ? kernel.page_line(clock, text) : kernel.single_page_line(clock, text, heading);
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
