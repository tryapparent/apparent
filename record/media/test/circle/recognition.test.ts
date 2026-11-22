import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import type {
  Crop,
  Word,
  recognizeCircle as Recognizer,
} from "../../src/circle/recognition.ts";

const { recognizeCircle }: { recognizeCircle: typeof Recognizer } =
  createRequire(import.meta.url)("../../dist/circle/recognition.js");

const rgba = new Uint8Array(80 * 80 * 4).fill(255);
const crop: Crop = {
  rgba,
  width: 80,
  height: 80,
  points: [
    [40, 0],
    [80, 40],
    [40, 80],
    [0, 40],
  ],
};
const word = (text: string, x: number, y: number, confidence = 0.98): Word => ({
  text,
  box: { x, y, width: 8, height: 8 },
  confidence,
  line: 0,
});

test("reads only selected words and pools breed probabilities into a category", async () => {
  const result = await recognizeCircle(
    crop,
    async () => [word("Luna", 36, 36), word("Archive", 0, 0)],
    async (pixels) => {
      assert.deepEqual([...pixels.slice(0, 4)], [128, 128, 128, 255]);
      assert.deepEqual(
        [...pixels.slice(4 * (40 * 80 + 40), 4 * (40 * 80 + 41))],
        [255, 255, 255, 255],
      );
      return [
        { index: 207, label: "golden retriever", score: 0.46 },
        { index: 208, label: "Labrador retriever", score: 0.43 },
      ];
    },
  );
  assert.equal(result, "image “dog”, “Luna”");
});

test("incomplete text and uncertain objects leave the mark for frame inspection", async () => {
  assert.equal(
    await recognizeCircle(
      crop,
      async () => [word("Export", 28, 36), word("PDF", 42, 36, 0.4)],
      async () => [{ index: 409, label: "analog clock", score: 0.5 }],
    ),
    "",
  );
});

test("either local provider can succeed independently", async () => {
  const unavailable = async () => {
    throw Error("unavailable");
  };
  assert.equal(
    await recognizeCircle(
      crop,
      async () => [word("Retry", 36, 36)],
      unavailable,
    ),
    "“Retry”",
  );
  assert.equal(
    await recognizeCircle(crop, unavailable, async () => [
      { index: 281, label: "tabby", score: 0.9 },
    ]),
    "image “cat”",
  );
  assert.equal(await recognizeCircle(crop, unavailable, unavailable), "");
});
