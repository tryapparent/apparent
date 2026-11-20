import { fileURLToPath } from "node:url";
import { buildBend } from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const settings = fileURLToPath(
  new URL("../../../settings/about/", import.meta.url),
);

if (process.argv[1] === fileURLToPath(import.meta.url))
  await buildBend(root, "composition", settings);
