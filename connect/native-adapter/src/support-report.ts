import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const origin = "https://app.tryapparent.com/connect";
const maximum = 32 * 1024 * 1024;

export function supportTransport(executable: string | undefined, request: typeof fetch = (input, init) => fetch(input, init)) {
  let intake: { recipient: string; maxBytes: number } | undefined;
  const getKey = async () => {
    intake = undefined;
    if (!executable || !isAbsolute(executable)) return;
    const response = await request(`${origin}/v1/support-reports/key?archive=2`, {
      redirect: "error", signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return;
    const value = await response.json() as { recipient?: string; maxBytes?: number };
    if (typeof value.recipient === "string" && /^age1[a-z0-9]{58}$/.test(value.recipient) &&
        typeof value.maxBytes === "number" && Number.isSafeInteger(value.maxBytes) &&
        value.maxBytes >= 64 && value.maxBytes <= maximum)
      intake = { recipient: value.recipient, maxBytes: value.maxBytes };
    return intake;
  };

  return {
    async available() { try { return Boolean(await getKey()); } catch { return false; } },
    async seal(bundle: string, id: string) {
      const limits = intake;
      if (!executable || !limits) throw Error("Support encryption unavailable");
      const directory = await mkdtemp(join(await realpath(tmpdir()), "apparent-support-"));
      const output = join(directory, "report.age");
      try {
        await run(executable, ["connect", "seal-support-report", bundle, output, origin, id, limits.recipient],
          { timeout: 30000, maxBuffer: 8192 });
        const file = await stat(output);
        if (file.size > limits.maxBytes) throw Error("Support report exceeds size limit");
        return await readFile(output);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async put(id: string, token: string, bytes: Buffer) {
      const response = await request(`${origin}/v1/support-reports/${id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Length": String(bytes.length),
          "Content-Type": "application/octet-stream",
          "X-Ciphertext-SHA256": createHash("sha256").update(bytes).digest("hex"),
        },
        body: Uint8Array.from(bytes),
        redirect: "error",
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) return false;
      const value = await response.json() as { id?: string; ready?: boolean };
      return value.id === id && value.ready === true;
    },
  };
}
