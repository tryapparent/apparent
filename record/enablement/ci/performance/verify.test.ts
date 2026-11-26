import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { recordChecks, verifyManifest } from "./verify.ts";

const path = "record/enablement/verification.json";
const manifest = new URL("../../verification.json", import.meta.url);

test("verification recipes resolve to repository files and have unique IDs", () => {
  const contents = readFileSync(manifest, "utf8");
  verifyManifest(contents);
  const { scenarios } = JSON.parse(contents);
  assert.throws(
    () =>
      verifyManifest(
        JSON.stringify({ scenarios: [scenarios[0], scenarios[0]] }),
      ),
    /duplicate scenario ID/,
  );
  const scenario = {
    ...scenarios[0],
    runner: { ...scenarios[0].runner, path: "missing/runner.ts" },
  };
  assert.throws(
    () => verifyManifest(JSON.stringify({ scenarios: [scenario] })),
    /runner\.path: missing repository file missing\/runner\.ts/,
  );
});

test("only a known portable-only change can omit the existing Bend proof", () => {
  assert.deepEqual(recordChecks([path]), { bend: false, performance: true });
  assert.deepEqual(
    recordChecks([path, "record/completion/src/copy-admission.bend"]),
    { bend: true, performance: true },
  );
  assert.deepEqual(
    recordChecks(["record/enablement/performance/fixtures/host-accounting.ts"]),
    { bend: true, performance: false },
  );
  assert.deepEqual(recordChecks([".github/workflows/stream-record.yml"]), {
    bend: true,
    performance: true,
  });
  assert.deepEqual(recordChecks(null), { bend: true, performance: true });
});
