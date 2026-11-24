import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bendScratch, buildBend } from "../../bend/build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

export async function buildSparkleOutcomes(
  destination: string,
  proof?: Parameters<typeof buildBend>[3],
): Promise<void> {
  await bendScratch(async (scratch) => {
    await buildBend(
      root,
      "shared",
      scratch,
      proof,
      "shared/analytics/sparkle-outcomes.bend",
    );
    const kernel = readFileSync(join(scratch, "sparkle-outcomes.mjs"), "utf8");
    const declaration = "export default {";
    if (kernel.split(declaration).length !== 2)
      throw new Error("Expected one default export from Bend");
    writeFileSync(
      destination,
      kernel.replace(declaration, "const outcomes = {") +
        "\nexport const { sparkle_outcome } = outcomes;\n",
    );
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination) throw new Error("Expected a Sparkle outcomes output path");
  await buildSparkleOutcomes(destination);
}
