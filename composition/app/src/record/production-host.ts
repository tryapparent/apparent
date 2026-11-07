import {
  createStandardRecordCaptureCoordinator,
  type RecordCaptureCoordinator,
  type StandardRecordCaptureCoordinatorOptions,
} from '@apparent/record/host/capture2-coordinator';
import { preflightCapturePublication } from '@apparent/engine-sdk/capture';
import type { CaptureClient } from '@apparent/engine-sdk/capture';
import type { Media2Client } from '@apparent/engine-sdk/media2';
import type { RecoveryPeer, RecoveryPeerFacts, RecoveryPeerRelease } from '@apparent/engine-sdk/recovery';
import { bindRecordCoordinatorHost, type RecordCoordinatorHostOptions } from './coordinator-host.ts';
import { createRecordNativeBindings, type RecordNativeBindingOptions, type RecordNativeBindings } from './native-bindings.ts';

export interface RecordProductionHostOptions {
  /** Already constructed, admitted public SDK clients and explicit owner policy. */
  coordinator: Omit<StandardRecordCaptureCoordinatorOptions, 'preflight'>;
  /** Privileged native/config inputs; the resolver always comes from Record. */
  native: Omit<RecordNativeBindingOptions, 'resolveHandoff'>;
  shutdownOtherRuntimeUsers: RecordCoordinatorHostOptions['shutdownOtherRuntimeUsers'];
  closeEngine: RecordCoordinatorHostOptions['closeEngine'];
}

export interface RecordRecoveryProductionHostOptions {
  /** Standard Record policy and ports, with SDK clients injected from retained peers. */
  coordinator: Omit<StandardRecordCaptureCoordinatorOptions, 'preflight' | 'captureClient' | 'mediaClient' | 'publicationClient'>;
  /** Privileged native/config inputs; the resolver always comes from Record. */
  native: Omit<RecordNativeBindingOptions, 'resolveHandoff'>;
  peers: { capture: RecoveryPeer<CaptureClient>; media: RecoveryPeer<Media2Client> };
  shutdownOtherRuntimeUsers: RecordCoordinatorHostOptions['shutdownOtherRuntimeUsers'];
}

/** Setup failure transfers any partial assembly back to the caller for authoritative recovery.
 * No SDKs are closed, captures cancelled or unknown ownership inferred clear. */
export class RecordHostSetupError extends Error {
  constructor(cause: unknown, readonly nativeBindings: RecordNativeBindings,
    readonly coordinator: RecordCaptureCoordinator | undefined) {
    super('Record host setup failed; caller retains SDK and partial assembly ownership', { cause });
    this.name = 'RecordHostSetupError';
  }
}

/** Trusted-main composition only. It does not launch workers, select source/frame policy,
 * activate installed routing, or acquire authority over other SDK/runtime users. */
export async function createRecordProductionHost(options: RecordProductionHostOptions) {
  if (!options || !options.coordinator || !options.native
    || typeof options.shutdownOtherRuntimeUsers !== 'function' || typeof options.closeEngine !== 'function') {
    throw new TypeError('Record production composition requires explicit runtime ownership');
  }
  const coordinatorOptions = snapshotCoordinatorOptions(options.coordinator);
  const shutdownOtherRuntimeUsers = options.shutdownOtherRuntimeUsers;
  const closeEngine = options.closeEngine;
  return createBoundProductionHost({ coordinatorOptions, nativeOptions: options.native,
    shutdownOtherRuntimeUsers, closeEngine });
}

export type RecoveryPeerReleaseState = 'pending' | 'released' | 'unknown';
export interface RecoveryPeerReleaseDiagnostic {
  peerId: string;
  /** Captured from the peer's immutable lifetime facts; SDK 0.4.3 release receipts omit channel. */
  channel: RecoveryPeerFacts['channel'];
  state: 'pending' | 'released' | 'unknown';
  receipt?: RecoveryPeerRelease;
}
export interface RecordRecoveryReleaseDiagnostic {
  state: RecoveryPeerReleaseState;
  capture: RecoveryPeerReleaseDiagnostic;
  media: RecoveryPeerReleaseDiagnostic;
}

/**
 * Uses two already-admitted SDK recovery peers as Record's ordinary coordinator clients.
 * Connection release is local only; it does not establish Engine runtime clearance.
 */
