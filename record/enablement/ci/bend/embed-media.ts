import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = process.argv[2];
if (!output) throw Error("Expected a Record media policy output path");

const read = (file: string) =>
  readFileSync(join(root, "record/media/src", file), "utf8");

function removeOne(source: string, declaration: RegExp): string {
  if (source.match(declaration)?.length !== 1)
    throw Error("Expected " + declaration);
  return source.replace(declaration, "");
}

function moduleBody(source: string): string {
  return stripTypeScriptTypes(source).replace(/^export\s+/gm, "");
}

function scopedPolicy(
  endpoint: string,
  policy: string,
  request: string,
  declaration: RegExp,
  policyExport: string,
  requestExport: string,
): string {
  const policyBody = moduleBody(read(policy));
  const requestBody = moduleBody(removeOne(read(request), declaration));
  return [
    `export const ${endpoint} = (() => {`,
    `const ${policyExport} = (() => {\n${policyBody}\nreturn ${policyExport};\n})();`,
    requestBody,
    `return ${requestExport};`,
    "})();",
  ].join("\n");
}

await bendScratch(async (compiled) => {
  await buildBend(
    root,
    "record",
    compiled,
    undefined,
    "record/media/src/assembly/frame-limits.bend",
  );
  const frameLimits = readFileSync(join(compiled, "frame-limits.mjs"), "utf8");
  const exportMarker = "export default {";
  if (frameLimits.split(exportMarker).length !== 2)
    throw Error("Expected Record frame limits export");
  const assembly = moduleBody(
    removeOne(
      read("assembly-policy.ts"),
      /^import\s+limits\s+from\s+["']\.\/assembly\/frame-limits\.mjs["'];$/gm,
    ),
  );
  const sources = [
    frameLimits.replace(exportMarker, "const limits = {"),
    assembly,
    "export const nativeAssembly = duration => JSON.stringify(assemblyPlan(BigInt(duration)));",
    scopedPolicy(
      "nativeSpeechCues",
      "selection/cues.ts",
      "selection/cues-request.ts",
      /^import\s+\{\s*speechCues\s*\}\s+from\s+["']\.\/cues\.ts["'];$/gm,
      "speechCues",
      "speechCueRequest",
    ),
    scopedPolicy(
      "nativeScenes",
      "selection/scene.ts",
      "selection/scene-request.ts",
      /^import\s+\{\s*sceneTransitions,\s*type\s+DrawingSpan\s*\}\s+from\s+["']\.\/scene\.ts["'];$/gm,
      "sceneTransitions",
      "sceneRequest",
    ),
    scopedPolicy(
      "nativeTranscript",
      "transcript/policy.ts",
      "transcript/request.ts",
      /^import\s+\{\s*alignTranscript,\s*type\s+TimedText\s*\}\s+from\s+["']\.\/policy\.ts["'];$/gm,
      "alignTranscript",
      "transcriptRequest",
    ),
    `export const nativeMovieClock = (() => {
${moduleBody(read("frames-policy.ts"))}
return request => JSON.stringify(movieTimes(...JSON.parse(request)));
})();`,
  ];
  writeFileSync(output, sources.join("\n"));
});
