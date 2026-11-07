import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { CaptureClient, capture2MaterialsRoot, launchCaptureEngine } from '@apparent/engine-sdk/capture';
import { launchCaptureRecoveryPeer, launchMedia2RecoveryPeer } from '@apparent/engine-sdk/recovery';
import { AbsentDestinationAllocator, SqliteCaptureMappingStore } from '@apparent/record/host';
import type { SourceDiscovery } from '@apparent/engine-sdk/capture';
import { createRecordProductionHost } from '../production-host.ts';
import type { RecordHostServices } from '../host.ts';
import { recordShutdownEvent } from './shutdown-diagnostic.ts';

interface NativeManifest {
  schema: 1;
  target: 'linux-x64';
  sha256?: string;
  launch?: { entry: string; pathLookup: false; runtimeBuilds: false; shutdownTimeoutMs?: number };
  runtimeFiles?: Array<{ path: string; sha256: string; mode: number }>;
}

function absoluteRoot(value: string, name: string): string {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
    throw new TypeError(`${name} must be a normalized absolute path`);
  }
  return value;
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()
    || (stat.mode & 0o077) || await realpath(path) !== path) throw new Error('Record profile directory is not private');
}

async function nativeExecutable(root: string, slot: 'capture' | 'media' | 'config', entry: string): Promise<{ path: string; sha256: string }> {
  const directory = join(root, slot);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as NativeManifest;
  if (manifest.schema !== 1 || manifest.target !== 'linux-x64') throw new Error(`Invalid admitted ${slot} manifest`);
  const file = slot === 'config'
    ? (typeof manifest.sha256 === 'string' ? { path: entry, sha256: manifest.sha256, mode: 0o755 } : undefined)
    : manifest.runtimeFiles?.find(item => item.path === entry);
  if (!file || file.mode !== 0o755 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new Error(`Admitted ${slot} executable is absent from its manifest`);
  }
  const path = join(directory, entry);
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`Admitted ${slot} executable digest mismatch`);
  }
  if (slot !== 'config' && (manifest.launch?.entry !== entry || manifest.launch.pathLookup !== false || manifest.launch.runtimeBuilds !== false)) {
    throw new Error(`Admitted ${slot} launch contract is incompatible`);
  }
  return { path, sha256: file.sha256 };
}

function screenSource(discovery: SourceDiscovery) {
  // This route has no source picker yet. Only proceed when the public native
  // discovery result identifies one unambiguous full-display target.
  const screens = discovery.state === 'available' ? discovery.sources.filter(source => source.kind === 'display') : [];
  if (screens.length !== 1) throw new Error('Record requires exactly one discovered display source');
  return screens[0]!;
}

export function omarchyStartIntent(requestId: string, discovery: SourceDiscovery) {
  return {
    source: screenSource(discovery),
    options: { audio: 'none' as const, localOnly: true as const },
    // Public requests are opaque strings; the native invocation contract is
    // lowercase 128-bit hex. Keep the public mapping/destination key intact.
    invocation: { kind: 'explicit' as const,
      invocationId: createHash('sha256').update(requestId, 'utf8').digest('hex').slice(0, 32), observedAtMs: Date.now() },
  };
}

/**
 * Linux packaged Record host. Main supplies only its private profile and the
 * fixed native closure already verified by App Shell packaging.
 */
