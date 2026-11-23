import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const modelRoot =
  "https://huggingface.co/onnxmodelzoo/mobilenetv2-12/resolve/23a2a25eaaa6fcd61865414c8a1acf13dda66b7a";
const labelsRoot =
  "https://raw.githubusercontent.com/onnx/models/c5cae0f1942c8d7727372c7b1f6b485aa39e4421/validated/vision/classification";
const mirrorRoot =
  "https://github.com/tryapparent/apparent/releases/download/circle-vision-mobilenetv2-23a2a25";
const ortSource = "https://cdn.jsdelivr.net/gh/microsoft/onnxruntime@v1.23.2";

const assets = {
  "model.onnx": [
    `${modelRoot}/mobilenetv2-12.onnx`,
    "c0c3f76d93fa3fd6580652a45618618a220fced18babf65774ed169de0432ad5",
    `${mirrorRoot}/model.onnx`,
  ],
  "synset.txt": [
    `${labelsRoot}/synset.txt`,
    "acf75ef0abe89694b19056e0796401068b459c457baa30335f240c7692857355",
    `${mirrorRoot}/synset.txt`,
  ],
  "ort.tgz": [
    "https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.23.2.tgz",
    "0b8707d7efab9a2bea63564d66cad79e897cfd0bd627e5ae000488ffc1c45c7d",
  ],
  "licenses/ONNX-Runtime-MIT.txt": [
    `${ortSource}/LICENSE`,
    "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c",
  ],
  "licenses/ONNX-Runtime-ThirdPartyNotices.txt": [
    `${ortSource}/ThirdPartyNotices.txt`,
    "e9e90971a8e75a9a8ac0c6412e29c1202d079998389915aa485f46c816c3b4cc",
  ],
  "licenses/MobileNet-Apache-2.0.txt": [
    "https://www.apache.org/licenses/LICENSE-2.0.txt",
    "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    `${mirrorRoot}/LICENSE.txt`,
  ],
  "licenses/UPSTREAM-MODEL-CARD.md": [
    modelRoot.replace("/resolve/", "/raw/") + "/README.md",
    "277c340469e214be95a4fcb9cc7cb7810527c805ee00be60f2c0491232308ff1",
    `${mirrorRoot}/UPSTREAM-MODEL-CARD.md`,
  ],
} as const;

const runtimeFiles = [
  "ort.wasm.min.mjs",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

async function download(
  path: string,
  url: string,
  sha256: string,
  mirror?: string,
): Promise<void> {
  let source = mirror ?? url;
  let bytes: Buffer;
  try {
    bytes = await fetchBytes(source, mirror ? 15_000 : 120_000);
  } catch (error) {
    if (!mirror || !(error instanceof RetryableDownloadError)) throw error;
    source = url;
    bytes = await fetchBytes(source, 120_000);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new Error(`SHA-256 mismatch for ${source}`);
  }
  await writeFile(path, bytes);
}

class RetryableDownloadError extends Error {}

async function fetchBytes(url: string, timeout: number): Promise<Buffer> {
  const signal = AbortSignal.timeout(timeout);
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (cause) {
    throw new RetryableDownloadError(`Download failed for ${url}`, { cause });
  }
  if (
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  )
    throw new RetryableDownloadError(
      `Download failed for ${url} (${response.status})`,
    );
  if (!response.ok)
    throw new Error(`Download failed for ${url} (${response.status})`);
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (cause) {
    throw new RetryableDownloadError(`Download interrupted for ${url}`, {
      cause,
    });
  }
}

async function stage(scratch: string): Promise<string> {
  const result = join(scratch, "provider");
  await mkdir(join(result, "licenses"), { recursive: true });
  const results = await Promise.allSettled(
    Object.entries(assets).map(([file, [url, sha256, mirror]]) =>
      download(
        join(
          file.endsWith(".tgz") || file === "synset.txt" ? scratch : result,
          file,
        ),
        url,
        sha256,
        mirror,
      ),
    ),
  );
  for (const download of results) {
    if (download.status === "rejected") throw download.reason;
  }

  execFileSync("tar", [
    "-xzf",
    join(scratch, "ort.tgz"),
    "--strip-components=2",
    "-C",
    result,
    ...runtimeFiles.map((name) => `package/dist/${name}`),
  ]);
  const labels = (await readFile(join(scratch, "synset.txt"), "utf8"))
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => /^n\d{8} (.+)$/.exec(line)?.[1]);
  if (labels.length !== 1000 || labels.some((label) => !label)) {
    throw new Error("Incomplete ImageNet class table");
  }
  await writeFile(join(result, "labels.json"), JSON.stringify(labels));
  const source = await readFile(
    new URL("./provider.ts", import.meta.url),
    "utf8",
  );
  await writeFile(join(result, "index.mjs"), stripTypeScriptTypes(source));
  return result;
}

const [argument, ...extra] = process.argv.slice(2);
if (!argument || extra.length > 0)
  throw new Error("Usage: build.ts OUTPUT_DIRECTORY");

const output = resolve(argument);
const scratch = await mkdtemp(join(tmpdir(), "apparent-dev-circle-vision-"));
try {
  const files = await stage(scratch);
  await mkdir(output);
  try {
    for (const file of await readdir(files)) {
      await cp(join(files, file), join(output, file), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    }
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
