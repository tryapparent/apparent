// Small private bookkeeping only. This is not a CI/native/release evidence store.
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {isoTime, validateDecision, dispatchPlan, validateTiming} from './policy.ts';
import type {Decision, Timing} from './policy.ts';

export type State = {
  version: 1; scope: string; cutoff: string;
  activeReview: {id: string; from: string; to: string} | null;
  decision: Decision | null;
  inFlight: {key: string; requestId: string; action: string; threadId?: string; link?: string; route?: string} | null;
  history: Array<{key: string; threadId?: string; outcomeRef: string; benefit: 'measured' | 'unmeasured'; measurement?: Measurement}>;
};
type Measurement = {reference: string; comparableConditionsRef: string; before: Timing; after: Timing};
export function readState(file: string): State {
  const info = lstatSync(file);
  assert.ok(!info.isSymbolicLink() && info.isFile() && (info.mode & 0o077) === 0 && info.uid === process.getuid!(), 'State must be a private owned regular file');
  const s = JSON.parse(readFileSync(file, 'utf8')) as State;
  assert.ok(s?.version === 1 && typeof s.scope === 'string' && s.scope.length > 0 && Array.isArray(s.history), 'Unsupported state');
  assert.ok(['activeReview', 'decision', 'inFlight'].every(key => Object.hasOwn(s, key)), 'Missing lifecycle state');
  if (s.decision !== null) validateDecision(s.decision);
  isoTime(s.cutoff); return s;
}
function transaction<T>(file: string, action: (s: State | null) => {state: State; result: T}): T {
  const lock = file + '.lock'; mkdirSync(lock, {mode: 0o700}); // Existing locks are never stolen.
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    const {state, result} = action(existsSync(file) ? readState(file) : null);
    writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    renameSync(temporary, file); return result;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    rmdirSync(lock);
  }
}
export function initialize(file: string, scope: string, since: string) {
  isoTime(since); assert.ok(scope.trim());
  return transaction(file, old => {
    assert.equal(old, null, 'Existing checkpoint must be reconciled, not overwritten');
    const state: State = {version: 1, scope, cutoff: since, activeReview: null, decision: null, inFlight: null, history: []};
    return {state, result: state};
  });
}
export function begin(file: string, runId: string, end: string) {
  isoTime(end); assert.ok(runId.trim());
  return transaction(file, state => {
    assert.ok(state, 'Initialize a scoped checkpoint first');
    if (state.activeReview) {
      assert.equal(state.activeReview.id, runId, 'Another review owns this interval');
      assert.equal(state.activeReview.to, end, 'Resume the same frozen cutoff');
    } else {
      assert.ok(isoTime(state.cutoff) < isoTime(end), 'No new review interval');
      state.activeReview = {id: runId, from: state.cutoff, to: end};
    }
    return {state, result: state.activeReview};
  });
}
export function commit(file: string, runId: string, decision: unknown) {
  validateDecision(decision);
  return transaction(file, state => {
    assert.ok(state?.activeReview && state.activeReview.id === runId, 'Review ownership mismatch');
    assert.equal(isoTime(decision.window.from), isoTime(state.activeReview.from));
    assert.equal(isoTime(decision.window.to), isoTime(state.activeReview.to));
    state.cutoff = state.activeReview.to; state.activeReview = null; state.decision = decision;
    return {state, result: {cutoff: state.cutoff}};
  });
}
export function abort(file: string, runId: string) {
  return transaction(file, state => {
    assert.ok(state?.activeReview?.id === runId, 'Can only release the exact recorded review');
    state.activeReview = null; return {state, result: {cutoff: state.cutoff}};
  });
}
export function plan(file: string) {
  const s = readState(file); assert.ok(s.decision, 'A completed review is required');
  return dispatchPlan(s.decision, !!s.inFlight, s.history.map(x => x.key));
}
export function prepare(file: string, key: string) {
  return transaction(file, state => {
    assert.ok(state?.decision && !state.activeReview, 'Complete analysis before reserving dispatch');
    if (state.inFlight) {
      assert.equal(state.inFlight.key, key, 'An improvement already owns the slot');
      return {state, result: state.inFlight};
    }
    const proposal = dispatchPlan(state.decision, false, state.history.map(x => x.key));
    assert.ok(['new-thread', 'existing-owner'].includes(proposal.action) && proposal.key === key, 'Finding is not dispatchable');
    const requestId = 'enablement-' + createHash('sha256').update(state.scope + ':' + key).digest('hex').slice(0, 32);
    state.inFlight = {key, requestId, action: proposal.action, ...(proposal.ownerThreadId ? {threadId: proposal.ownerThreadId} : {})};
    return {state, result: state.inFlight};
  });
}
export function recordDispatch(file: string, requestId: string, receipt: {threadId: string; link: string; route: string}) {
  assert.ok(receipt?.threadId && receipt.link?.startsWith('<t3-thread://') && receipt.route?.trim(), 'Actual owner link and completion route required');
  return transaction(file, state => {
    assert.ok(state?.inFlight?.requestId === requestId, 'Dispatch intent mismatch');
    if (state.inFlight.threadId) assert.equal(state.inFlight.threadId, receipt.threadId, 'Cannot replace the existing owner');
    state.inFlight = {...state.inFlight, threadId: receipt.threadId, link: receipt.link, route: receipt.route};
    return {state, result: state.inFlight};
  });
}
export function delivered(file: string, requestId: string, evidence: {mergeSha: string; checksRef: string; outcomeRef: string; benefit: 'unmeasured'}) {
  assert.match(evidence?.mergeSha, /^[a-f0-9]{40}$/);
  assert.ok(evidence.checksRef?.trim() && evidence.outcomeRef?.trim() && evidence.benefit === 'unmeasured', 'Delivery needs verified outcome and exact-main check references; record later-use measurement with benefit');
  return transaction(file, state => {
    assert.ok(state?.inFlight?.requestId === requestId && state.inFlight.threadId && state.inFlight.route, 'No accepted dispatch receipt');
    state.history = [...state.history, {key: state.inFlight.key, threadId: state.inFlight.threadId,
      outcomeRef: `${evidence.mergeSha} ${evidence.checksRef} ${evidence.outcomeRef}`, benefit: evidence.benefit}];
    state.inFlight = null; return {state, result: {recorded: true}};
  });
}
export function benefit(file: string, key: string, measurement: Measurement) {
  assert.ok(measurement?.reference?.trim() && measurement.comparableConditionsRef?.trim(), 'Later-use evidence and comparable conditions required');
  validateTiming(measurement.before); validateTiming(measurement.after);
  assert.equal(measurement.before.kind, measurement.after.kind, 'Compare the same measured clock');
  return transaction(file, state => {
    assert.ok(state, 'Missing checkpoint'); const entry = state.history.find(x => x.key === key);
    assert.ok(entry, 'Measure a delivered intervention, not an unverified candidate');
    entry.measurement = {reference: measurement.reference, comparableConditionsRef: measurement.comparableConditionsRef,
      before: measurement.before, after: measurement.after}; entry.benefit = 'measured';
    return {state, result: entry};
  });
}