export async function createRecordHostServices(input: { profilePath: string; nativeRoot: string }): Promise<RecordHostServices> {
  const profilePath = absoluteRoot(input?.profilePath, 'profilePath');
  const nativeRoot = absoluteRoot(input?.nativeRoot, 'nativeRoot');
  await privateDirectory(profilePath);
  const capture = await nativeExecutable(nativeRoot, 'capture', 'apparent-engine-capture-launch');
  const media = await nativeExecutable(nativeRoot, 'media', 'apparent-engine-frames');
  const config = await nativeExecutable(nativeRoot, 'config', 'apparent-config-host');
  const runtimeRoot = join(profilePath, 'record-engine-runtime');
  const privateControlRoot = join(profilePath, 'record-private');
  const bundleRoot = join(profilePath, 'Record');
  for (const path of [profilePath, runtimeRoot, privateControlRoot, bundleRoot]) await privateDirectory(path);
  const mappings = new SqliteCaptureMappingStore(privateControlRoot);
  const destinations = new AbsentDestinationAllocator(privateControlRoot, bundleRoot);

  // The owning SDK connection remains alive for fresh capture admission. The
  // two recovery peers share this exact runtime and never start fresh work.
  const ownerTransport = launchCaptureEngine(capture.path, runtimeRoot, 40_000);
  const owner = new CaptureClient(ownerTransport);
  let capturePeer: Awaited<ReturnType<typeof launchCaptureRecoveryPeer>> | undefined;
  let mediaPeer: Awaited<ReturnType<typeof launchMedia2RecoveryPeer>> | undefined;
  try {
    capturePeer = await launchCaptureRecoveryPeer(capture.path, runtimeRoot);
    mediaPeer = await launchMedia2RecoveryPeer(media.path, runtimeRoot);
    let recoveryRelease: Promise<void> | undefined;
    let ownerClose: ReturnType<CaptureClient['close']> | undefined;
    const host = await createRecordProductionHost({
      coordinator: {
        captureClient: owner,
        publicationClient: capturePeer.client,
        mediaClient: mediaPeer.client,
        mappings,
        destinations,
        privateControlRoot,
        createStartIntent: (requestId, discovery) => {
          const intent = omarchyStartIntent(requestId, discovery);
          const digest = createHash('sha256').update(requestId, 'utf8').digest('hex');
          return { source: intent.source, options: intent.options, invocation: intent.invocation,
            destinationPath: join(bundleRoot, `record-${digest}.apparent`) };
        },
        trustedMaterialsRoot: mapping => capture2MaterialsRoot(runtimeRoot, mapping.captureId),
        standardProcessing: { requestVideoProof: true },
      },
      native: {
        requiredPermissionIds: [],
        clipboardProof: 'submission-readback',
        config: { executable: config.path, executableSha256: config.sha256,
          configPath: join(profilePath, 'home', '.config', 'apparent', 'config.json') },
      },
      shutdownOtherRuntimeUsers: async () => 'clear',
      closeEngine: async () => {
        recoveryRelease ??= (async () => {
          recordShutdownEvent('recovery-release-start');
          const settled = await Promise.allSettled([capturePeer!.release(), mediaPeer!.release()]);
          const expected = [capturePeer!.lifetime.peerId, mediaPeer!.lifetime.peerId];
          const valid = settled.every((result, index) => result.status === 'fulfilled'
            && result.value.scope === 'client-connection' && result.value.peerId === expected[index]
            && result.value.connection === 'released'
            && ['confirmed', 'unconfirmed', 'peer-exit-observed'].includes(result.value.inputClosure)
            && result.value.runtimeClearance === 'not-established'
            && result.value.reconcile === 'original-capture-materials-job-publication-bindings');
          if (!valid) throw new Error('Recovery peer connection release remains unknown');
          recordShutdownEvent('recovery-release-complete');
        })();
        await recoveryRelease;
        // Reached only after explicit user close and clear coordinator shutdown.
        // A requested signal is not observed exit; never retry unknown ending.
        recordShutdownEvent('capture-owner-close-start');
        ownerClose ??= owner.close();
        const outcome = await ownerClose;
        recordShutdownEvent('capture-owner-close-result', { outcome });
        if (!['already-exited', 'eof-exited', 'exit-observed', 'signal-exited', 'kill-exited'].includes(outcome)) {
          throw new Error('Capture owner exit remains unconfirmed');
        }
      },
    });
    return host;
  } catch (error) {
    // No automatic cancellation, generic close, or inferred ownership release
    // on uncertain setup. Keep every partial native handle attached to the error.
    throw new AggregateError([error], 'Record host setup failed; native runtime ownership remains retained', {
      cause: { owner, capturePeer, mediaPeer },
    });
  }
}
