export type Phase = 'confirm' | 'starting' | 'recording' | 'processing' | 'saved' | 'cancelled' | 'error';
export type Receipt = Readonly<{capture_id?: string; status?: string; source?: string; error?: unknown}>;
export type View = Readonly<{phase: Phase; message?: string; source?: string; code?: 'occupied'}>;
export type Ports = Readonly<{
  prepare(): Promise<void>;
  beforeStart?(): void;
  start(): Promise<Receipt>;
  inspect(): Promise<Receipt>;
  handoff(): Promise<Receipt>;
  wait(): Promise<void>;
  publish(view: View): void;
}>;

function validSource(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\x00-\x1f\x7f]/.test(value)
    && (/^[a-f0-9]{32}$/.test(value) || (value.startsWith('/') && value.endsWith('.apparent')));
}

/** Owns one token-bound capture lifecycle; adapters provide admission, native calls and timing. */
export function createCaptureRequest(requestId: string, ports: Ports) {
  let view: View = {phase: 'confirm'};
  let running = false;
  const read = () => view;
  const set = (next: View) => { view = next; ports.publish(next); };
  const checked = (receipt: Receipt) => {
    if (receipt.capture_id !== requestId || receipt.error) throw new Error('Unable to read this recording. Finish or cancel it in Apparent.');
    return receipt;
  };
  const run = async (): Promise<View> => {
    if (view.phase !== 'confirm' || running) return view;
    running = true;
    set({phase: 'starting'});
    try {
      await ports.prepare();
      ports.beforeStart?.();
      let receipt = await ports.start();
      if (!(receipt.capture_id === requestId && receipt.error === 'timeout')) checked(receipt);
      for (;;) {
        receipt = checked(await ports.inspect());
        if (receipt.status === 'saved') {
          const saved = checked(await ports.handoff());
          if (!validSource(saved.source)) throw new Error('Recording has no usable handoff');
          set({phase: 'saved', source: saved.source});
          break;
        }
        if (receipt.status === 'cancelled') { set({phase: 'cancelled'}); break; }
        if (!['starting', 'recording', 'processing'].includes(receipt.status ?? '')) {
          throw new Error('Recording did not start. Check Apparent’s permissions and active capture.');
        }
        set({phase: receipt.status as 'starting' | 'recording' | 'processing'});
        await ports.wait();
      }
    } catch (error) {
      set({phase: 'error', message: error instanceof Error ? error.message : 'Unable to record'});
    } finally { running = false; }
    return view;
  };
  return {read, run};
}
