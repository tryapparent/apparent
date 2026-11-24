import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { savedWisprExperiment } from "../host/wispr-native.ts";

test("the canonical Wispr setting takes precedence over the legacy experiment", async () => {
  const home = await mkdtemp(join(tmpdir(), "wispr-"));
  const directory = join(home, ".config", "apparent");
  const file = join(directory, "config.json");
  try {
    await mkdir(directory, { recursive: true });
    for (const value of [false, null, "true"]) {
      await writeFile(
        file,
        JSON.stringify({
          labs: { onboardingWisprFlow: value },
          experiments: { onboardingWisprFlow: true },
        }),
      );
      assert.equal(await savedWisprExperiment(home), false);
    }
    await writeFile(
      file,
      JSON.stringify({
        labs: { onboardingWisprFlow: true },
        experiments: { onboardingWisprFlow: false },
      }),
    );
    assert.equal(await savedWisprExperiment(home), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