export async function createRecordRecoveryProductionHost(options: RecordRecoveryProductionHostOptions) {
  if (!options || !options.coordinator || !options.native || !options.peers
    || typeof options.shutdownOtherRuntimeUsers !== 'function') {
    throw new TypeError('Record recovery composition requires explicit retained peers and runtime drain');
  }
  if ('publicationClient' in options.coordinator) {
    throw new TypeError('Record recovery composition does not accept an additional publication client');
  }
  // Snapshot all capabilities and immutable lifetime facts before native setup yields.
  const capture = snapshotRecoveryPeer(options.peers.capture, 'capture/2');
  const media = snapshotRecoveryPeer(options.peers.media, 'media/2');
  if (Object.is(capture.peer, media.peer) || Object.is(capture.client, media.client)
    || capture.facts.peerId === media.facts.peerId) {
    throw new TypeError('Record recovery composition requires two distinct recovery peers');
  }
  const coordinatorOptions = snapshotCoordinatorOptions({
    ...options.coordinator,
    captureClient: capture.client,
    mediaClient: media.client,
  });
  const shutdownOtherRuntimeUsers = options.shutdownOtherRuntimeUsers;
  let releaseState: RecoveryPeerReleaseState = 'pending';
  let releaseTask: Promise<void> | undefined;
  let captureAttempt: RecoveryPeerReleaseDiagnostic = {
    peerId: capture.facts.peerId, channel: capture.facts.channel, state: 'pending',
  };
  let mediaAttempt: RecoveryPeerReleaseDiagnostic = {
    peerId: media.facts.peerId, channel: media.facts.channel, state: 'pending',
  };
  const releaseRecoveryPeersAfterDrain = (): Promise<void> => {
    if (releaseTask) return releaseTask;
    releaseTask = (async () => {
      const settled = await Promise.allSettled([
        Promise.resolve().then(() => capture.invokeRelease()),
        Promise.resolve().then(() => media.invokeRelease()),
      ]);
      captureAttempt = releaseAttempt(capture.facts, settled[0]);
      mediaAttempt = releaseAttempt(media.facts, settled[1]);
      releaseState = captureAttempt.state === 'released' && mediaAttempt.state === 'released'
        ? 'released' : 'unknown';
      if (releaseState !== 'released') throw new Error('Recovery connection release remains unknown');
    })();
    return releaseTask;
  };
  const closeEngine = async () => {
    if (releaseState !== 'released') {
      throw new Error('Record recovery peers were not both locally released');
    }
    // Recovery peers own their connection release. Never call their clients' close().
  };
  const host = await createBoundProductionHost({ coordinatorOptions, nativeOptions: options.native,
    shutdownOtherRuntimeUsers, closeEngine, releaseRecoveryPeersAfterDrain });
  return {
    ...host,
    recoveryRelease: (): RecordRecoveryReleaseDiagnostic => ({
      state: releaseState,
      capture: copyReleaseDiagnostic(captureAttempt),
      media: copyReleaseDiagnostic(mediaAttempt),
    }),
  };
}

interface RecoveryPeerSnapshot<Client> {
  peer: RecoveryPeer<Client>;
  client: Client;
  release: RecoveryPeer<Client>['release'];
  facts: Readonly<RecoveryPeerFacts>;
  invokeRelease(): Promise<RecoveryPeerRelease>;
}

function snapshotRecoveryPeer<Client>(peer: RecoveryPeer<Client>, expectedChannel: RecoveryPeerFacts['channel']): RecoveryPeerSnapshot<Client> {
  if (!peer || typeof peer !== 'object') throw new TypeError('Record recovery peer is required');
  const retainedPeer = peer;
  const client = peer.client;
  const lifetime = peer.lifetime;
  const release = peer.release;
  if (!client || (typeof client !== 'object' && typeof client !== 'function')
    || typeof release !== 'function' || !lifetime || typeof lifetime !== 'object') {
    throw new TypeError('Record recovery peer is incomplete');
  }
  const facts: RecoveryPeerFacts = Object.freeze({
    schema: lifetime.schema,
    peerId: lifetime.peerId,
    channel: lifetime.channel,
    implementation: lifetime.implementation,
    role: lifetime.role,
    startsFreshCapture: lifetime.startsFreshCapture,
    onInputEof: lifetime.onInputEof,
  });
  if (facts.schema !== 'apparent.engine-recovery-peer/1'
    || typeof facts.peerId !== 'string' || facts.peerId.length === 0 || facts.peerId.length > 256
    || facts.channel !== expectedChannel || facts.implementation !== 'native'
    || facts.role !== 'recovery' || facts.startsFreshCapture !== false
    || facts.onInputEof !== 'retain-admitted-finite-work') {
    throw new TypeError('Record recovery peer lifetime facts are incompatible');
  }
  return { peer: retainedPeer, client, release, facts,
    invokeRelease: () => Reflect.apply(release, retainedPeer, []) as Promise<RecoveryPeerRelease> };
}

