import { constants as C, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { consumePrivateSealedAsset, PrivateFileError } from "../state/private-file.ts";
import { admitTrustedDirectory, directoryIdentity } from "../state/directory.ts";
import type { NamespaceResources, StateDirectory } from "../state/queue-transaction.ts";

const flags = C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK;
export const spoolFileStamp = (s: BigIntStats) => `${directoryIdentity(s)}:${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.nlink}`;
export type StampedSpoolAsset = Readonly<{ bytes: Uint8Array; stamp: string; parentIdentity: string }>;

/** Private, bounded, no-follow read of one immutable sealed asset. Bytes are owned by
 * the caller; the caller must wipe them after verification/use. */
export async function readPrivateSpoolAsset(spool: StateDirectory, name: string, size: number,
  resources: NamespaceResources, signal?: AbortSignal): Promise<StampedSpoolAsset> {
  const full = path.join(spool.path, name);
  const parent = await admitTrustedDirectory(path.dirname(full), resources, "private-state", signal);
  try {
    let handle = await open(full, flags);
    try {
      const before = await handle.stat({ bigint: true }), named = await lstat(full, { bigint: true });
      if (!named.isFile() || named.isSymbolicLink() || spoolFileStamp(before) !== spoolFileStamp(named)) throw new PrivateFileError("unsafe_file");
      const transferred = handle; handle = undefined as never;
      const bytes = await consumePrivateSealedAsset(transferred, { maximumBytes: size, signal }, resources);
      const after = await lstat(full, { bigint: true });
      if (bytes.length !== size || spoolFileStamp(after) !== spoolFileStamp(before)) { bytes.fill(0); throw new PrivateFileError("unsafe_file"); }
      const parentAfter = await lstat(parent.path, { bigint: true });
      if (!parentAfter.isDirectory() || directoryIdentity(parentAfter) !== parent.identity
        || directoryIdentity(await parent.handle.stat({ bigint: true })) !== parent.identity) { bytes.fill(0); throw new PrivateFileError("unsafe_file"); }
      return Object.freeze({ bytes, stamp: spoolFileStamp(before), parentIdentity: parent.identity });
    } finally { await handle?.close().catch(() => {}); }
  } finally { await parent.handle.close().catch(() => {}); }
}
