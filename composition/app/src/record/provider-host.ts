import { randomUUID } from 'node:crypto';
import {
  createRecordCapabilityProvider,
  type RecordCapabilityProviderOptions,
  type RecordClient,
} from '@apparent/record/capabilities';
import type { RecordCaptureCoordinator, RecordCaptureCoordinatorShutdownReport } from '@apparent/record/host/capture2-coordinator';
import type { RecordHostServices } from './host.ts';
import type { RecordNativeBindings } from './native-bindings.ts';
import { recordShutdownEvent, shutdownReportDiagnostic } from './omarchy/shutdown-diagnostic.ts';

type Runtime = RecordCapabilityProviderOptions['runtime'];
export interface RecordProviderHostOptions {
  /** Exclusive command/observation ownership transfers to this host on success. */
  runtime: Runtime;
  capture2Start?: RecordCapabilityProviderOptions['capture2Start'];
  /** Authenticated Record output facts; omission remains unavailable. */
  captureFacts?: RecordCapabilityProviderOptions['captureFacts'];
  /** Only this exact coordinator may supply terminal scope-specific clearance. */
  coordinator?: RecordCaptureCoordinator;
  /** Seal other SDK/runtime users' admission and drain their work; never infer clear from missing facts. */
  shutdownOtherRuntimeUsers?(): Promise<'clear' | 'unresolved' | 'unknown'>;
  /** Local recovery-connection release only, after exact coordinator and external-user drain. */
  releaseRecoveryPeersAfterDrain?(): Promise<void>;
  nativeBindings: RecordNativeBindings;
  /** Releases only this host's Engine resources after clearance. Must be idempotent; failure is not clearance. */
  closeEngine(): Promise<void>;
}

type Phase = 'open' | 'draining' | 'inspecting' | 'ownership-retained' | 'admitted-close' | 'provider-detached' | 'engine-closed' | 'closed' | 'cleanup-unknown';
const unresolved = new Set(['starting', 'recording', 'processing', 'unknown']);
export interface RecordProviderHost extends RecordHostServices {
  /** Trusted-main diagnostics only; this is not a renderer capability or retry instruction. */
  shutdownReport(): RecordCaptureCoordinatorShutdownReport | undefined;
}

