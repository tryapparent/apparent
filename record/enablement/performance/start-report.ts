import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { verifiedStart } from "./start.ts";
const [root, ...extra] = process.argv.slice(2);
if (!root || extra.length)
  throw Error("Usage: start-report.ts RETAINED_VM_DIRECTORY");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const result = JSON.parse(read("result.json"));
if (
  result.stage !== "finished" ||
  result.driver !== "passed" ||
  result.artifact_retention !== "verified" ||
  result.scenario_exit !== 0
) {
  throw Error("Requires a successfully retained native Start run");
}
const rows = read("weighted-start-observations.jsonl")
  .trim()
  .split("\n")
  .map((row) => JSON.parse(row));
const names = ["shortcut-first", "shortcut-repeat"];
if (rows.length !== names.length)
  throw Error("Expected exactly two native observations");
const artifact = (name: string, suffix: string) =>
  JSON.parse(read("artifacts/artifacts/" + name + "-" + suffix + ".json"));
let ms = 0;
const owned = new Set<string>();
for (const name of names) {
  const row = rows.find((row) => row.name === name);
  if (!row || !verifiedStart(row))
    throw Error("Unqualified native Start observation");
  const state = artifact(name, "state").state;
  const saved = artifact(name, "stop");
  const bundle = basename(saved.bundle_path);
  const output = JSON.parse(
    read("artifacts/captures/" + bundle + "/apparent.json"),
  );
  if (
    state.phase !== "recording" ||
    saved.status !== "saved" ||
    !/^[a-f0-9]{32}$/.test(state.capture_id) ||
    state.capture_id !== saved.capture_id ||
    owned.has(state.capture_id) ||
    !bundle.endsWith(".apparent") ||
    output.video !== "recording.mp4" ||
    !Array.isArray(output.keyframes) ||
    !output.keyframes.length ||
    statSync(resolve(root, "artifacts/captures", bundle, output.video)).size <=
      0
  ) {
    throw Error("Native Start was not followed by a usable owned capture");
  }
  owned.add(state.capture_id);
  ms += row.ms / names.length;
}
console.log(
  JSON.stringify(
    {
      version: read("artifacts/artifacts/version.txt").trim(),
      waits: { pill: { ms, verified: true } },
    },
    null,
    2,
  ),
);
