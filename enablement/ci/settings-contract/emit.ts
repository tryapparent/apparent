import { resolve } from "node:path";
import { loadCatalog } from "./catalog.ts";
import { renderPreferenceIds } from "./types.ts";

const root = resolve(import.meta.dirname, "../../..");
const catalog = loadCatalog(root, true);
process.stdout.write(
  process.argv[2] === "--types"
    ? renderPreferenceIds(catalog)
    : JSON.stringify(catalog) + "\n",
);
