import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import type { recognize as Recognize } from "./provider.ts";

const [
  outputDirectory,
  dogPath,
  dogWidth,
  dogHeight,
  catPath,
  catWidth,
  catHeight,
] = process.argv.slice(2);
assert.ok(
  catHeight,
  "Expected OUTPUT_DIRECTORY DOG_RGBA DOG_WIDTH DOG_HEIGHT CAT_RGBA CAT_WIDTH CAT_HEIGHT",
);
globalThis.fetch = () => {
  throw new Error("Staged vision inference must not fetch");
};
const { recognize }: { recognize: typeof Recognize } = createRequire(
  join(resolve(outputDirectory), "index.mjs"),
)("./index.mjs");

type Predictions = Awaited<ReturnType<typeof Recognize>>;

function verifyDistribution(predictions: Predictions): void {
  assert.equal(predictions.length, 1000);
  const indices = new Set(predictions.map(({ index }) => index));
  assert.equal(indices.size, 1000);
  let previous = 1;
  let total = 0;
  for (const { index, label, score } of predictions) {
    assert.ok(Number.isInteger(index) && index >= 0 && index < 1000);
    assert.ok(label.length > 0);
    assert.ok(score >= 0 && score <= previous);
    previous = score;
    total += score;
  }
  assert.ok(Math.abs(total - 1) < 1e-12, `Probability sum was ${total}`);
}

function sumPredictions(
  predictions: Predictions,
  start: number,
  end: number,
): number {
  return predictions
    .filter(({ index }) => index >= start && index <= end)
    .reduce((sum, { score }) => sum + score, 0);
}

test("staged MobileNet recognizes real dog and cat photos and returns full class distributions", async (t) => {
  const dogBytes = await readFile(dogPath);
  const catBytes = await readFile(catPath);
  const start = performance.now();
  const dog = await recognize(dogBytes, Number(dogWidth), Number(dogHeight));
  const afterDog = performance.now();
  const cat = await recognize(catBytes, Number(catWidth), Number(catHeight));
  const afterCat = performance.now();
  verifyDistribution(dog);
  verifyDistribution(cat);
  const dogScore = sumPredictions(dog, 151, 268);
  const catScore = sumPredictions(cat, 281, 285);
  assert.ok(dogScore > 0.5, `Dog class mass was ${dogScore}`);
  assert.ok(catScore > 0.5, `Cat class mass was ${catScore}`);
  assert.ok(sumPredictions(cat, 151, 268) < 0.1);
  assert.ok(sumPredictions(dog, 281, 285) < 0.1);
  const [repeatDog, repeatCat] = await Promise.all([
    recognize(dogBytes, Number(dogWidth), Number(dogHeight)),
    recognize(catBytes, Number(catWidth), Number(catHeight)),
  ]);
  assert.deepEqual(repeatDog, dog);
  assert.deepEqual(repeatCat, cat);
  t.diagnostic(
    JSON.stringify({
      dog: {
        top: dog[0],
        score: dogScore,
        coldMs: Math.round(afterDog - start),
      },
      cat: {
        top: cat[0],
        score: catScore,
        warmMs: Math.round(afterCat - afterDog),
      },
    }),
  );
});

test("transparent pixels composite onto white, including a non-square RGBA view", async () => {
  const padded = Uint8Array.of(
    1,
    255,
    25,
    63,
    0,
    41,
    13,
    204,
    0,
    32,
    10,
    2,
    0,
    1,
  );
  const transparent = padded.subarray(1, -1);
  const opaqueWhite = new Uint8Array(12).fill(255);
  assert.deepEqual(
    await recognize(transparent, 3, 1),
    await recognize(opaqueWhite, 3, 1),
  );
});

test("rejects nonintegral, excessive and mismatched RGBA dimensions", async () => {
  const pixel = new Uint8Array(4);
  for (const [width, height] of [
    [1.5, 1],
    [1, 0],
    [8193, 1],
    [8192, 8192],
    [1, 2],
  ]) {
    await assert.rejects(recognize(pixel, width, height), RangeError);
  }
});
