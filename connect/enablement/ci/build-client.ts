import { execFileSync } from "node:child_process";
import { lstat, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildBend } from "../../../shared/enablement/bend/build.ts";

const client = new URL("../../client/typescript/", import.meta.url);
const output = new URL("dist", client);
const existing = await lstat(output).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== "ENOENT") throw error;
});
if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
  throw new Error("Refusing unsafe crypto build output");
}
await rm(output, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [fileURLToPath(new URL("node_modules/typescript/bin/tsc", client))],
  { cwd: client, stdio: "inherit" },
);
await buildBend(
  fileURLToPath(new URL("../../../", import.meta.url)),
  "connect",
  fileURLToPath(new URL("dist/reader", client)),
  undefined,
  "connect/client/typescript/src/reader/",
);
await buildBend(
  fileURLToPath(new URL("../../../", import.meta.url)),
  "connect",
  fileURLToPath(new URL("dist/account", client)),
  undefined,
  "connect/client/typescript/src/account/",
);
