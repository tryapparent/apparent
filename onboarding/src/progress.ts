/** Owner intent only. The injected native executor performs locked CAS, cancellation,
 * fsync/rename/directory-fsync and merges these leaves without replacing the subtree. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Leaf = { present: false } | { present: true; value: Json };
export const progressKeys = ['tourRevision', 'seen', 'resume', 'shortcutChosen', 'shortcutTestedFor', 'firstCaptureCompleted'] as const;
export type ProgressKey = typeof progressKeys[number];
export type ProgressSnapshot = Readonly<Record<ProgressKey, Leaf>>;
export interface ProgressIntent {
  expected: ProgressSnapshot;
  set: { firstCaptureCompleted: true; seen: true };
  remove: ['resume'];
}
export type WriteResult = 'saved' | 'conflict' | 'cancelled' | 'failed' | 'unknown';
export interface ProgressPort {
  read(signal: AbortSignal): Promise<ProgressSnapshot>;
  commit(intent: ProgressIntent, signal: AbortSignal): Promise<WriteResult>;
}
export type PersistenceState = 'loading' | 'ready' | 'saving' | 'saved' | 'conflict' | 'failed' | 'unknown' | 'closed';

function equal(a: ProgressSnapshot, b: ProgressSnapshot): boolean {
  return progressKeys.every(key => a[key].present === b[key].present
    && (!a[key].present || (b[key].present && JSON.stringify(a[key].value) === JSON.stringify(b[key].value))));
}
function completed(value: ProgressSnapshot): boolean {
  return value.firstCaptureCompleted.present && value.firstCaptureCompleted.value === true
    && value.seen.present && value.seen.value === true && !value.resume.present;
}

/** One practice lifetime. Readback resolves uncertainty; it never silently repeats a write. */
export class PracticeProgress {
  private readonly port: ProgressPort;
  private readonly abort = new AbortController();
  private expected: ProgressSnapshot | null = null;
  private status: PersistenceState = 'loading';
  private operation = 0;
  constructor(port: ProgressPort) { this.port = port; }
  get state(): PersistenceState { return this.status; }

  async load(): Promise<void> {
    if (this.status === 'closed' || this.status === 'saving') return;
    const operation = ++this.operation;
    this.status = 'loading';
    try {
      const snapshot = await this.port.read(this.abort.signal);
      if (!this.current(operation)) return;
      // Capture the baseline once; refreshing after a replay must not authorize this
      // old lesson to overwrite the newer setup's progress.
      if (this.expected && !equal(this.expected, snapshot)) {
        this.status = completed(snapshot) ? 'saved' : 'conflict';
      } else {
        this.expected = structuredClone(snapshot);
        this.status = completed(snapshot) ? 'saved' : 'ready';
      }
    } catch {
      if (this.current(operation)) this.status = 'failed';
    }
  }

  async finish(): Promise<void> {
    if (this.status !== 'ready' || !this.expected) return;
    const operation = ++this.operation;
    this.status = 'saving';
    let result: WriteResult;
    try {
      result = await this.port.commit({ expected: structuredClone(this.expected), set: { firstCaptureCompleted: true, seen: true }, remove: ['resume'] }, this.abort.signal);
    } catch {
      // A transport rejection does not establish whether publication occurred.
      result = 'unknown';
    }
    if (!this.current(operation)) return;
    if (result === 'saved') { this.status = 'saved'; return; }
    this.status = result === 'cancelled' ? 'failed' : result;
    // Failed/unknown transactions require authoritative readback before another
    // human attempt. Keep the outcome visible until that explicit refresh.
  }

  close(): void {
    this.status = 'closed';
    this.operation++;
    this.abort.abort();
  }

  private current(operation: number): boolean {
    return operation === this.operation && !this.abort.signal.aborted;
  }
}
