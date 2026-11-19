import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBend } from "../../../../shared/enablement/bend/build.ts";

export const root = fileURLToPath(new URL("../../../../", import.meta.url));
export const host = join(root, "onboarding", "host", "traversal");
export const destination = join(
  root,
  "onboarding",
  "dist",
  "host",
  "traversal",
);

export async function buildTraversal(
  output: string,
  proof?: Parameters<typeof buildBend>[3],
) {
  await buildBend(root, "onboarding", output, proof);
  copyFileSync(
    join(host, "tour-traversal.d.mts"),
    join(output, "tour-traversal.d.mts"),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildTraversal(destination);
