import { randomUUID } from 'node:crypto';
import type { CapabilitySnapshot, RecordClient, RecordCommand, CommandResult } from '@apparent/record/capabilities';
import type { RecordHostServices } from '../host.ts';

export interface SilentRecordWindow {
  hide(): void;
  isVisible(): boolean;
  show(): void;
}

/** Main-process controls only. Tray activation requests Stop; it never toggles Start.
 * Availability and physical activation still require packaged compositor proof. */
export function bindSilentRecordControls(options: {
  host: RecordHostServices;
  window: SilentRecordWindow;
  stopControl: { onActivate(listener: () => void): () => void; dispose(): void };
  createRequestId?: () => string;
  reportError?: (error: unknown) => void;
}): RecordHostServices {
  const { host, window, stopControl } = options;
  const requestId = options.createRequestId ?? randomUUID;
  let current: CapabilitySnapshot | undefined;
  let preparingStart = false;
  let uncertainStart: string | undefined;
  let stopping = false;
  let closed = false;
  const rendererObservers = new Set<() => void>();
  const active = () => current?.captures.filter(c => ['starting', 'recording', 'unknown'].includes(c.phase)) ?? [];
  const present = () => {
    if (closed) return;
    const correlated = uncertainStart && current?.captures.find(c => c.captureId === uncertainStart || c.invocationId === uncertainStart);
    if (correlated && !['starting', 'unknown'].includes(correlated.phase)) uncertainStart = undefined;
    if (preparingStart || uncertainStart || !current || current.connection !== 'connected' || active().length) window.hide();
    else window.show();
  };
  // The caller creates this window hidden. Observe recovery before any show.
  window.hide();
  const unsubscribe = host.record.observe(snapshot => { current = snapshot; present(); });
  const removeActivation = stopControl.onActivate(() => {
    if (closed || stopping || !current) return;
    const captures = active();
    // Ambiguous ownership is never resolved by choosing an arbitrary capture.
    if (captures.length !== 1) return;
    const capture = captures[0];
    const command: RecordCommand = { type: capture.phase === 'starting' ? 'cancel-capture'
      : capture.phase === 'recording' ? 'stop-capture' : 'inspect-capture',
      captureId: capture.captureId, requestId: requestId(),
      expected: { providerEpoch: current.providerEpoch, revision: current.revision } };
    stopping = true;
    void host.record.execute(command).catch(error => options.reportError?.(error)).finally(() => { stopping = false; });
  });
  const record: RecordClient = {
    observe(listener) {
      const unsubscribe = host.record.observe(listener);
      const remove = () => { unsubscribe(); rendererObservers.delete(remove); };
      rendererObservers.add(remove);
      return remove;
    },
    detach() { for (const remove of rendererObservers) remove(); },
    async execute(command): Promise<CommandResult> {
      if (command.type !== 'start-capture') return host.record.execute(command);
      if (preparingStart || uncertainStart || active().length || closed) {
        if (!current) throw new Error('Record observation unavailable');
        return { status: 'refused', requestId: command.requestId, reason: 'Capture ownership unresolved', snapshot: current };
      }
      preparingStart = true;
      window.hide();
      try {
        if (window.isVisible()) {
          if (!current) throw new Error('Record observation unavailable');
          return { status: 'refused', requestId: command.requestId, reason: 'Recording controls could not hide', snapshot: current };
        }
        uncertainStart = command.requestId;
        const result = await host.record.execute(command);
        if (result.status === 'refused' || result.status === 'cancelled') uncertainStart = undefined;
        return result;
      } finally { preparingStart = false; present(); }
    },
  };
  return { record,
    canClose: () => preparingStart || stopping || uncertainStart || active().length
      ? Promise.resolve(false) : host.canClose(),
    async close() {
      await host.close();
      closed = true;
      record.detach();
      removeActivation(); unsubscribe(); stopControl.dispose();
    },
  };
}
