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

test("a cut-off neighboring line cannot name the selected image", async () => {
  const result = await recognizeCircle(
    {
      ...crop,
      width: 168,
      rgba: new Uint8Array(168 * 80 * 4),
      points: crop.points.map(([x, y]) => [x * 2.1, y]),
    },
    async () => [
      word("Similar", 65, 36),
      {
        ...word("artists", 144, 37),
        box: { x: 144, y: 37, width: 24, height: 8 },
      },
    ],
    async () => [{ index: 281, label: "tabby", score: 0.9 }],
  );
  assert.equal(result, "image “cat”");
});

test("ellipsized titles cannot become clean names on a second OCR pass", async () => {
  const passes: string[] = [];
  const result = await recognizeCircle(
    crop,
    async (_pixels, _width, _height, mode) => {
      passes.push(mode);
      return [word("Recommended", 30, 35), word("Artists…", 41, 35)];
    },
    async () => [],
  );
  assert.equal(result, "");
  assert.deepEqual(passes, ["auto"]);
});

test("an OCR line confined to the edge does not identify a central icon", async () => {
  const result = await recognizeCircle(
    crop,
    async () => [word("Search", 36, 9)],
    async () => [{ index: 0, label: "monitor", score: 0.99 }],
  );
  assert.equal(result, "");
});
