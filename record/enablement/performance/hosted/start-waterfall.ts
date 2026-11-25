import assert from "node:assert/strict";
import { waterfall } from "./waterfall.ts";

type StartObservation = {
  order: string[];
  eligible: boolean;
  runs: {
    attempts: {
      mode: string;
      spans: { name: string; startUs: number; endUs: number }[];
    }[];
  }[];
};

export function startWaterfall(path: string, result: StartObservation) {
  const attempts = result.runs.flatMap((arm, index) =>
    arm.attempts.map(({ mode, spans }, attempt) => {
      const origin = Math.min(...spans.map((span) => span.startUs));
      return {
        label: `${result.order[index]} ${index + 1} · ${mode} · attempt ${attempt + 1}`,
        rows: spans.map(({ name, startUs, endUs }) => {
          assert.ok(
            Number.isFinite(startUs) &&
              Number.isFinite(endUs) &&
              startUs <= endUs,
          );
          return {
            name,
            fromMs: (startUs - origin) / 1000,
            toMs: (endUs - origin) / 1000,
          };
        }),
      };
    }),
  );
  waterfall(
    path,
    "Hosted Record Start",
    result.eligible
      ? "Local observer clock. See the hosted receipt for final qualification."
      : "Unscored diagnostic. The local batch failed a qualification guard.",
    attempts,
  );
}
