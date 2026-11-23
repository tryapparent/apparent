import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bendScratch } from "../../../shared/enablement/bend/build.ts";
import { buildPerformancePolicy } from "../../ci/bend/build.ts";
import { assemble } from "./assemble.ts";
import { readMeasurements } from "./profile/measurements.ts";
import type { Attempt, Policy, Receipt } from "./score.ts";
import { audit, contract, contractHash, evaluate } from "./score.ts";

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
} else if (
  mode === "evaluate" &&
  file &&
  extra.length === 1 &&
  isAbsolute(extra[0])
) {
  const ledger = read(file) as { reference: Receipt[]; attempts: Attempt[] };
  const traceProcessor = extra[0];
  const reference = await Promise.all(
    ledger.reference.map((receipt) =>
      readMeasurements(receipt, traceProcessor),
    ),
  );
  const attempts = await Promise.all(
    ledger.attempts.map(async (attempt) =>
      attempt.runs
        ? {
            ...attempt,
            runs: await Promise.all(
              attempt.runs.map((receipt) =>
                readMeasurements(receipt, traceProcessor),
              ),
            ),
          }
        : attempt,
    ),
  );
  result = await bendScratch(async (directory) => {
    await buildPerformancePolicy(directory);
    const { default: policy } = (await import(
      pathToFileURL(resolve(directory, "journey-scoring.mjs")).href
    )) as { default: Policy };
    return evaluate(policy, reference, attempts);
  });
} else {
  throw new Error(
    "Usage: node enablement/timing/journey/run.ts contract | assemble IDENTITY.json FRAGMENT.json ... | audit RECEIPT.json | evaluate LEDGER.json /absolute/path/trace_processor",
  );
}
console.log(JSON.stringify(result, null, 2));
