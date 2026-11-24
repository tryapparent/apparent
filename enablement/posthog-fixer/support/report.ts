import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Config, secret } from "../config.ts";

const origin = "https://app.tryapparent.com/connect";
const maxBytes = 500_000_000;
const maxPartBytes = 90_000_000;
const legacyMaxBytes = 32 * 1024 * 1024;
const maxArchiveBytes = maxBytes + 2 * 1024 * 1024;
const run = promisify(execFile);

export function supportReportId(context: string): string | undefined {
  const ids = new Set(
    [
      ...context.matchAll(
        /\bapparent-support-report:([a-f0-9]{32})(?![a-f0-9])/g,
      ),
    ].map((match) => match[1]),
  );
  if (ids.size > 1) throw Error("Multiple private reports in one issue");
  return ids.values().next().value;
}

type Part = { name: string; size: number };
type Archive = { body: Readable; bytes: number; dispose(): Promise<void> };

function archiveParts(value: unknown): Part[] {
  const parts = (value as { parts?: unknown })?.parts;
  if (
    !Array.isArray(parts) ||
    !parts.length ||
    parts.length > 6 ||
    !parts.every(
      (part, index) =>
        part?.name === `part-${index}.age` &&
        Number.isSafeInteger(part.size) &&
        part.size > 0 &&
        part.size <= maxPartBytes,
    ) ||
    parts.reduce((total, part) => total + part.size, 0) > maxBytes
  )
    throw Error("Invalid support archive manifest");
  return parts;
}

async function* checkedBody(response: Response, expected: number) {
  if (
    !response.ok ||
    !response.body ||
    !Number.isSafeInteger(expected) ||
    expected <= 0 ||
    Number(response.headers.get("Content-Length")) !== expected
  ) {
    await response.body?.cancel();
    throw Error("Private recording unavailable");
  }
  const stream = response.body.getReader();
  let remaining = expected;
  try {
    for (;;) {
      const { done, value } = await stream.read();
      if (done) break;
      remaining -= value.byteLength;
      if (remaining < 0) throw Error("Private recording exceeded its bound");
      yield value;
    }
  } finally {
    await stream.cancel().catch(() => {});
  }
  if (remaining !== 0) throw Error("Incomplete private recording");
}

export async function fetchSupportArchive(
  config: Config,
  id: string,
  request = fetch,
): Promise<Archive> {
  if (!config.support) throw Error("Private support reader is not configured");
  const { executable, keyFile, tokenFile } = config.support;
  const token = secret(tokenFile);
  if (!/^[a-f0-9]{64}$/.test(token))
    throw Error("Invalid private support token");
  if (!/^[a-f0-9]{32}$/.test(id))
    throw Error("Invalid private report identity");
  const scratch = await mkdtemp(
    join(await realpath(tmpdir()), "apparent-support-"),
  );
  const dispose = () => rm(scratch, { recursive: true, force: true });
  const get = (suffix: string) =>
    request(`${origin}/v1/support-reports/${id}${suffix}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });

  async function* download() {
    const manifest = await get("/archive");
    if (manifest.status === 404) {
      await manifest.body?.cancel();
      const legacy = await get("");
      const size = Number(legacy.headers.get("Content-Length"));
      if (size > legacyMaxBytes) {
        await legacy.body?.cancel();
        throw Error("Legacy report exceeds its bound");
      }
      yield* checkedBody(legacy, size);
      return;
    }
    if (!manifest.ok) {
      await manifest.body?.cancel();
      throw Error("Private recording unavailable");
    }
    const manifestChunks: Buffer[] = [];
    let manifestBytes = 0;
    if (!manifest.body) throw Error("Private recording manifest unavailable");
    const reader = manifest.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        manifestBytes += value.length;
        if (manifestBytes > 4096)
          throw Error("Private recording manifest exceeds its bound");
        manifestChunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    for (const part of archiveParts(
      JSON.parse(Buffer.concat(manifestChunks).toString("utf8")),
    ))
      yield* checkedBody(await get("/archive/" + part.name), part.size);
  }

  try {
    const input = join(scratch, "report.age");
    const output = join(scratch, "recording.apparent");
    const archive = join(scratch, "recording.tar");
    await pipeline(
      Readable.from(download()),
      createWriteStream(input, { mode: 0o600, flags: "wx" }),
    );
    await run(
      executable,
      ["connect", "open-support-report", input, output, origin, id, keyFile],
      { timeout: 120000, maxBuffer: 8192 },
    );
    await run(
      "/usr/bin/tar",
      ["--format=ustar", "-cf", archive, "-C", scratch, "recording.apparent"],
      { timeout: 120000, maxBuffer: 8192 },
    );
    const { size } = await stat(archive);
    if (size <= 0 || size > maxArchiveBytes)
      throw Error("Private archive exceeds its bound");
    return { body: createReadStream(archive), bytes: size, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
