import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import type { recognize as Recognize, Word } from "./index.ts";

async function fixture(name: string): Promise<Uint8Array> {
  const file = await readFile(
    new URL(`./fixtures/${name}.png`, import.meta.url),
  );
  return PNG.sync.read(file).data;
}

function checkWords(words: Word[], width: number, height: number) {
  for (const { box, confidence } of words) {
    assert(Number.isFinite(confidence) && confidence >= 0 && confidence <= 1);
    assert([box.x, box.y, box.width, box.height].every(Number.isInteger));
    assert(box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0);
    assert(box.x + box.width <= width && box.y + box.height <= height);
  }
}

const [stage, ...extra] = process.argv.slice(2);
assert(
  stage && !extra.length,
  "Usage: node --experimental-strip-types provider.test.ts STAGED_DIRECTORY",
);
const scratch = await mkdtemp(join(tmpdir(), "apparent-dev-circle-ocr-test-"));
const relocated = join(scratch, "Relocated OCR Assets");
try {
  globalThis.fetch = () => {
    throw new Error("Networking is disabled during OCR conformance");
  };
  await cp(resolve(stage), relocated, { recursive: true });
  const { recognize }: { recognize: typeof Recognize } = createRequire(
    join(relocated, "index.mjs"),
  )("./index.mjs");
  const [multiline, button] = await Promise.all([
    fixture("dark-recording"),
    fixture("post"),
  ]);

  await assert.rejects(recognize(multiline.subarray(1), 510, 130), RangeError);
  await assert.rejects(recognize(new Uint8Array(), 16_384, 16_384), RangeError);
  const padded = new Uint8Array(multiline.length + 6);
  padded.set(multiline, 3);

  const [auto, line] = await Promise.all([
    recognize(padded.subarray(3, -3), 510, 130),
    recognize(button, 92, 32, "line"),
  ]);
  assert.deepEqual(
    auto.map(({ text, line }) => [text, line]),
    [
      ["Recording", 0],
      ["saved", 0],
      ["Open", 1],
      ["the", 1],
      ["latest", 1],
      ["capture", 1],
      ["Copy", 2],
      ["link", 2],
    ],
  );
  assert.deepEqual(
    line.map(({ text, line }) => [text, line]),
    [["Post", 0]],
  );
  checkWords(auto, 510, 130);
  checkWords(line, 92, 32);
  assert(
    auto[1].box.x > auto[0].box.x &&
      auto[2].box.y > auto[0].box.y &&
      auto[6].box.y > auto[2].box.y,
  );
  assert(line[0].box.x >= 28 && line[0].box.x + line[0].box.width <= 64);

  await rm(join(relocated, "eng.traineddata.gz"));
  assert.deepEqual(
    await recognize(new Uint8Array(96 * 40 * 4).fill(255), 96, 40),
    [],
  );
  assert.deepEqual(await recognize(multiline, 510, 130), auto);
  console.log(
    JSON.stringify({
      node: process.versions.node,
      electron: process.versions.electron,
      auto,
      line,
    }),
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
