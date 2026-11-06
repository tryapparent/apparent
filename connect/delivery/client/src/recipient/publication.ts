import { createHash, randomBytes } from "node:crypto";
import { constants as C } from "node:fs";
import { lstat, mkdir, open, rmdir, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { RetrievedRecipientCapture } from "./retrieve.ts";
import type { Asset } from "./crypto.ts";
import { recipientAssets, validateRecipientReferences } from "./manifest.ts";

/** The deliberately small privileged boundary. Both methods consume their handles. */
export type RecipientPublicationResources = {
  checkAcl(handle: FileHandle): Promise<{ state: "accepted" | "refused" }>;
  publish(parent: FileHandle, sourceBasename: string, destinationBasename: string, options?: { signal?: AbortSignal }): Promise<{
    state: "published" | "destination_exists" | "refused" | "publication_uncertain";
  }>;
};
export type RecipientPublicationResult =
  | { state: "committed"; path: string; evidenceOnlyReceipt?: boolean }
  | { state: "publication_uncertain" };
export type RecipientPublicationFailure = "invalid_capture" | "invalid_destination" | "unsafe_directory" | "destination_exists" | "cancelled" | "publication_refused";
export class RecipientPublicationError extends Error {
  readonly category: RecipientPublicationFailure;
  constructor(category: RecipientPublicationFailure) { super(category); this.name = "RecipientPublicationError"; this.category = category; }
}
const fail = (category: RecipientPublicationFailure): never => { throw new RecipientPublicationError(category); };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) fail("cancelled"); };
const badUnicode = (s: string) => s.includes("\0") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
const safeAssetPath = (name: string) => !badUnicode(name) && !name.startsWith("/") && !name.includes("\\")
  && name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const flags = C.O_RDONLY | (C.O_NOFOLLOW ?? 0) | (C.O_DIRECTORY ?? 0);
function dirStat(s: { dev: bigint; ino: bigint; mode: bigint; uid: bigint }) { return `${s.dev}:${s.ino}:${s.mode}:${s.uid}`; }
async function openedDir(name: string): Promise<FileHandle> { return open(name, flags); }
async function cleanupStage(parent: FileHandle, stage: string, root: string, created: string[]): Promise<void> {
  for (const rel of [...created].reverse()) { try { await unlink(path.join(root, rel)); } catch { /* own staged files only */ } }
  try { await rmdir(path.join(root, "frames-full")); } catch { /* empty optional directory */ }
  try { await rmdir(path.join(root, "frames")); } catch { /* empty optional directory */ }
  for (const rel of ["frames-full", "frames"]) { try { await rmdir(path.join(root, rel)); } catch { /* own empty directories only */ } }
  try { await rmdir(path.join(root, stage)); } catch { /* retain if changed */ }
  try { await parent.sync(); } catch { /* cleanup is best effort */ }
}

