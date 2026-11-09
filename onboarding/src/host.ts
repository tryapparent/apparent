import { PracticeSession, type PracticeView } from './session.ts';
import { type CaptureIdentity, type CommandContext, type Completion, type Observation, type Scope } from './practice.ts';
import { progressKeys, type ProgressIntent, type ProgressSnapshot, type WriteResult } from './progress.ts';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function identifier(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 160; }
function identity(value: unknown): value is CaptureIdentity {
  return object(value) && identifier(value.generation) && identifier(value.captureId)
    && (value.requestId === null || identifier(value.requestId));
}
function scope(value: unknown): value is Scope { return object(value) && identifier(value.session) && identifier(value.transport); }
function context(value: unknown): value is CommandContext {
  return scope(value) && object(value) && typeof value.attempt === 'string'
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0;
}
function snapshot(value: unknown): value is ProgressSnapshot {
  return object(value) && Object.keys(value).length === progressKeys.length && progressKeys.every(key => {
    const leaf = value[key];
    return object(leaf) && (leaf.present === false && Object.keys(leaf).length === 1
      || leaf.present === true && 'value' in leaf && Object.keys(leaf).length === 2);
  });
}
export interface NativePractice {
  version: 1;
  scope: Scope;
  attempt: string;
  observation: Observation | null;
  completion: Completion | null;
  openedBundle: { sequence: number; bundlePath: string } | null;
}
/** Closed, bounded parent projection. Invalid facts never fall back to a claimed stage. */
export function decodePractice(value: unknown): NativePractice | null {
  if (!object(value) || value.version !== 1 || !scope(value.scope) || !identifier(value.attempt)) return null;
  const fact = value.observation;
  if (fact !== null && (!object(fact) || fact.attempt !== value.attempt
    || !Number.isSafeInteger(fact.sequence) || Number(fact.sequence) < 0
    || !(fact.capture === null || identity(fact.capture))
    || !['selecting', 'recording', 'processing', 'cancelled'].includes(String(fact.phase))
    || typeof fact.boardVisible !== 'boolean' || typeof fact.boardInk !== 'boolean'
    || typeof fact.noteSaved !== 'boolean' || !Number.isSafeInteger(fact.screenInk) || Number(fact.screenInk) < 0)) return null;
  const receipt = value.completion;
  if (receipt !== null && (!object(receipt) || !identity(receipt.capture) || typeof receipt.current !== 'boolean'
    || !['notRequested', 'copied', 'failed'].includes(String(receipt.clipboard)) || !object(receipt.outcome)
    || !(receipt.outcome.kind === 'saved' && typeof receipt.outcome.bundlePath === 'string' && receipt.outcome.bundlePath.length > 0 && receipt.outcome.bundlePath.length <= 8192
      || receipt.outcome.kind === 'failed' && typeof receipt.outcome.message === 'string' && receipt.outcome.message.length <= 512))) return null;
  if (value.openedBundle !== null && (!object(value.openedBundle) || !Number.isSafeInteger(value.openedBundle.sequence)
    || Number(value.openedBundle.sequence) < 1 || typeof value.openedBundle.bundlePath !== 'string' || value.openedBundle.bundlePath.length > 8192)) return null;
  return structuredClone(value) as unknown as NativePractice;
}

export interface HostPorts {
  send(value: unknown): void;
  changed(view: PracticeView): void;
  /** Timers are host mechanics; injection keeps tests deterministic. */
  timeout(callback: () => void): () => void;
}
interface Pending {
  scope: Scope; attempt: string; operation: 'read' | 'commit';
  resolve(value: unknown): void; reject(): void; dispose(): void;
}

/** Electron main owns this host. It exposes commands, never observations, to preload. */
export class PracticeHost {
  private readonly ports: HostPorts;
  private session: PracticeSession | null = null;
  private current: NativePractice | null = null;
  private requestId = 0;
  private pending = new Map<string, Pending>();
  private closed = false;
  private openedSequence = 0;
  constructor(ports: HostPorts) { this.ports = ports; }
  get view(): PracticeView | null { return this.session?.view ?? null; }