function releaseAttempt(
  facts: Readonly<RecoveryPeerFacts>,
  result: PromiseSettledResult<RecoveryPeerRelease>,
): RecoveryPeerReleaseDiagnostic {
  if (result.status !== 'fulfilled' || !validReleaseReceipt(result.value, facts)) {
    return { peerId: facts.peerId, channel: facts.channel, state: 'unknown' };
  }
  return { peerId: facts.peerId, channel: facts.channel, state: 'released',
    receipt: { ...result.value } };
}

function validReleaseReceipt(receipt: RecoveryPeerRelease, facts: Readonly<RecoveryPeerFacts>): boolean {
  if (!receipt || typeof receipt !== 'object') return false;
  const optionalChannel = (receipt as RecoveryPeerRelease & { channel?: unknown }).channel;
  return receipt.scope === 'client-connection' && receipt.peerId === facts.peerId
    && receipt.connection === 'released'
    && ['confirmed', 'unconfirmed', 'peer-exit-observed'].includes(receipt.inputClosure)
    && receipt.runtimeClearance === 'not-established'
    && receipt.reconcile === 'original-capture-materials-job-publication-bindings'
    && (optionalChannel === undefined || optionalChannel === facts.channel);
}

function copyReleaseDiagnostic(value: RecoveryPeerReleaseDiagnostic): RecoveryPeerReleaseDiagnostic {
  return { ...value, ...(value.receipt ? { receipt: { ...value.receipt } } : {}) };
}

function snapshotCoordinatorOptions(
  options: Omit<StandardRecordCaptureCoordinatorOptions, 'preflight'>,
) {
  return { ...options, standardProcessing: structuredClone(options.standardProcessing),
    preflight: preflightCapturePublication };
}

async function createBoundProductionHost(options: {
  coordinatorOptions: StandardRecordCaptureCoordinatorOptions;
  nativeOptions: Omit<RecordNativeBindingOptions, 'resolveHandoff'>;
  shutdownOtherRuntimeUsers: RecordCoordinatorHostOptions['shutdownOtherRuntimeUsers'];
  closeEngine: RecordCoordinatorHostOptions['closeEngine'];
  releaseRecoveryPeersAfterDrain?: () => Promise<void>;
}) {
  let coordinator: RecordCaptureCoordinator | undefined;
  const nativeBindings = await createRecordNativeBindings({ ...options.nativeOptions,
    requiredPermissionIds: [...options.nativeOptions.requiredPermissionIds],
    config: { ...options.nativeOptions.config },
    resolveHandoff: identity => coordinator ? coordinator.resolveHandoff(identity) : Promise.resolve(null),
  });
  try {
    coordinator = await createStandardRecordCaptureCoordinator(options.coordinatorOptions);
    const bindingOptions = {
      coordinator,
      nativeBindings,
      shutdownOtherRuntimeUsers: options.shutdownOtherRuntimeUsers,
      closeEngine: options.closeEngine,
      ...(options.releaseRecoveryPeersAfterDrain
        ? { releaseRecoveryPeersAfterDrain: options.releaseRecoveryPeersAfterDrain } : {}),
    };
    return bindRecordCoordinatorHost(bindingOptions);
  } catch (cause) {
    // A coordinator may have inspected or recovered persisted native work during
    // construction. Preserve its exact handle and config lifetime; cleanup is not
    // automatically safe merely because provider construction did not finish.
    throw new RecordHostSetupError(cause, nativeBindings, coordinator);
  }
}
