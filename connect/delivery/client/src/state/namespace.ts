import { constants as C } from "node:fs";
import { lstat, open, readdir, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { StoredCredential } from "../credentials/wire.ts";
import { readStoredCredentialHandle, type CredentialReadResources } from "../credentials/private-read.ts";
import { admitTrustedDirectory, directoryIdentity } from "./directory.ts";

export type NamespaceResources = CredentialReadResources & {
  /** Consumes the lock descriptor. Busy waits are cancellation-aware and timeout-bounded. */
  lock(handle: FileHandle, options: { timeoutMs: number; signal?: AbortSignal }): Promise<
    | { state: "acquired"; assertHeld(): Promise<boolean>; signal?: AbortSignal; release(): Promise<void> }
    | { state: "busy" | "cancelled" | "failed" | "refused" }
  >;
};
export type CredentialSnapshot = Readonly<{ credential: StoredCredential; cancellation: string | null; directoryIdentity: string }>;
export type SnapshotFailure = "unsafe_directory" | "unsafe_file" | "invalid_credential" | "cancelled" | "unavailable" | "lock_refused" | "revocation_pending" | "stale_snapshot";
export class CredentialSnapshotError extends Error {
  readonly category: SnapshotFailure;
  constructor(category: SnapshotFailure) { super(category); this.category = category; this.name = "CredentialSnapshotError"; }
}
const fail = (category: SnapshotFailure): never => { throw new CredentialSnapshotError(category); };
const identity = (s: { dev: bigint; ino: bigint; mode: bigint; uid: bigint }) => `${s.dev}:${s.ino}:${s.mode}:${s.uid}`;
const checkSignal = (signal?: AbortSignal, leaseSignal?: AbortSignal) => { if (signal?.aborted || leaseSignal?.aborted) fail("cancelled"); };
const samePathFd = async (directory: { handle: FileHandle; path: string; identity: string }) => {
  try {
    const [fd, named] = await Promise.all([directory.handle.stat({ bigint: true }), lstat(directory.path, { bigint: true })]);
    return named.isDirectory() && identity(fd) === directory.identity && identity(named) === directory.identity;
  } catch { return false; }
};
async function pendingIntent(directoryPath: string): Promise<boolean> {
  try {
    for (const name of await readdir(directoryPath)) if (name.startsWith("revocation-") && name.endsWith(".intent")) return true;
    return false;
  } catch { return fail("unavailable"); }
}
async function lockFile(directory: { handle: FileHandle; path: string; identity: string }, resources: NamespaceResources,
  timeoutMs: number, signal?: AbortSignal) {
  checkSignal(signal);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !await samePathFd(directory)) fail("unsafe_directory");
  const lockPath = path.join(directory.path, "queue.lock");
  let handle: FileHandle | undefined;
  try { handle = await open(lockPath, C.O_RDWR | C.O_CREAT | (C.O_NOFOLLOW ?? 0) | (C.O_NONBLOCK ?? 0), 0o600); }
  catch { fail("unsafe_file"); }
  const lockHandle = handle!;
  let verifyHandle: FileHandle | undefined;
  let lease: Awaited<ReturnType<NamespaceResources["lock"]>> | undefined;
  try {
    verifyHandle = await open(lockPath, C.O_RDONLY | (C.O_NOFOLLOW ?? 0) | (C.O_NONBLOCK ?? 0));
    const before = await lockHandle.stat({ bigint: true }), named = await lstat(lockPath, { bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid!()) || (before.mode & 0o077n) !== 0n || before.nlink !== 1n
      || !named.isFile() || named.isSymbolicLink() || identity(before) !== identity(named)) {
      await lockHandle.close().catch(() => {}); handle = undefined; fail("unsafe_file");
    }
    handle = undefined;
    lease = await resources.lock(lockHandle, { timeoutMs, signal });
    if (lease.state !== "acquired") fail(lease.state === "cancelled" ? "cancelled" : lease.state === "busy" ? "lock_refused" : "unavailable");
    const after = await lstat(lockPath, { bigint: true }), fd = await verifyHandle.stat({ bigint: true });
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n || identity(after) !== identity(before) || identity(fd) !== identity(before)) fail("unsafe_file");
    if (!await samePathFd(directory)) fail("unsafe_directory");
    await verifyHandle.close(); verifyHandle = undefined;
    return { lease, lockPath, lockIdentity: identity(before) };
  } catch (e) {
    await handle?.close().catch(() => {}); await verifyHandle?.close().catch(() => {});
    if (lease?.state === "acquired") { try { await lease.release(); } catch {} }
    if (e instanceof CredentialSnapshotError) throw e;
    return fail("unavailable");
  }
}
async function release(lease: Extract<Awaited<ReturnType<NamespaceResources["lock"]>>, { state: "acquired" }>) {
  try { await lease.release(); } catch { fail("unavailable"); }
}
async function readCancellation(directory: { path: string; identity: string }, signal?: AbortSignal): Promise<string | null> {
  const file = path.join(directory.path, "cancellation");
  let h: FileHandle;
  try { h = await open(file, C.O_RDONLY | (C.O_NOFOLLOW ?? 0) | (C.O_NONBLOCK ?? 0)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; return fail("unsafe_file"); }
  try {
    const before = await h.stat({ bigint: true }), named = await lstat(file, { bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid!()) || (before.mode & 0o077n) !== 0n || before.size > 128n
      || named.isSymbolicLink() || !named.isFile() || identity(named) !== identity(before)) fail("unsafe_file");
    const chunks: Buffer[] = []; let n = 0; const buf = Buffer.alloc(129);
    try {
      while (n < buf.length) { checkSignal(signal); const r = await h.read(buf, n, buf.length - n, n); if (!r.bytesRead) break; n += r.bytesRead; }
      const after = await h.stat({ bigint: true }), namedAfter = await lstat(file, { bigint: true });
      if (n > 128 || BigInt(n) !== before.size || identity(after) !== identity(before) || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs
        || identity(namedAfter) !== identity(before)) fail("unsafe_file");
      let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, n))); } catch { return fail("invalid_credential"); }
      if (typeof value !== "string") fail("invalid_credential");
      return value as string;
    } finally { buf.fill(0); }
  } catch (e) { if (e instanceof CredentialSnapshotError) throw e; if (signal?.aborted) return fail("cancelled"); return fail("unavailable"); }
  finally { await h.close().catch(() => {}); }
}
async function readCredential(directory: { path: string; identity: string }, context: { scope: "read" | "upload"; approvedServer: string }, resources: NamespaceResources, signal?: AbortSignal): Promise<StoredCredential> {
  const file = path.join(directory.path, `${context.scope}.credential`);
  let h: FileHandle;
  try { h = await open(file, C.O_RDONLY | (C.O_NOFOLLOW ?? 0) | (C.O_NONBLOCK ?? 0)); } catch { return fail("invalid_credential"); }
  try {
    const before = await h.stat({ bigint: true }), named = await lstat(file, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || identity(named) !== identity(before)) fail("unsafe_file");
    const consumed = h; h = undefined as never;
    let credential: StoredCredential;
    try { credential = await readStoredCredentialHandle(consumed, context, resources, { signal }); }
    catch (error) {
      const namedAfterFailure = await lstat(file, { bigint: true }).catch(() => undefined);
      if (!namedAfterFailure || identity(namedAfterFailure) !== identity(before)) fail("unsafe_file");
      throw error;
    }
    const namedAfter = await lstat(file, { bigint: true });
    if (identity(namedAfter) !== identity(before)) fail("unsafe_file");
    return credential;
  } catch (e) { await h?.close().catch(() => {}); if (e instanceof CredentialSnapshotError) throw e;
    if (e && typeof e === "object" && "category" in e) {
      const category = (e as { category: string }).category;
      if (["invalid_credential", "unsafe_file", "cancelled", "unavailable"].includes(category)) fail(category as SnapshotFailure);
    }
    return fail("unavailable"); }
}
async function withSnapshot<T>(directoryPath: string, context: { scope: "read" | "upload"; approvedServer: string }, resources: NamespaceResources,
  options: { signal?: AbortSignal; lockTimeoutMs?: number }, body: (directory: { handle: FileHandle; path: string; identity: string }, lease: Extract<Awaited<ReturnType<NamespaceResources["lock"]>>, { state: "acquired" }>) => Promise<T>): Promise<T> {
  const signal = options.signal, lockTimeoutMs = options.lockTimeoutMs, scope = context?.scope, approvedServer = context?.approvedServer;
  if ((scope !== "read" && scope !== "upload") || typeof approvedServer !== "string") fail("invalid_credential");
  checkSignal(signal);
  let directory: Awaited<ReturnType<typeof admitTrustedDirectory>>;
  try { directory = await admitTrustedDirectory(directoryPath, resources, "private-state", signal); }
  catch (e) { if (e && typeof e === "object" && "category" in e) return fail((e as { category: SnapshotFailure }).category); return fail("unsafe_directory"); }
  try {
    const lock = await lockFile(directory!, resources, lockTimeoutMs ?? 1000, signal);
    try {
      if (lock.lease.state !== "acquired") fail("unavailable");
      const lease = lock.lease as Extract<Awaited<ReturnType<NamespaceResources["lock"]>>, { state: "acquired" }>;
      checkSignal(signal, lease.signal);
      if (!await lease.assertHeld()) fail("unavailable");
      const result = await body(directory!, lease);
      checkSignal(signal, lease.signal);
      if (!await lease.assertHeld() || !await samePathFd(directory!)) fail("unavailable");
      const named = await lstat(lock.lockPath, { bigint: true });
      if (identity(named) !== lock.lockIdentity) fail("unsafe_file");
      return result;
    } finally { if (lock.lease.state === "acquired") await release(lock.lease); }
  } finally { await directory!.handle.close().catch(() => {}); }
}