/** Trusted main-process assembly of the real Record provider, with one admission/close boundary. */
export function createRecordProviderHost(options: RecordProviderHostOptions): RecordProviderHost {
  if (!options?.runtime || typeof options.runtime.unresolvedOwnership !== 'function'
    || !options.nativeBindings || typeof options.nativeBindings.close !== 'function'
    || typeof options.closeEngine !== 'function') throw new TypeError('Invalid Record provider host options');
  const runtime = options.runtime;
  const bindings = options.nativeBindings;
  const closeEngine = options.closeEngine;
  const captureFacts = options.captureFacts;
  const coordinator = options.coordinator;
  const shutdownOtherRuntimeUsers = options.shutdownOtherRuntimeUsers;
  const releaseRecoveryPeersAfterDrain = options.releaseRecoveryPeersAfterDrain;
  if (releaseRecoveryPeersAfterDrain !== undefined
    && (!coordinator || typeof releaseRecoveryPeersAfterDrain !== 'function')) {
    throw new TypeError('Recovery release requires an exact coordinator drain');
  }
  if (coordinator && (runtime !== coordinator.runtime || options.capture2Start !== coordinator.capture2Start
    || captureFacts !== coordinator.captureFacts || typeof coordinator.shutdown !== 'function'
    || typeof coordinator.dispose !== 'function' || typeof coordinator.createProvider !== 'function'
    || typeof shutdownOtherRuntimeUsers !== 'function')) {
    throw new TypeError('Coordinator clearance must cover the exact injected ports and all other runtime users');
  }
  if (!!bindings.clipboard === !!bindings.clipboardTextReadback) throw new TypeError('Choose one exact clipboard proof contract');
  const ports = { native: bindings.native, penConfig: bindings.penConfig, providerEpoch: randomUUID(),
    ...(bindings.clipboardTextReadback ? { clipboardTextReadback: bindings.clipboardTextReadback } : { clipboard: bindings.clipboard }) };
  const provider = coordinator ? coordinator.createProvider(ports)
    : createRecordCapabilityProvider({ runtime, capture2Start: options.capture2Start, captureFacts, ...ports });
  let phase: Phase = 'open';
  let commands = 0;
  let closing: Promise<void> | undefined;
  let inspecting: Promise<boolean> | undefined;
  let shutdownReport: RecordCaptureCoordinatorShutdownReport | undefined;
  const commandDrain = new Set<() => void>();
  let subscriptions: Set<() => void> | undefined = new Set();
  const currentPhase = (): Phase => phase;

  const record: RecordClient = {
    observe(listener) {
      if (!subscriptions) throw new Error('Record client is detached');
      const removeProvider = provider.observe(listener);
      if (!subscriptions) { removeProvider(); return () => {}; }
      const remove = () => { removeProvider(); subscriptions?.delete(remove); };
      subscriptions.add(remove);
      return remove;
    },
    async execute(command) {
      if (!subscriptions || phase !== 'open') return { status: 'refused', requestId: command.requestId,
        reason: 'Record host is closing', snapshot: provider.current() };
      commands++;
      try { return await provider.execute(command); }
      finally {
        commands--;
        if (!commands) { for (const done of commandDrain) done(); commandDrain.clear(); }
      }
    },
    // UI detach is observation-only. The bridge owns its individual unsubscribe.
    // Provider/runtime disposal belongs exclusively to the cleared host shutdown.
    detach() {
      const previous = subscriptions;
      subscriptions = undefined;
      for (const remove of previous ?? []) remove();
    },
  };

  const coordinatorCanClose = (): Promise<boolean> => {
    if (inspecting) return inspecting;
    if (phase === 'ownership-retained' || phase === 'cleanup-unknown') return Promise.resolve(false);
    if (phase !== 'open') return Promise.resolve(true);
    // Seal this host first. Already admitted native commands retain their results;
    // later renderer commands cannot enter while either scope is inspected.
    phase = 'draining';
    recordShutdownEvent('command-drain', { phase, commands });
    const inspect = async () => {
      if (commands) await new Promise<void>(resolve => commandDrain.add(resolve));
      try {
        // A later materials-ready observation can leave startup ownership cached
        // from the earlier stopping reply. Refresh through the owner port while
        // commands are sealed; Saved facts alone cannot clear that ownership.
        recordShutdownEvent('capture-reconciliation-start', { phase });
        await runtime.reconcileStartup();
        recordShutdownEvent('capture-reconciliation-complete', { phase });
        const facts = await captureFacts!.readFacts();
        const admission = facts?.nextShortcutAdmission;
        const ownership = runtime.unresolvedOwnership();
        const current = provider.current();
        recordShutdownEvent('coordinator-preflight', { phase, ownership: ownership && {
          storageUnavailable: ownership.storageUnavailable, reconciliation: ownership.reconciliation,
          unresolvedRequests: Array.isArray(ownership.requestIds) ? ownership.requestIds.length : null },
          captureFactsAvailable: !!facts, factPhases: facts?.captures?.map(capture => capture.phase),
          shortcutAdmission: admission?.state, providerPhases: current.captures.map(capture => capture.phase),
          providerShortcutAdmission: current.nextShortcutAdmission.state });
        // Keep Stop/Cancel available for known active or unreadable captures.
        // This preflight is nonterminal; unavailable reservation facts are not clearance.
        if (!facts || facts.version !== 1 || !Array.isArray(facts.captures)
          || !['unavailable', 'idle', 'consumed', 'cancelled', 'expired'].includes(admission?.state)
          || facts.captures.some(capture => !['saved', 'cancelled', 'failed'].includes(capture.phase))
          || (admission.state === 'consumed'
            && !facts.captures.some(capture => capture.captureId === admission.captureId))
          || !ownership || ownership.storageUnavailable !== false || ownership.reconciliation !== 'complete'
          || !Array.isArray(ownership.requestIds) || ownership.requestIds.length
          || current.captures.some(capture => unresolved.has(capture.phase))
          || current.nextShortcutAdmission.state === 'armed') {
          phase = 'open'; recordShutdownEvent('preflight-refused', { phase }); return false;
        }
      } catch { phase = 'open'; recordShutdownEvent('preflight-unreadable', { phase }); return false; }
      phase = 'inspecting';
      try {
        let other: 'clear' | 'unresolved' | 'unknown' = 'unknown';
        try { other = await shutdownOtherRuntimeUsers!(); } catch { /* Unknown retains shared SDK ownership. */ }
        recordShutdownEvent('coordinator-shutdown-start', { phase, otherRuntimeUsers: other });
        const report = structuredClone(await coordinator!.shutdown());
        shutdownReport = report;
        recordShutdownEvent('coordinator-shutdown-report', { report: shutdownReportDiagnostic(report) });
        await coordinator!.dispose();
        recordShutdownEvent('coordinator-disposed', { phase });
        const localDrain = report?.scope === 'record-coordinator'
          && report.admission === 'closed' && report.localDrain === 'complete';
        if (other === 'clear' && localDrain && releaseRecoveryPeersAfterDrain) {
          // Releasing a separately launched recovery connection does not cancel
          // native work or establish runtime clearance. Keep the original report.
          await releaseRecoveryPeersAfterDrain();
        }
        const clear = other === 'clear' && report?.scope === 'record-coordinator'
          && report.admission === 'closed' && report.localDrain === 'complete' && report.runtimeClearance === 'clear'
          && report.nextShortcutAdmission?.state === 'unsupported'
          && typeof report.nextShortcutAdmission.reason === 'string' && report.nextShortcutAdmission.reason.length > 0
          && Array.isArray(report.work) && report.work.length === 0;
        phase = clear ? 'admitted-close' : 'ownership-retained';
        recordShutdownEvent('coordinator-close-decision', { phase, clear });
        return clear;
      } catch { phase = 'ownership-retained'; recordShutdownEvent('coordinator-shutdown-failed', { phase }); return false; }
    };
    inspecting = inspect().finally(() => { inspecting = undefined; });
    return inspecting;
  };

  const canClose = async (): Promise<boolean> => {
    if (coordinator) return coordinatorCanClose();
    if (phase === 'cleanup-unknown') return false;
    if (phase !== 'open') return true;
    if (commands) return false;
    try {
      // The provider refreshes asynchronously, including at construction. Its
      // current renderer snapshot cannot clear ownership not yet read from the
      // authoritative output/reservation source. Missing producer is distinct
      // from a configured producer whose current facts are unavailable.
      if (captureFacts) {
        const facts = await captureFacts.readFacts();
        if (!facts || facts.version !== 1 || !Array.isArray(facts.captures)
          || !['idle', 'consumed', 'cancelled', 'expired'].includes(facts.nextShortcutAdmission?.state)
          || facts.captures.some(capture => !['saved', 'cancelled', 'failed'].includes(capture.phase))) return false;
        const admission = facts.nextShortcutAdmission;
        if (admission.state === 'consumed'
          && !facts.captures.some(capture => capture.captureId === admission.captureId)) return false;
      }
      // A renderer command may have entered while the authoritative read awaited.
      if (commands || currentPhase() === 'cleanup-unknown') return false;
      if (currentPhase() !== 'open') return true;
      const report = runtime.unresolvedOwnership();
      if (!report || report.storageUnavailable !== false || report.reconciliation !== 'complete'
        || !Array.isArray(report.requestIds) || report.requestIds.length) return false;
      const current = provider.current();
      if (current.captures.some(capture => unresolved.has(capture.phase))
        || current.nextShortcutAdmission.state === 'armed') return false;
    } catch { return false; }
    // No await between the final report and closing admission. Commands already
    // queued through this host count above; later calls cannot reach the provider.
    phase = 'admitted-close';
    return true;
  };

  return {
    record,
    canClose,
    shutdownReport: () => shutdownReport && structuredClone(shutdownReport),
    async close() {
      if (phase === 'closed') return;
      if (phase === 'ownership-retained') throw new Error('Record shutdown retains unresolved runtime ownership');
      if (phase === 'cleanup-unknown') throw new Error('Record cleanup ownership remains unknown');
      if ((phase === 'open' || phase === 'draining' || phase === 'inspecting') && !await canClose()) {
        throw new Error('Record ownership remains unresolved');
      }
      if (closing) return closing;
      const cleanup = async () => {
        if (phase === 'admitted-close') {
          try { record.detach(); provider.detach(); phase = 'provider-detached'; }
          catch (error) { phase = 'cleanup-unknown'; throw error; }
        }
        if (phase === 'provider-detached') {
          recordShutdownEvent('engine-close-start', { phase });
          await closeEngine(); phase = 'engine-closed'; recordShutdownEvent('engine-close-complete', { phase });
        }
        if (phase === 'engine-closed') {
          recordShutdownEvent('bindings-close-start', { phase });
          await bindings.close(); phase = 'closed'; recordShutdownEvent('bindings-close-complete', { phase });
        }
      };
      closing = cleanup();
      try { await closing; }
      finally { closing = undefined; }
    },
  };
}
