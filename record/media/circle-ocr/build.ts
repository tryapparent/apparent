import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

type Pin = { url: string; sha256: string; size: number };

async function download(name: string, pin: Pin): Promise<Buffer> {
  const response = await fetch(pin.url, {
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download OCR asset ${name} (HTTP ${response.status})`,
    );
  }
  const bytes = Buffer.alloc(pin.size);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength) {
        await reader.cancel();
        throw new Error(`OCR asset ${name} exceeds its pinned size`);
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (
    offset !== pin.size ||
    createHash("sha256").update(bytes).digest("hex") !== pin.sha256
  ) {
    throw new Error(`OCR asset ${name} does not match its pin`);
  }
  return bytes;
}

const [destination, ...extra] = process.argv.slice(2);
if (!destination || extra.length) {
  throw new Error(
    "Usage: node --experimental-strip-types record/media/circle-ocr/build.ts OUTPUT_DIRECTORY",
  );
}
const out = resolve(destination);
try {
  await lstat(out);
  throw new Error(`OCR output directory already exists: ${out}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const [manifest, source, notices, runtimeNotices] = await Promise.all([
  readFile(new URL("./assets.json", import.meta.url), "utf8"),
  readFile(new URL("./index.ts", import.meta.url), "utf8"),
  readFile(new URL("./THIRD_PARTY_NOTICES.txt", import.meta.url)),
  readFile(new URL("./WASM_RUNTIME_NOTICES.txt", import.meta.url)),
]);
const pins = JSON.parse(manifest) as Record<string, Pin>;
const [core, wasm, weights] = await Promise.all(
  ["tesseract.cjs", "tesseract.wasm", "eng.traineddata"].map((name) =>
    download(name, pins[name]),
  ),
);
const files = {
  "index.mjs": stripTypeScriptTypes(source),
  "tesseract.cjs": core,
  "tesseract.wasm": wasm,
  "eng.traineddata.gz": gzipSync(weights),
  "assets.json": manifest,
  "THIRD_PARTY_NOTICES.txt": Buffer.concat([notices, runtimeNotices]),
};
await mkdir(dirname(out), { recursive: true });
await mkdir(out);
try {
  for (const [name, data] of Object.entries(files)) {
    await writeFile(join(out, name), data, { flag: "wx" });
  }
} catch (error) {
  await rm(out, { recursive: true, force: true });
  throw error;
}
