import { lstatSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export function storage(root: string, allowMissing = false) {
  const entries = [root];
  const inodes = new Set<string>();
  let logicalBytes = 0;
  let allocatedBytes = 0;
  const files = { video: 0, audio: 0, images: 0, other: 0 };
  while (entries.length) {
    const path = entries.pop()!;
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink())
        throw new Error("Unexpected symlink in measured path");
      if (stat.isDirectory()) {
        entries.push(...readdirSync(path).map((name) => join(path, name)));
      } else if (stat.isFile()) {
        const kind = /\.(mp4|mov|webm)$/i.test(path)
          ? "video"
          : /\.(wav|m4a|ogg|opus|flac|aac)$/i.test(path)
            ? "audio"
            : /\.(png|jpe?g|webp)$/i.test(path)
              ? "images"
              : "other";
        files[kind] += stat.size;
        logicalBytes += stat.size;
      } else {
        throw new Error("Unexpected file type in measured path");
      }
      const identity = stat.dev + ":" + stat.ino;
      if (!inodes.has(identity)) {
        inodes.add(identity);
        allocatedBytes += stat.blocks * 512;
      }
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT")
        throw error;
    }
  }
  return { logicalBytes, allocatedBytes, files };
}

async function scratch(root: string, program: string, args: string[]) {
  if (!lstatSync(root).isDirectory())
    throw new Error("Expected a private scratch directory");
  const initial = storage(root).allocatedBytes;
  let peak = initial;
  let samples = 0;
  let failure: unknown;
  const sample = () => {
    try {
      peak = Math.max(peak, storage(root, true).allocatedBytes);
      samples++;
    } catch (error) {
      failure ??= error;
    }
  };
  const child = spawn(program, args, {
    stdio: ["ignore", "inherit", "inherit"],
  });
  sample();
  const timer = setInterval(sample, 100);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error("Scratch workload failed: " + (signal ?? code)));
      });
    });
    sample();
    if (failure) throw failure;
    return { peakScratchBytes: peak - initial, samples, intervalMs: 100 };
  } finally {
    clearInterval(timer);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [mode, directory, delimiter, program, ...args] = process.argv.slice(2);
  if (mode === "bundle" && directory && !delimiter) {
    console.log(JSON.stringify(storage(resolve(directory))));
  } else if (mode === "scratch" && directory && delimiter === "--" && program) {
    console.error(
      JSON.stringify(await scratch(resolve(directory), program, args)),
    );
  } else {
    throw new Error(
      "Usage: storage.ts bundle BUNDLE | scratch PRIVATE_DIRECTORY -- COMMAND [ARG...]",
    );
  }
}
