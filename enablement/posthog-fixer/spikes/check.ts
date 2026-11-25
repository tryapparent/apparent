import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  bendScratch,
  proofOptions,
} from "../../../shared/enablement/bend/build.ts";
import { buildSpikePolicy } from "./build.ts";
import type { SpikePolicy } from "./policy.ts";

export async function verifySpikePolicy(
  proof: ReturnType<typeof proofOptions>,
) {
  await bendScratch(async (directory) => {
    await buildSpikePolicy(directory, proof);
    const { default: policy } = (await import(
      pathToFileURL(join(directory, "spike-policy.mjs")).href
    )) as { default: SpikePolicy };

    assert.equal(policy.qualifies(5, 5, 0), true);
    assert.equal(policy.qualifies(4, 100, 0), false);
    assert.equal(policy.qualifies(5, 5, 280), true);
    assert.equal(policy.qualifies(5, 5, 281), false);
    assert.equal(policy.admits(false, 86400), true);
    assert.equal(policy.admits(false, 86399), false);
    assert.equal(policy.admits(true, 86400), false);
  });
}

if (import.meta.main)
  await verifySpikePolicy(proofOptions(process.argv.slice(2)));
