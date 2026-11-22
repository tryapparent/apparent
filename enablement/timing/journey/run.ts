import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bendScratch } from "../../../shared/enablement/bend/build.ts";
import { buildPerformancePolicy } from "../../ci/bend/build.ts";
import { audit, contract, contractHash, evaluate } from "./score.ts";
import type { Attempt, Receipt, Policy } from "./score.ts";
import { assemble } from "./assemble.ts";

const [mode, file, ...extra] = process.argv.slice(2);
const read = (file: string) => JSON.parse(readFileSync(resolve(file), "utf8"));
let result;
if (mode === "contract" && !file) {
  result = { ...contract, contractHash };
} else if (mode === "assemble" && file && extra.length) {
  const assembled = assemble(read(file), extra.map(read));
  console.error(JSON.stringify(assembled.coverage));
  result = assembled.receipt;
} else if (mode === "audit" && file && !extra.length) {
  result = audit(read(file));
} else if (mode === "evaluate" && file && !extra.length) {
  const ledger = read(file) as { reference: Receipt[]; attempts: Attempt[] };
  result = await bendScratch(async (directory) => {
    await buildPerformancePolicy(directory);
    const { default: policy } = (await import(
      pathToFileURL(resolve(directory, "journey-scoring.mjs")).href
    )) as { default: Policy };
    return evaluate(policy, ledger.reference, ledger.attempts);
  });
} else {
  throw new Error(
    "Usage: node enablement/timing/journey/run.ts contract | assemble IDENTITY.json FRAGMENT.json ... | audit RECEIPT.json | evaluate LEDGER.json",
  );
}
console.log(JSON.stringify(result, null, 2));
