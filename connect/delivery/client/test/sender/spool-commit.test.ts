import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as ed25519 from "@noble/ed25519";
import { generateAgeIdentity } from "../../src/recipient/crypto.ts";
import { decodeJob, encodeJob } from "../../src/queue/job.ts";
import { sealCapture } from "../../src/sender/seal.ts";
import { publishEncryptedSpool } from "../../src/sender/spool-publication.ts";
import { commitEncryptedSpool, EncryptedSpoolCommitError, type EncryptedSpoolCommitResources } from "../../src/sender/spool-commit.ts";
import { readCredentialSnapshot } from "../../src/state/namespace.ts";

const id = "a".repeat(32), generation = "b".repeat(32), server = "https://connect.example/connect";
test("recovers an orphaned immutable spool into job metadata and preserves unknown job fields", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "connect-spool-commit-")));
  let held = 0, replacements = 0;
  const credential = { server, scope: "upload", generation, token: "synthetic-token", grantId: "sender", encryption_identity: "c".repeat(32),
    refreshToken: "synthetic-refresh", expiresAt: 2_000_000_000, refreshExpiresAt: 2_100_000_000 };
  const job = decodeJob(Buffer.from(JSON.stringify({ id, bundle: "/synthetic.apparent", server, generation, created: 1,
    attempts: 0, nextAttempt: 0, status: "pending", encrypted: true, grouped: false, files: [], encryption: null, futureField: { keep: 7 } })));
  const put = (name: string, value: unknown) => writeFile(path.join(root, name), JSON.stringify(value), { mode: 0o600 });
  await put("upload.credential", credential); await writeFile(path.join(root, `${id}.job`), encodeJob(job), { mode: 0o600 });
  const resources: EncryptedSpoolCommitResources = {
    async checkAcl(handle) { await handle.close(); return { state: "accepted" }; },
    async lock(handle) { await handle.close(); assert.equal(held, 0); held++; return { state: "acquired", lease: {
      signal: new AbortController().signal, assertHeld() { assert.equal(held, 1); }, async release() { held--; },
    } }; },
    async publish(parent, stage, destination) { await rename(path.join(root, stage), path.join(root, destination)); await parent.close(); return { state: "published" }; },
    async replaceFile(parent, source, destination, expected) {
      assert.equal(held, 1); replacements++;
      const target = path.join(root, destination), current = await import("node:fs/promises").then(fs => fs.lstat(target, { bigint: true }));
      assert.deepEqual({ device: String(current.dev), inode: String(current.ino) }, expected.destination);
      await rename(path.join(root, source), target); await parent.close(); return { state: "replaced" };
    },
  };
  const snapshot = await readCredentialSnapshot(root, { scope: "upload", approvedServer: server }, resources);
  const seed = new Uint8Array(32).fill(47), self = await generateAgeIdentity(), reader = await generateAgeIdentity();
  const signing = Buffer.from(await ed25519.getPublicKeyAsync(seed)).toString("hex");
  const ownPublicKey = { version: 1 as const, recipient: self.recipient, signing };
  const authority = { server, accountId: "account", grantId: "sender", scope: "upload" as const, devices: [
    { grantId: "sender", scope: "upload" as const, key: ownPublicKey },
    { grantId: "reader", scope: "read" as const, key: { ...ownPublicKey, recipient: reader.recipient } },
  ] };
  try {
    const sealed = await sealCapture({ server, captureId: id, ownPublicKey, signingSeed: seed, profile: "root",
      authority, files: [{ path: "apparent.json", bytes: Buffer.from("{}") }, { path: "summary.md", bytes: Buffer.from("synthetic") },
        { path: "contact-sheet.png", bytes: Uint8Array.of(1, 2) }], active: () => true });
    const published = await publishEncryptedSpool(root, job, sealed, snapshot, await ed25519.getPublicKeyAsync(seed), resources, { active: () => true });
    assert.equal(published.state, "committed"); if (published.state !== "committed") return;
    const before = await readFile(path.join(root, `${id}.job`));
    const result = await commitEncryptedSpool(root, job, snapshot, authority, ownPublicKey, resources, { active: () => true });
    assert.equal(result.state, "committed");
    if (result.state === "uncertain") return;
    assert.deepEqual(result.job.futureField, { keep: 7 }); assert.ok(result.job.files.length);
    const after = JSON.parse(await readFile(path.join(root, `${id}.job`), "utf8"));
    assert.deepEqual(after.futureField, { keep: 7 }); assert.ok(after.files.length); assert.equal(replacements, 1);
    assert.deepEqual(await commitEncryptedSpool(root, result.job, snapshot, authority, ownPublicKey, resources,
      { active: () => true }).then(v => v.state), "unchanged");
    assert.equal(replacements, 1); assert.notDeepEqual(before, await readFile(path.join(root, `${id}.job`)));
    assert.equal(held, 0);
    sealed.assets.forEach(asset => asset.bytes.fill(0));
  } finally { seed.fill(0); await rm(root, { recursive: true, force: true }); }
});
