import {
  createStandardRecordCaptureCoordinator,
  type RecordCaptureCoordinator,
  type StandardRecordCaptureCoordinatorOptions,
} from '@apparent/record/host/capture2-coordinator';
import { preflightCapturePublication } from '@apparent/engine-sdk/capture';
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
  // Snapshot records before native config setup yields. SDKs and policy callbacks
  // are capabilities: preserve their identities rather than cloning implementations.
  const coordinatorOptions = { ...options.coordinator, standardProcessing: structuredClone(options.coordinator.standardProcessing),
    preflight: preflightCapturePublication };
  const shutdownOtherRuntimeUsers = options.shutdownOtherRuntimeUsers;
  const closeEngine = options.closeEngine;
  let coordinator: RecordCaptureCoordinator | undefined;
  const nativeBindings = await createRecordNativeBindings({ ...options.native,
    requiredPermissionIds: [...options.native.requiredPermissionIds], config: { ...options.native.config },
    resolveHandoff: identity => coordinator ? coordinator.resolveHandoff(identity) : Promise.resolve(null),
  });
  try {
    coordinator = await createStandardRecordCaptureCoordinator(coordinatorOptions);
    return bindRecordCoordinatorHost({ coordinator, nativeBindings, shutdownOtherRuntimeUsers, closeEngine });
  } catch (cause) {
    // A coordinator may have inspected or recovered persisted native work during
    // construction. Preserve its exact handle and config lifetime; cleanup is not
    // automatically safe merely because provider construction did not finish.
    throw new RecordHostSetupError(cause, nativeBindings, coordinator);
  }
}
