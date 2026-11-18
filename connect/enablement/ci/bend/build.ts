import { fileURLToPath } from "node:url";
import { buildBend } from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
await buildBend(
  root,
  "connect",
  fileURLToPath(new URL("../../../service/dist/bend", import.meta.url)),
);