/** Privately stage verified bytes and publish the complete directory with native NO_REPLACE. */
export async function publishRecipientCapture(
  capture: RetrievedRecipientCapture, destination: string, resources: RecipientPublicationResources,
  options: { signal?: AbortSignal } = {},
): Promise<RecipientPublicationResult> {
  const { signal } = options;
  cancelled(signal);
  let parentPath: string, basename: string;
  if (typeof destination !== "string" || badUnicode(destination) || destination.split(path.sep).includes("..")) fail("invalid_destination");
  parentPath = path.resolve(path.dirname(destination)); basename = path.basename(destination);
  if (!basename || basename === "." || basename === ".." || badUnicode(basename) || basename.includes(path.sep)) fail("invalid_destination");
  if (!capture || !/^[a-f0-9]{32}$/.test(capture.captureId) || typeof capture.server !== "string" || !Array.isArray(capture.files)) fail("invalid_capture");

  // Detach bytes before the first filesystem operation: callers may retain mutable views.
  const validationGroup = capture.evidenceOnly ? "evidence" as const : undefined;
  const assets: Asset[] = (() => {
    try { return recipientAssets(capture.files.map(({ path: p, size, sha256 }) => ({ path: p, size, sha256 })), validationGroup); }
    catch { return fail("invalid_capture"); }
  })();
  if (assets.length !== capture.files.length) fail("invalid_capture");
  const copies = capture.files.map((file, i) => {
    if (!safeAssetPath(file.path) || file.path !== assets[i]!.path || !(file.bytes instanceof Uint8Array)) fail("invalid_capture");
    const bytes = new Uint8Array(file.bytes);
    if (bytes.length !== file.size || hash(bytes) !== file.sha256) fail("invalid_capture");
    return { path: file.path, size: file.size, sha256: file.sha256, bytes };
  });
  try { validateRecipientReferences(copies, { origin: capture.server, accountId: "", captureId: capture.captureId, senderGrantId: "", ...(validationGroup ? { group: validationGroup } : {}) }); }
  catch { fail("invalid_capture"); }
  const marker = capture.evidenceOnly ? Buffer.from(JSON.stringify({ version: 1, captureId: capture.captureId, server: capture.server,
    media: "not downloaded", guidance: `Use apparent fetch ${capture.captureId} --media --out <new-directory> for the complete recording` })) : undefined;
  if (marker && marker.length > 2_000_000) fail("invalid_capture");

  const requested = path.resolve(destination);
  let parent: FileHandle | undefined, stage: string | undefined, stagePath: string | undefined;
  const created: string[] = []; let dispatched = false;
  try {
    // Walk lexical components without following links, check ACL and compare descriptor identity.
    const components = parentPath.split(path.sep).filter(Boolean);
    let prefix = path.parse(parentPath).root;
    let checkedParent: string | undefined;
    const rootHandle = await openedDir(prefix);
    const rootStat = await rootHandle.stat({ bigint: true });
    checkedParent = dirStat(rootStat);
    const rootAcl = await resources.checkAcl(rootHandle);
    const rootSticky = (rootStat.mode & 0o1000n) !== 0n;
    if (rootAcl.state !== "accepted" || !rootStat.isDirectory() || rootStat.uid !== 0n || (rootStat.mode & 0o022n) !== 0n && !rootSticky) fail("unsafe_directory");
    let privateAncestor = false;
    for (const component of components) {
      cancelled(signal);
      prefix = path.join(prefix, component);
      const handle = await openedDir(prefix);
      const before = await handle.stat({ bigint: true });
      const named = await lstat(prefix, { bigint: true });
      const sticky = (before.mode & 0o1000n) !== 0n;
      const leaf = prefix === parentPath;
      if (!before.isDirectory() || before.uid !== 0n && before.uid !== BigInt(process.getuid!())
        || before.dev !== named.dev || before.ino !== named.ino || !named.isDirectory()
        || (before.mode & 0o022n) !== 0n && !((sticky && (!leaf || true)) || (privateAncestor && !leaf))) {
        await handle.close(); fail("unsafe_directory");
      }
      const acl = await resources.checkAcl(handle);
      if (acl.state !== "accepted") fail("unsafe_directory");
      // The public result is checked after the call; handle has been consumed there.
      const afterPath = await lstat(prefix, { bigint: true });
      if (!afterPath.isDirectory() || afterPath.dev !== before.dev || afterPath.ino !== before.ino
        || afterPath.mode !== before.mode || afterPath.uid !== before.uid) fail("unsafe_directory");
      if (leaf) checkedParent = dirStat(afterPath);
      privateAncestor ||= (before.mode & 0o077n) === 0n;
    }
    parent = await openedDir(parentPath);
    const openedParentStat = await parent.stat({ bigint: true });
    const parentBefore = await parent.stat({ bigint: true });
    if (openedParentStat.dev !== parentBefore.dev || openedParentStat.ino !== parentBefore.ino
      || checkedParent !== dirStat(parentBefore)) fail("unsafe_directory");
    const target = await lstat(requested).then(() => true, () => false);
    if (target) fail("destination_exists");
    cancelled(signal);
    stage = `.apparent-stage-${randomBytes(16).toString("hex")}`; stagePath = path.join(parentPath, stage);
    await mkdir(stagePath, { mode: 0o700 });
    const stageHandle = await openedDir(stagePath);
    const stageStat = await stageHandle.stat({ bigint: true });
    if (!stageStat.isDirectory() || stageStat.uid !== BigInt(process.getuid!()) || (stageStat.mode & 0o777n) !== 0o700n) { await stageHandle.close(); fail("unsafe_directory"); }
    await stageHandle.close();
    for (const file of copies) {
      cancelled(signal);
      const targetPath = path.join(stagePath, file.path);
      const relParts = file.path.split("/");
      let dir = stagePath;
      for (const part of relParts.slice(0, -1)) {
        dir = path.join(dir, part);
        try { await mkdir(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
        const st = await lstat(dir); if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o777) !== 0o700) fail("unsafe_directory");
      }
      const fh = await open(targetPath, C.O_WRONLY | C.O_CREAT | C.O_EXCL | (C.O_NOFOLLOW ?? 0), 0o600);
      created.push(file.path);
      try { await fh.writeFile(file.bytes); await fh.sync(); const st = await fh.stat(); if (!st.isFile() || (st.mode & 0o777) !== 0o600) fail("unsafe_directory"); }
      finally { await fh.close(); }
    }
    if (marker) {
      const fh = await open(path.join(stagePath, ".evidence-only.json"), C.O_WRONLY | C.O_CREAT | C.O_EXCL | (C.O_NOFOLLOW ?? 0), 0o600);
      created.push(".evidence-only.json"); try { await fh.writeFile(marker); await fh.sync(); } finally { await fh.close(); }
    }
    // Flush every staged directory from leaves up, then its parent.
    const directories = new Set(["", ...copies.map(f => path.posix.dirname(f.path)).filter(d => d !== ".")]);
    for (const rel of [...directories].sort((a, b) => b.length - a.length)) { const d = await open(path.join(stagePath, rel), flags); try { await d.sync(); } finally { await d.close(); } }
    await parent.sync(); cancelled(signal);
    const stageBeforeDispatch = await lstat(stagePath, { bigint: true });
    if (!stageBeforeDispatch.isDirectory() || stageBeforeDispatch.dev !== stageStat.dev || stageBeforeDispatch.ino !== stageStat.ino
      || stageBeforeDispatch.uid !== stageStat.uid || stageBeforeDispatch.mode !== stageStat.mode) fail("unsafe_directory");
    const preDispatchPath = await lstat(parentPath, { bigint: true });
    const preDispatchFd = await parent.stat({ bigint: true });
    if (dirStat(preDispatchPath) !== dirStat(preDispatchFd) || preDispatchFd.dev !== parentBefore.dev || preDispatchFd.ino !== parentBefore.ino
      || preDispatchFd.mode !== parentBefore.mode || preDispatchFd.uid !== parentBefore.uid) fail("unsafe_directory");
    cancelled(signal);
    dispatched = true;
    const dispatchParent = parent; parent = undefined;
    const outcome = await resources.publish(dispatchParent, stage, basename, { signal });
    if (outcome.state === "destination_exists" || outcome.state === "refused") {
      const source = await lstat(stagePath!, { bigint: true }).catch(() => undefined);
      const namedParent = await lstat(parentPath, { bigint: true }).catch(() => undefined);
      if (source?.isDirectory() && source.dev === stageStat.dev && source.ino === stageStat.ino && source.mode === stageStat.mode && source.uid === stageStat.uid
        && namedParent?.isDirectory() && namedParent.dev === parentBefore.dev && namedParent.ino === parentBefore.ino) {
        // A definitive native refusal proves no publication happened; remove only our unchanged stage.
        const cleanupParent = await openedDir(parentPath);
        await cleanupStage(cleanupParent, stage!, stagePath!, created);
        await cleanupParent.close();
        if (outcome.state === "destination_exists") fail("destination_exists");
        fail("publication_refused");
      }
      return { state: "publication_uncertain" };
    }
    if (outcome.state !== "published") return { state: "publication_uncertain" };
    const namedParent = await openedDir(parentPath), dest = await openedDir(requested);
    try {
      const [pNamed, pFd, dNamed, dFd] = await Promise.all([lstat(parentPath, { bigint: true }), namedParent.stat({ bigint: true }), lstat(requested, { bigint: true }), dest.stat({ bigint: true })]);
      if (dirStat(pNamed) !== dirStat(pFd) || pFd.dev !== parentBefore.dev || pFd.ino !== parentBefore.ino || pFd.mode !== parentBefore.mode || pFd.uid !== parentBefore.uid
        || dirStat(dNamed) !== dirStat(dFd) || dFd.dev !== stageStat.dev || dFd.ino !== stageStat.ino
        || dFd.uid !== BigInt(process.getuid!()) || (dFd.mode & 0o777n) !== 0o700n) return { state: "publication_uncertain" };
      await namedParent.sync();
    } finally { await namedParent.close(); await dest.close(); }
    return { state: "committed", path: requested, ...(capture.evidenceOnly ? { evidenceOnlyReceipt: true } : {}) };
  } catch (error) {
    if (!dispatched && parent && stage && stagePath) await cleanupStage(parent, stage, stagePath, created);
    if (error instanceof RecipientPublicationError) throw error;
    return dispatched ? { state: "publication_uncertain" } : fail("publication_refused");
  } finally { await parent?.close(); for (const file of copies) file.bytes.fill(0); }
}
