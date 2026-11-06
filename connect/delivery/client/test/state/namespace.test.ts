import test from "node:test";
import assert from "node:assert/strict";
import { constants as C } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import { readCredentialSnapshot, assertCredentialSnapshotCurrent, CredentialSnapshotError, type NamespaceResources } from "../../src/state/namespace.ts";
import { readStoredCredentialHandle, CredentialReadError } from "../../src/credentials/private-read.ts";

const context = { scope: "read" as const, approvedServer: "https://sync.example" };
const credential = (generation = "a".repeat(32), token = "access") => ({ server: context.approvedServer, site: null, scope: "read", token,
  generation, refreshToken: "refresh", expiresAt: 10, refreshExpiresAt: 20, grantId: "grant", authRequired: false,
  encryption_identity: "enc", accountInitial: null });
function resources(overrides: Partial<NamespaceResources> = {}) {
  const state = { held: false, lose: false, rejectRelease: false, beforeAcquire: undefined as undefined | (() => Promise<void>) };
  const value: NamespaceResources = {
    async checkAcl(handle: FileHandle) { await handle.close(); return { state: "accepted" }; },
    async lock(handle, { signal }) {
      if (state.beforeAcquire) await state.beforeAcquire();
      if (signal?.aborted) { await handle.close(); return { state: "cancelled" }; }
      state.held = true;
      return { state: "acquired" as const, signal, async assertHeld() { return state.held && !state.lose; },
        async release() { state.held = false; await handle.close(); if (state.rejectRelease) throw new Error("fake release failure"); } };
    },
    ...overrides,
  };
  return { port: value, state };
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "connect-state-"));
  await mkdir(path.join(root, "state"), { mode: 0o700 });
  const dir = path.join(root, "state");
  const put = async (name: string, value: unknown) => writeFile(path.join(dir, name), typeof value === "string" ? value : JSON.stringify(value), { mode: 0o600 });
  await put("read.credential", credential());
  return { root, dir, put, close: () => rm(root, { recursive: true, force: true }) };
}
async function snapshot(f: Awaited<ReturnType<typeof fixture>>, port = resources().port) { return readCredentialSnapshot(f.dir, context, port); }
const category = async (promise: Promise<unknown>, expected: string) => {
  await assert.rejects(promise, e => e instanceof CredentialSnapshotError && e.category === expected);
};

test("reads compatible facts and creates only a stable queue.lock", async () => {
  const f = await fixture();
  try {
    const result = await snapshot(f);
    assert.equal(result.credential.generation, "a".repeat(32));
    assert.equal(result.cancellation, null);
    const first = await lstat(path.join(f.dir, "queue.lock"));
    await assertCredentialSnapshotCurrent(f.dir, result, resources().port);
    const second = await lstat(path.join(f.dir, "queue.lock"));
    assert.equal(first.ino, second.ino);
    assert.deepEqual((await readdir(f.dir)).sort(), ["queue.lock", "read.credential"]);
  } finally { await f.close(); }
});

test("accepts any JSON cancellation string and rejects malformed or oversized cancellation", async () => {
  const f = await fixture();
  try {
    await f.put("cancellation", "\"anything, including non-hex\"");
    assert.equal((await snapshot(f)).cancellation, "anything, including non-hex");
    await f.put("cancellation", "{");
    await category(snapshot(f), "invalid_credential");
    await f.put("cancellation", JSON.stringify("x".repeat(129)));
    await category(snapshot(f), "unsafe_file");
  } finally { await f.close(); }
});

test("any pending revocation intent blocks, regardless of contents", async () => {
  const f = await fixture();
  try { await f.put("revocation-garbage.intent", "not json"); await category(snapshot(f), "revocation_pending"); }
  finally { await f.close(); }
});

test("assert-current rejects login and cancellation changes but allows token rotation", async () => {
  const f = await fixture();
  try {
    const initial = await snapshot(f);
    await f.put("read.credential", credential("b".repeat(32)));
    await category(assertCredentialSnapshotCurrent(f.dir, initial, resources().port), "stale_snapshot");
    const next = await snapshot(f);
    await f.put("read.credential", credential("b".repeat(32), "rotated-access"));
    await assertCredentialSnapshotCurrent(f.dir, next, resources().port);
    await f.put("read.credential", JSON.stringify({ ...credential("b".repeat(32), "rotated-access"), authRequired: true }));
    await category(assertCredentialSnapshotCurrent(f.dir, next, resources().port), "stale_snapshot");
    await f.put("read.credential", credential("b".repeat(32), "rotated-access"));
    await f.put("cancellation", JSON.stringify("cancelled-login"));
    await category(assertCredentialSnapshotCurrent(f.dir, next, resources().port), "stale_snapshot");
  } finally { await f.close(); }
});

test("refuses a hardlinked queue lock while data hardlinks remain compatible", async () => {
  const f = await fixture();
  try {
    const outside = path.join(f.root, "data-link");
    await link(path.join(f.dir, "read.credential"), outside);
    const handle = await open(outside, C.O_RDONLY | (C.O_NOFOLLOW ?? 0));
    const data = await readStoredCredentialHandle(handle, context, resources().port);
    assert.equal(data.token, "access");
    await writeFile(path.join(f.dir, "queue.lock"), "", { mode: 0o600 });
    await link(path.join(f.dir, "queue.lock"), path.join(f.root, "lock-link"));
    await category(snapshot(f), "unsafe_file");
  } finally { await f.close(); }
});

test("lease loss, release failure, and abort fail closed", async () => {
  const f = await fixture();
  try {
    const lost = resources(); lost.state.lose = true;
    await category(snapshot(f, lost.port), "unavailable");
    const releaseFailure = resources(); releaseFailure.state.rejectRelease = true;
    await category(snapshot(f, releaseFailure.port), "unavailable");
    const abort = new AbortController(); abort.abort();
    await category(readCredentialSnapshot(f.dir, context, resources().port, { signal: abort.signal }), "cancelled");
    const duringWait = new AbortController(), waiting = resources();
    waiting.state.beforeAcquire = async () => { duringWait.abort(); };
    await category(readCredentialSnapshot(f.dir, context, waiting.port, { signal: duringWait.signal }), "cancelled");
  } finally { await f.close(); }
});

test("directory and lock replacements fail closed", async () => {
  const f = await fixture();
  try {
    const r = resources();
    r.state.beforeAcquire = async () => {
      const lock = path.join(f.dir, "queue.lock"), parked = path.join(f.dir, "queue.old");
      await rename(lock, parked); await writeFile(lock, "", { mode: 0o600 });
    };
    await category(snapshot(f, r.port), "unsafe_file");
    const before = await snapshot(f, resources().port);
    const parked = `${f.dir}.old`; await rename(f.dir, parked); await mkdir(f.dir, { mode: 0o700 });
    await f.put("read.credential", credential());
    await category(assertCredentialSnapshotCurrent(f.dir, before, resources().port), "stale_snapshot");
  } finally { await f.close(); }
});

