import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { source, uvArtifact, weights, type LipArtifact } from "./lip-artifacts.ts";

const run = promisify(execFile);
export const managedLipflow = ".apparent-lipflow-v1";

export async function trustedPath(path: string) {
  const uid = process.getuid?.();
  for (let current = path; current !== dirname(current); current = dirname(current)) {
    const item = await lstat(current);
    if (item.isSymbolicLink() || (item.uid !== uid && item.uid !== 0) ||
        ((item.mode & 0o022) !== 0 && (!item.isDirectory() || (item.mode & 0o1000) === 0)))
      throw Error("Unsafe model location");
  }
}

async function download(artifact: LipArtifact, file: string, signal: AbortSignal) {
  const response = await fetch(artifact.url, { signal });
  if (!response.ok || !response.body) throw Error("Model download unavailable");
  const hash = createHash("sha256");
  let length = 0;
  const digest = new Transform({
    transform(bytes: Buffer, _encoding, next) {
      length += bytes.length;
      if (length > artifact.limit) return next(Error("Model exceeds download limit"));
      hash.update(bytes);
      next(null, bytes);
    },
  });
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    digest, createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal });
  if (hash.digest("hex") !== artifact.sha256) throw Error("Model download checksum mismatch");
}

export async function installLipflow(models: string, cancel: AbortSignal) {
  const artifact = uvArtifact(process.platform, process.arch);
  if (!artifact) throw Error("Unsupported lip-reading platform");
  const signal = AbortSignal.any([cancel, AbortSignal.timeout(30 * 60_000)]);
  await mkdir(models, { recursive: true, mode: 0o700 });
  await trustedPath(models);
  const python = join(models, ".lipflow-python");
  await mkdir(python, { mode: 0o700, recursive: true });
  await trustedPath(python);
  const staging = await mkdtemp(join(models, ".lipflow-stage-"));
  try {
    const project = join(staging, "source");
    const runtime = join(staging, "runtime");
    await mkdir(project, { mode: 0o700 });
    await mkdir(runtime, { mode: 0o700 });
    const sourceArchive = join(staging, "lipflow.tar.gz");
    const uvArchive = join(staging, "uv.tar.gz");
    await download(source, sourceArchive, signal);
    await download(artifact, uvArchive, signal);
    await run("/usr/bin/tar", ["-xzf", sourceArchive, "--strip-components=1", "-C", project], {signal});
    await run("/usr/bin/tar", ["-xzf", uvArchive, "--strip-components=1", "-C", runtime], {signal});
    for (const [name, model] of weights) {
      const output = join(project, "models", name);
      await mkdir(dirname(output), { mode: 0o700, recursive: true });
      await download(model, output, signal);
    }
    const cache = join(staging, "cache");
    const env = {
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      PATH: "/usr/bin:/bin",
      TMPDIR: staging,
      UV_CACHE_DIR: cache,
      UV_PYTHON_INSTALL_DIR: python,
      UV_PROJECT_ENVIRONMENT: join(project, ".venv"),
      UV_NO_PROGRESS: "1",
    };
    await run(join(runtime, "uv"), ["--no-config", "sync", "--frozen", "--no-dev", "--no-build", "--no-install-project",
      "--managed-python", "--python", "3.12"], { cwd: project, env, signal, maxBuffer: 256 * 1024 });
    await run(join(project, ".venv", "bin", "python"), ["-m", "lipflow", "file", "--help"], {
      cwd: project, env, signal, maxBuffer: 64 * 1024,
    });
    await writeFile(join(project, managedLipflow), "", { mode: 0o600, flag: "wx", signal });
    signal.throwIfAborted();
    await rename(project, join(models, "lipflow-managed"));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
