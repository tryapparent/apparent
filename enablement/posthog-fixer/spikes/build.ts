import { fileURLToPath } from "node:url";
import {
  buildBend,
  proofOptions,
} from "../../../shared/enablement/bend/build.ts";

export function buildSpikePolicy(
  destination: string,
  proof?: ReturnType<typeof proofOptions>,
) {
  return buildBend(
    fileURLToPath(new URL("../../../", import.meta.url)),
    "enablement",
    destination,
    proof,
    "enablement/posthog-fixer/spikes/",
  );
}

if (import.meta.main) {
  const [destination] = process.argv.slice(2);
  if (!destination) throw Error("Specify the spike policy output directory");
  await buildSpikePolicy(destination);
}