/** Reads stored credential facts under the legacy queue lock. It does not decide token expiry,
 * service authorization or renew credentials; callers must use their own approved context. */
export async function readCredentialSnapshot(directoryPath: string,
  context: { scope: "read" | "upload"; approvedServer: string }, resources: NamespaceResources,
  options: { signal?: AbortSignal; lockTimeoutMs?: number } = {}): Promise<CredentialSnapshot> {
  const ctx = { scope: context?.scope, approvedServer: context?.approvedServer } as typeof context;
  const opts = { signal: options.signal, lockTimeoutMs: options.lockTimeoutMs };
  return withSnapshot(directoryPath, ctx, resources, opts, async (directory, lease) => {
    checkSignal(opts.signal, lease.signal);
    if (await pendingIntent(directory.path)) fail("revocation_pending");
    const cancellation = await readCancellation(directory, opts.signal);
    const credential = await readCredential(directory, ctx, resources, opts.signal);
    if (await pendingIntent(directory.path)) fail("revocation_pending");
    return Object.freeze({ credential, cancellation, directoryIdentity: directory.identity });
  });
}

/** Revalidates login incarnation and cancellation under the same queue transaction.
 * Access/refresh token rotation within the same login is allowed. */
export async function assertCredentialSnapshotCurrent(directoryPath: string, snapshot: CredentialSnapshot,
  resources: NamespaceResources, options: { signal?: AbortSignal; lockTimeoutMs?: number } = {}): Promise<void> {
  if (!snapshot || !snapshot.credential) fail("stale_snapshot");
  const original = snapshot.credential;
  const opts = { signal: options.signal, lockTimeoutMs: options.lockTimeoutMs };
  await withSnapshot(directoryPath, { scope: original.scope as "read" | "upload", approvedServer: original.server }, resources, opts,
    async (directory, lease) => {
      checkSignal(opts.signal, lease.signal);
      if (directory.identity !== snapshot.directoryIdentity) fail("stale_snapshot");
      if (await pendingIntent(directory.path)) fail("revocation_pending");
      const cancellation = await readCancellation(directory, opts.signal);
      if (cancellation !== snapshot.cancellation) fail("stale_snapshot");
      const current = await readCredential(directory, { scope: original.scope as "read" | "upload", approvedServer: original.server }, resources, opts.signal);
      if (await pendingIntent(directory.path)) fail("revocation_pending");
      if (current.generation !== original.generation || current.server !== original.server || current.scope !== original.scope
        || current.grantId !== original.grantId || current.encryption_identity !== original.encryption_identity || current.authRequired) fail("stale_snapshot");
    });
}
