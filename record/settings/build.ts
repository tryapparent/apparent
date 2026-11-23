import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bendScratch, buildBend } from "../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
await bendScratch(async (scratch) => {
  await buildBend(root, "record", scratch);
  const module = "recording-policy.mjs";
  copyFileSync(join(scratch, module), join(root, "record/settings", module));
});
