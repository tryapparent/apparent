import { fstatSync, readFileSync } from "node:fs";
import { recognizeCircle } from "./recognition.ts";

try {
  const stat = fstatSync(0);
  if (
    process.argv.length !== 2 ||
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size < 5 ||
    stat.size > 8 * 1024 * 1024
  )
    throw Error();
  const bytes = readFileSync(0);
  const start = bytes.readUInt32LE(0) + 4;
  if (start > 128 * 1024 || start >= bytes.length) throw Error();
  const { width, height, points } = JSON.parse(
    bytes.toString("utf8", 4, start),
  );
  if (
    ![width, height].every((n) => Number.isInteger(n) && n >= 8 && n <= 2048) ||
    bytes.length !== start + 4 * width * height ||
    !Array.isArray(points) ||
    points.length < 3 ||
    points.length > 2400 ||
    !points.every(
      (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
    )
  )
    throw Error();
  const ocr = import("./ocr/index.mjs");
  const vision = import("./vision/index.mjs");
  const result = await recognizeCircle(
    { rgba: bytes.subarray(start), width, height, points },
    async (...args) => (await ocr).recognize(...args),
    async (...args) => (await vision).recognize(...args),
  );
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
} catch {
  process.exitCode = 1;
}
