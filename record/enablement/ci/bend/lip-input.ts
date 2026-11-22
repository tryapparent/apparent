import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bendScratch, buildBend } from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
await bendScratch(async scratch => {
  await buildBend(root, "record", scratch, undefined, "record/settings/");
  const { default: policy } = await import(pathToFileURL(join(scratch, "lip-policy.mjs")).href);
  const inputs = [false, true].flatMap(lips => [false, true].map(mic => policy.use_microphone(lips, mic)));
  console.log(`const USE_MICROPHONE: [bool; 4] = [${inputs.join(", ")}];`);
});
