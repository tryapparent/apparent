import { resolve } from "node:path";
import { loadCatalog } from "./catalog.ts";

const root = resolve(import.meta.dirname, "../../..");
process.stdout.write(JSON.stringify(loadCatalog(root, true)) + "\n");
