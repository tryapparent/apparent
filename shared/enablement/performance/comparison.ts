import { fileURLToPath } from "node:url";
import { bendScratch, buildBend } from "../bend/build.ts";
import { run } from "../bend/toolchain.ts";

export type Matched<T> = [T, T, T, T];
export type Limit = [observed: number, reference: number, allowance?: number];

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = "shared/enablement/performance/comparison.bend";
const units = (value: number) => Math.round(value * 1000);

export async function benchmarkComparison(
  waits: Matched<number>[],
  limits: Limit[],
  proof?: Parameters<typeof buildBend>[3],
) {
  const [scores, permitted] = await bendScratch(async (directory) => {
    await buildBend(root, "shared", directory, proof, source);
    const input = JSON.stringify([
      waits.map((wait) => wait.map(units)),
      limits.map(([observed, reference, allowance = 0]) =>
        [observed, reference, allowance].map(units),
      ),
    ]);
    const output = run(
      process.execPath,
      [
        "--input-type=module-typescript",
        "-e",
        `import policy from "./comparison.mjs";
        const [waits, limits] = JSON.parse(process.argv[1]);
        console.log(JSON.stringify([
          waits.map((wait: number[]) => policy.score(...wait)),
          limits.map((limit: number[]) => policy.within_limit(...limit)),
        ]));`,
        input,
      ],
      directory,
    );
    return JSON.parse(output) as [number[], boolean[]];
  });
  return {
    timings: waits.map(([a, b, bRepeat, aRepeat], i) => ({
      controlMs: [a, aRepeat],
      candidateMs: [b, bRepeat],
      controlMeanMs: (a + aRepeat) / 2,
      candidateMeanMs: (b + bRepeat) / 2,
      pairedDeltaMs: [b - a, bRepeat - aRepeat],
      score: scores[i] / 100,
    })),
    permitted,
  };
}
