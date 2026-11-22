import { fileURLToPath } from "node:url";
import {
  buildBend,
  proofOptions,
} from "../../../shared/enablement/bend/build.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

export function buildPerformancePolicy(
  destination: string,
  proof?: ReturnType<typeof proofOptions>,
) {
  return buildBend(root, "enablement", destination, proof);
}