  receive(value: unknown): boolean {
    const facts = decodePractice(value);
    if (this.closed || !facts) return false;
    if (!this.current || this.current.scope.session !== facts.scope.session || this.current.scope.transport !== facts.scope.transport) {
      this.session?.close();
      this.rejectPending();
      this.openedSequence = 0;
      this.session = new PracticeSession(facts.scope, {
        progress: {
          read: async signal => {
            const reply = await this.request('read', null, signal);
            if (!snapshot(reply)) throw new Error('Invalid progress readback');
            return reply;
          },
          commit: async (intent, signal) => {
            const reply = await this.request('commit', intent, signal);
            return ['saved', 'conflict', 'cancelled', 'failed', 'unknown'].includes(String(reply)) ? reply as WriteResult : 'unknown';
          },
        },
        closeWhiteboard: capture => this.effect('close-whiteboard', capture),
        finished: (capture, bundlePath) => this.effect('finished', capture, bundlePath),
      });
    }
    if (this.current?.attempt !== facts.attempt) this.openedSequence = 0;
    this.current = facts;
    const session = this.session!;
    void session.begin(facts.attempt).then(() => { if (this.session === session && !this.closed) this.publish(); });
    if (facts.observation) session.observe(facts.observation);
    if (facts.completion) session.complete(facts.completion);
    if (facts.openedBundle && facts.completion && facts.openedBundle.sequence > this.openedSequence) {
      this.openedSequence = facts.openedBundle.sequence;
      session.openedBundle(facts.completion.capture, facts.openedBundle.bundlePath);
    }
    this.publish();
    return true;
  }

  async command(value: unknown): Promise<boolean> {
    if (this.closed || !this.session || !object(value) || Object.keys(value).sort().join(',') !== 'action,context'
      || !['practice-paste', 'practice-pasted', 'practice-locate', 'practice-finish'].includes(String(value.action)) || !context(value.context)) return false;
    const operation = this.session.command(String(value.action), value.context);
    this.publish();
    await operation;
    this.publish();
    return true;
  }

  reply(value: unknown): boolean {
    if (!object(value) || value.type !== 'practice-progress' || !identifier(value.id) || !scope(value.scope)) return false;
    const pending = this.pending.get(value.id);
    if (!pending || value.scope.session !== pending.scope.session || value.scope.transport !== pending.scope.transport || value.attempt !== pending.attempt) return false;
    this.pending.delete(value.id); pending.dispose();
    if (value.error) pending.reject(); else pending.resolve(value.result);
    return true;
  }

  close(): void {
    this.closed = true;
    this.session?.close();
    this.rejectPending();
  }
  private publish(): void { if (!this.closed && this.session) this.ports.changed(this.session.view); }
  private effect(operation: string, capture: CaptureIdentity, bundlePath?: string): void {
    if (!this.current || this.closed) return;
    this.ports.send({ action: 'practice-effect', id: String(++this.requestId), operation, scope: this.current.scope, attempt: this.current.attempt, capture, ...(bundlePath === undefined ? {} : { bundlePath }) });
  }
  private request(operation: 'read' | 'commit', intent: ProgressIntent | null, signal: AbortSignal): Promise<unknown> {
    if (this.closed || !this.current || signal.aborted) return Promise.reject(new Error('Closed practice'));
    const id = String(++this.requestId), { scope, attempt } = this.current;
    return new Promise((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(id); if (!pending) return;
        this.pending.delete(id); pending.dispose(); reject(new Error('Practice request cancelled'));
      };
      const cancelTimeout = this.ports.timeout(abort);
      signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, { scope, attempt, operation, resolve, reject: () => reject(new Error('Practice request failed')),
        dispose: () => { cancelTimeout(); signal.removeEventListener('abort', abort); } });
      try { this.ports.send({ action: 'practice-progress', operation, scope, attempt, id, ...(intent ? { intent } : {}) }); }
      catch { abort(); }
    });
  }
  private rejectPending(): void {
    for (const pending of this.pending.values()) { pending.dispose(); pending.reject(); }
    this.pending.clear();
  }
}
