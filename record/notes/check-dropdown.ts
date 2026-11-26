import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function checkDropdown(output: string) {
  const { default: policy } = await import(
    pathToFileURL(join(output, "dropdown-layout.mjs")).href
  );
  const bounds = (...args: number[]) => {
    const { x, y, width, height } = policy.place(...args);
    return [x, y, width, height];
  };
  assert.deepEqual(bounds(640, 36, 76, 1280, 800, 115), [474, 80, 332, 115]);
  assert.deepEqual(bounds(10, 36, 76, 320, 480, 900), [0, 80, 320, 350]);
  assert.deepEqual(bounds(1270, 700, 756, 1280, 800, 115), [948, 581, 332, 115]);
  assert.deepEqual(bounds(160, 80, 120, 320, 220, 350), [0, 124, 320, 96]);
}
