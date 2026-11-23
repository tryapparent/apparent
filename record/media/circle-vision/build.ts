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
  "https://huggingface.co/onnx-community/mobilenetv3_small_100.lamb_in1k/resolve/b1a19675d33130739e56503b5bfd6534a0f9e01d";
const ortSource = "https://cdn.jsdelivr.net/gh/microsoft/onnxruntime@v1.23.2";

const assets = {
  "model.onnx": [
    `${modelRoot}/onnx/model.onnx`,
    "d36eea8c3298d339c232581dff18beed6651eacd607d0a531b7bdb100f8dc713",
  ],
  "config.json": [
    `${modelRoot}/config.json`,
    "697bd60337931e54bd8d58b6ef8b587de6d97c59241940810d4759e25e9885bc",
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
): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok)
    throw new Error(`Download failed for ${url} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new Error(`SHA-256 mismatch for ${url}`);
  }
  await writeFile(path, bytes);
}

async function stage(scratch: string): Promise<string> {
  const result = join(scratch, "provider");
  await mkdir(join(result, "licenses"), { recursive: true });
  const results = await Promise.allSettled(
    Object.entries(assets).map(([file, [url, sha256]]) =>
      download(
        join(
          file.endsWith(".tgz") || file === "config.json" ? scratch : result,
          file,
        ),
        url,
        sha256,
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
  const { id2label } = JSON.parse(
    await readFile(join(scratch, "config.json"), "utf8"),
  );
  const labels = Array.from({ length: 1000 }, (_, index) => id2label[index]);
  if (labels.some((label) => typeof label !== "string" || label.length === 0)) {
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
