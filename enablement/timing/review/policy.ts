// Review decisions are evidence-backed proposals, never execution/admission authority.
import assert from 'node:assert/strict';

export const categories = ['human-dependency', 'time-eater', 'confusion-maintainability', 'feedback-gap'] as const;
export type Category = typeof categories[number];
export type Evidence = {ref: string; at: string};
export type Timing = {kind: 'tool-envelope' | 'observed-process-span' | 'runner-execution' | 'runner-queue'; count: number; meanSeconds: number; totalSeconds: number};
export type Finding = {
  key: string; category: Category; observation: string; consequence: string;
  hypothesis: string; alternatives: string; intervention: string; verification: string;
  evidence: Evidence[]; confidence: 'supported' | 'hypothesis'; scopePaths: string[];
  owner: {status: 'none' | 'active' | 'waiting' | 'unknown'; evidenceRef: string; threadId?: string};
  holds: string[];
  timing?: Timing;
  human?: {judgment: 'required' | 'not-required' | 'unknown'; promptAt: string; availableInformation: Evidence[]};
};
export type Decision = {window: {from: string; to: string}; examined: Category[]; findings: Finding[]; auditRef: string};
export const isoTime = (s: unknown): number => {
  assert.equal(typeof s, 'string', 'Expected an ISO timestamp');
  assert.match(s as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/, 'Expected an explicit UTC ISO timestamp');
  const t = Date.parse(s as string); assert.ok(Number.isFinite(t), 'Invalid timestamp');
  assert.equal(new Date(t).toISOString().slice(0, 19), (s as string).slice(0, 19), 'Invalid calendar date'); return t;
};
const text = (s: unknown) => assert.ok(typeof s === 'string' && s.trim().length > 0 && s.length <= 4000, 'Missing or excessive evidence text');
function evidence(e: Evidence) {text(e?.ref); isoTime(e?.at);}
export function validateTiming(t: Timing) {
  assert.ok(['tool-envelope', 'observed-process-span', 'runner-execution', 'runner-queue'].includes(t?.kind), 'Name the measured clock, not implied CPU/critical-path cost');
  const {count, meanSeconds, totalSeconds} = t;
  assert.ok(Number.isInteger(count) && count > 0 && Number.isFinite(meanSeconds) && meanSeconds >= 0 && Number.isFinite(totalSeconds), 'Invalid measured timing');
  assert.ok(Math.abs(count * meanSeconds - totalSeconds) < 1e-6, 'Timing must be count × mean = total');
}

export function validateDecision(value: unknown): asserts value is Decision {
  const d = value as Decision;
  const from = isoTime(d?.window?.from), to = isoTime(d?.window?.to);
  assert.ok(from < to, 'Empty or reversed review window');
  assert.ok(Array.isArray(d.examined) && categories.every(c => d.examined.includes(c)), 'Examine all four lenses, even on idle reviews');
  text(d.auditRef);
  assert.ok(Array.isArray(d.findings) && d.findings.length <= 3, 'At most three combined findings');
  const keys = new Set<string>();
  for (const f of d.findings) {
    assert.match(f.key, /^[a-z0-9][a-z0-9-]{0,95}$/);
    assert.ok(!keys.has(f.key), 'Duplicate finding'); keys.add(f.key);
    assert.ok(categories.includes(f.category), 'Unknown finding category');
    for (const key of ['observation', 'consequence', 'hypothesis', 'alternatives', 'intervention', 'verification'] as const) text(f[key]);
    assert.ok(Array.isArray(f.evidence) && f.evidence.length > 0 && f.evidence.length <= 20, 'Source evidence required');
    f.evidence.forEach(evidence);
    assert.ok(f.evidence.some(e => isoTime(e.at) >= from && isoTime(e.at) <= to), 'Historical context is not a new incident');
    assert.ok(['supported', 'hypothesis'].includes(f.confidence), 'Unknown confidence');
    assert.ok(Array.isArray(f.scopePaths) && f.scopePaths.length > 0 && f.scopePaths.length <= 20, 'Name a bounded owning scope');
    assert.ok(f.scopePaths.every(p => typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.split('/').includes('..')), 'Scope paths must stay repository-relative');
    assert.ok(['none', 'active', 'waiting', 'unknown'].includes(f.owner?.status), 'Owner audit required');
    text(f.owner.evidenceRef);
    if (['active', 'waiting'].includes(f.owner.status)) text(f.owner.threadId);
    assert.ok(Array.isArray(f.holds) && f.holds.every(h => typeof h === 'string'), 'Explicit holds inventory required');
    if (f.category === 'time-eater') assert.ok(f.timing, 'Time eaters need measured count and time');
    if (f.timing) validateTiming(f.timing);
    if (f.category === 'human-dependency') {
      assert.ok(f.human && ['required', 'not-required', 'unknown'].includes(f.human.judgment), 'Classify the human contribution explicitly');
      const prompt = isoTime(f.human.promptAt);
      assert.ok(Array.isArray(f.human.availableInformation), 'Available information inventory required');
      f.human.availableInformation.forEach(evidence);
      if (f.human.judgment === 'not-required') assert.ok(f.human.availableInformation.length > 0 &&
        f.human.availableInformation.every(e => isoTime(e.at) <= prompt), 'Show information available before the human prompt');
    }
  }
}

export function dispatchPlan(d: Decision, occupied: boolean, previousKeys: string[]) {
  validateDecision(d);
  if (occupied) return {action: 'wait', reason: 'Existing improvement retains its owner and completion route'};
  for (const f of d.findings) {
    if (previousKeys.includes(f.key) || f.holds.length || f.confidence !== 'supported' || f.owner.status === 'unknown') continue;
    if (f.category === 'human-dependency' && f.human?.judgment !== 'not-required') continue;
    return {action: f.owner.status === 'none' ? 'new-thread' : 'existing-owner', key: f.key, ownerThreadId: f.owner.threadId,
      reason: 'Supported evidence; bounded intervention; no declared hold. Transport still requires live owner/authority reconciliation.'};
  }
  return {action: 'none', reason: 'No new supported, unheld, unowned/reusable intervention'};
}
