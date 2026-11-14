// Desktop owns the Agents preference workflow. Native only reads/writes the
// persisted experiment through the shared config transaction.
export const skillCommand = 'bunx skills add https://github.com/tryapparent/apparent/tree/main/capture/agent/skills/apparent';
export type PreferenceFacts = { saved: boolean | null; error?: never } | { error: 'config_read_failed' | 'config_write_failed'; saved?: never };
export function preferenceEnabled(facts: PreferenceFacts): boolean | undefined {
  return facts.error ? undefined : facts.saved ?? true;
}
export function preferenceFacts(value: unknown): PreferenceFacts {
  if (!value || typeof value !== 'object') throw Error('Invalid Agents preference');
  const facts = value as Record<string, unknown>;
  if (facts.error === 'config_read_failed' || facts.error === 'config_write_failed') return {error: facts.error};
  if (facts.saved === null || typeof facts.saved === 'boolean') return {saved: facts.saved};
  throw Error('Invalid Agents preference');
}

// Private parent-pipe requests have bounded IDs/deadlines. A timeout has an
// uncertain outcome: read again rather than claiming a saved value.
export class AgentsPreferences {
  private next = 0;
  private pending = new Map<number, {resolve: (facts: PreferenceFacts) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  private send: (message: object) => void;
  constructor(send: (message: object) => void) { this.send = send; }
  request(enabled?: unknown): Promise<PreferenceFacts> {
    if (enabled !== undefined && typeof enabled !== 'boolean') return Promise.reject(Error('Invalid preference'));
    if (this.pending.size) return Promise.reject(Error('Preference request pending'));
    const request = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(request); reject(Error('Preference acknowledgement timed out')); }, 3500);
      this.pending.set(request, {resolve, reject, timer});
      try { this.send({action: 'agents-preference', request, ...(enabled === undefined ? {} : {enabled})}); }
      catch { clearTimeout(timer); this.pending.delete(request); reject(Error('Preference unavailable')); }
    });
  }
  receive(value: {request?: unknown; facts?: unknown}) {
    if (typeof value.request !== 'number') return;
    const pending = this.pending.get(value.request);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(value.request);
    try { pending.resolve(preferenceFacts(value.facts)); }
    catch { pending.reject(Error('Invalid preference acknowledgement')); }
  }
  close() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('Settings closed')); }
    this.pending.clear();
  }
}
