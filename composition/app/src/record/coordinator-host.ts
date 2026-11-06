import type { RecordCaptureCoordinator } from '@apparent/record/host/capture2-coordinator';
import type { RecordNativeBindings } from './native-bindings.ts';
import { createRecordProviderHost } from './provider-host.ts';

export interface RecordCoordinatorHostOptions {
  /** Already-constructed public owner coordinator, with explicit processing/source policy. */
  coordinator: RecordCaptureCoordinator;
  /** Must use coordinator.resolveHandoff; composition adds no parallel Saved authority. */
  nativeBindings: RecordNativeBindings;
  /** Closes admission and drains every other user of these SDKs/runtime; exclusive assembly returns clear. */
  shutdownOtherRuntimeUsers(): Promise<'clear' | 'unresolved' | 'unknown'>;
  /** SDK ownership transfers on success; invoked only after coordinator drainage. */
  closeEngine(): Promise<void>;
}

/** Trusted main assembly; does not create captures, select output policy or activate routing. */
export function bindRecordCoordinatorHost(options: RecordCoordinatorHostOptions) {
  const flow = options.coordinator;
  const closeEngine = options.closeEngine;
  if (!flow || typeof flow.dispose !== 'function' || typeof flow.shutdown !== 'function'
    || typeof options.shutdownOtherRuntimeUsers !== 'function' || typeof closeEngine !== 'function') {
    throw new TypeError('Invalid Record coordinator host options');
  }
  const host = createRecordProviderHost({ runtime: flow.runtime, capture2Start: flow.capture2Start,
    captureFacts: flow.captureFacts, nativeBindings: options.nativeBindings, coordinator: flow,
    shutdownOtherRuntimeUsers: options.shutdownOtherRuntimeUsers,
    closeEngine });
  return { ...host,
    processingIssues: () => flow.processingIssues(),
    observeProcessingIssues: (listener: () => void) => flow.observeProcessingIssues(listener),
  };
}
