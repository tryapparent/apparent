import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  bendScratch,
  buildBend,
  proofOptions,
} from "../../../shared/enablement/bend/build.ts";
import { validateSample, type Preference } from "./catalog.ts";

export const samplePath = "shared/settings/roundtrip.json";
type Verdict = (sample: boolean, visible: boolean, bound: boolean) => number;
const runtimeOnly = new Set(["recording.microphoneEnabled"]);
const errors = [
  "",
  "missing a Settings control binding",
  "has a Settings control and should leave the runtime-only list",
  "missing a valid round-trip sample",
];

export function coverageFailures(
  preferences: readonly Preference[],
  bindings: ReadonlySet<string>,
  samples: Record<string, unknown>,
  coverage: Verdict,
): string[] {
  const ids = new Set(preferences.map(({ id }) => id));
  const failures = Object.keys(samples)
    .filter((id) => !ids.has(id))
    .map((id) => `${id}: round-trip sample has no catalog entry`);
  for (const preference of preferences) {
    const { id } = preference;
    const verdict = coverage(
      Object.hasOwn(samples, id) && validateSample(preference, samples[id]),
      !runtimeOnly.has(id),
      bindings.has(id),
    );
    if (verdict !== 0)
      failures.push(`${id}: ${errors[verdict] ?? "invalid coverage verdict"}`);
  }
  return failures;
}

export async function verifyCoverage(
  root: string,
  preferences: readonly Preference[],
  bindings: ReadonlySet<string>,
  proof: boolean,
): Promise<string[]> {
  const samples: unknown = JSON.parse(
    readFileSync(join(root, samplePath), "utf8"),
  );
  if (!samples || typeof samples !== "object" || Array.isArray(samples))
    throw Error("Settings round-trip samples must be keyed by preference ID");
  return bendScratch(async (directory) => {
    await buildBend(
      root,
      "enablement",
      directory,
      proof ? proofOptions(["--proof"]) : undefined,
      "enablement/ci/settings-contract/",
    );
    const { default: policy } = await import(
      pathToFileURL(join(directory, "coverage.mjs")).href
    );
    return coverageFailures(
      preferences,
      bindings,
      samples as Record<string, unknown>,
      policy.coverage,
    );
  });
}
