import { fileURLToPath } from "node:url";
import { buildBend } from "../../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
await buildBend(
  root,
  "connect",
  fileURLToPath(
    new URL("../../../client/typescript/src/account", import.meta.url),
  ),
  undefined,
  "connect/client/typescript/src/account/",
);
