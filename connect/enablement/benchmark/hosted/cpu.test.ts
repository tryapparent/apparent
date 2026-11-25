import assert from "node:assert/strict";
import test from "node:test";
import { waitForQuiet } from "./cpu.ts";

const window = (qualified: boolean) => ({
  qualified,
  externalCpuPercent: 1,
  peakHostWaitPercent: qualified ? 4 : 11,
});

test("retains the failed windows and stops at the first quiet window", async () => {
  const evidence = [];
  let attempts = 0;
  assert.equal(
    await waitForQuiet(
      async () => window(++attempts === 3),
      async (windows) => {
        evidence.push(windows.map(({ qualified }) => qualified));
      },
    ),
    true,
  );
  assert.deepEqual(evidence, [[false], [false, false], [false, false, true]]);
});

test("persistent contention closes admission after twelve windows", async () => {
  let windows = 0;
  assert.equal(
    await waitForQuiet(
      async () => window(false),
      async (evidence) => {
        windows = evidence.length;
      },
    ),
    false,
  );
  assert.equal(windows, 12);
});
