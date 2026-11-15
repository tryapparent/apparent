import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {categories, validateDecision, dispatchPlan} from './policy.ts';
import type {Decision, Finding} from './policy.ts';
import * as state from './state.ts';
import {inspectThreads, inspectJobs} from './snapshots.ts';
import {chart} from './format.ts';
const from = '2026-11-15T00:00:00Z', to = '2026-11-15T06:00:00Z';
function finding(): Finding {return {key: 'real-contract-mismatch', category: 'confusion-maintainability',
  observation: 'A producer reply exceeded the consumer bound', consequence: 'The real CLI refused a valid batch',
  hypothesis: 'Small fixtures hid full-page response size', alternatives: 'Provider corruption must be ruled out',
  intervention: 'Use the real full batch in the owning contract test', verification: 'Replay original CLI input, keep finite bound',
  evidence: [{ref: 'private-source:42', at: from}], confidence: 'supported', scopePaths: ['capture/agent/media'],
  owner: {status: 'none', evidenceRef: 'supported-thread-audit:all-pages'}, holds: []};}
function decision(f = finding()): Decision {return {window: {from, to}, examined: [...categories], findings: [f], auditRef: 'private-audit:12'};}
function fixture(run: (dir: string, file: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'apparent-dev-review-'));
  try {run(dir, join(dir, 'state.json'));} finally {rmSync(dir, {recursive: true, force: true});}
}
test('all lenses require original evidence; cost is count × time, code smells alone do not authorize dispatch', () => {
  const f = finding(); f.category = 'time-eater'; f.timing = {kind: 'tool-envelope', count: 20, meanSeconds: 3, totalSeconds: 60};
  validateDecision(decision(f)); f.timing.totalSeconds = 600;
  assert.throws(() => validateDecision(decision(f)), /count × mean/);
  f.timing.totalSeconds = 60; f.confidence = 'hypothesis';
  assert.equal(dispatchPlan(decision(f), false, []).action, 'none');
  f.evidence[0].at = '2026-11-14T00:00:00Z';
  assert.throws(() => validateDecision(decision(f)), /Historical/);
  assert.throws(() => validateDecision({...decision(), examined: ['time-eater']}), /four lenses/);
});
test('human relays require facts available before the prompt; judgment and genuine holds are preserved', () => {
  const f = finding(); f.category = 'human-dependency';
  f.human = {judgment: 'not-required', promptAt: from, availableInformation: []};
  assert.throws(() => validateDecision(decision(f)), /before the human/);
  f.human.availableInformation = [{ref: 'already-completed-result:1', at: to}];
  assert.throws(() => validateDecision(decision(f)), /before the human/);
  f.human.availableInformation[0].at = from;
  assert.equal(dispatchPlan(decision(f), false, []).action, 'new-thread');
  f.human.judgment = 'required'; assert.equal(dispatchPlan(decision(f), false, []).action, 'none');
  f.human.judgment = 'not-required'; f.holds = ['explicit user pause'];
  assert.equal(dispatchPlan(decision(f), false, []).action, 'none');
});
test('ownership prevents a second writer; active improvement and historical dispatch keys suppress duplicates', () => {
  const f = finding(); f.owner = {status: 'active', threadId: 'existing', evidenceRef: 'read:latest-run'};
  assert.equal(dispatchPlan(decision(f), false, []).action, 'existing-owner');
  assert.equal(dispatchPlan(decision(f), true, []).action, 'wait');
  assert.equal(dispatchPlan(decision(f), false, [f.key]).action, 'none');
  f.owner.status = 'unknown'; assert.equal(dispatchPlan(decision(f), false, []).action, 'none');
});
test('checkpoint commits only successful exact-window reviews, even while dispatch is unfinished', () => fixture((_dir, file) => {
  state.initialize(file, 'github.com/tryapparent/apparent:thread', from);
  state.begin(file, 'r1', to); assert.throws(() => state.begin(file, 'r2', to), /Another review/);
  assert.throws(() => state.commit(file, 'r1', {...decision(), window: {from, to: from}}));
  assert.equal(state.readState(file).cutoff, from);
  state.commit(file, 'r1', decision()); const intent = state.prepare(file, finding().key);
  assert.deepEqual(state.prepare(file, finding().key), intent, 'lost launch reply reuses the same request ID');
  assert.throws(() => state.prepare(file, 'other'), /already owns/);
  state.begin(file, 'r2', '2026-11-15T12:00:00Z');
  state.commit(file, 'r2', {window: {from: to, to: '2026-11-15T12:00:00Z'}, examined: [...categories], findings: [], auditRef: 'audit:idle'});
  assert.equal(state.plan(file).action, 'wait');
  state.recordDispatch(file, intent.requestId, {threadId: 'owner', link: '<t3-thread://v2/env/owner>', route: 'owner through PR watch and exact-main foreground wait'});
  assert.throws(() => state.delivered(file, intent.requestId, {mergeSha: 'a'.repeat(40), checksRef: '', outcomeRef: 'merge only', benefit: 'unmeasured'}));
  state.delivered(file, intent.requestId, {mergeSha: 'a'.repeat(40), checksRef: 'exact-main-run:passed', outcomeRef: 'publication:verified', benefit: 'unmeasured'});
  assert.equal(state.readState(file).history[0].benefit, 'unmeasured');
  assert.equal(state.readState(file).inFlight, null);
  state.benefit(file, finding().key, {reference: 'later-use:verified', comparableConditionsRef: 'same-inputs-and-host:1',
    before: {kind: 'runner-execution', count: 2, meanSeconds: 10, totalSeconds: 20},
    after: {kind: 'runner-execution', count: 2, meanSeconds: 11, totalSeconds: 22}});
  assert.equal(state.readState(file).history[0].benefit, 'measured', 'negative results remain measurements, not fabricated savings');
  assert.throws(() => state.benefit(file, 'unshipped', {reference: 'r', comparableConditionsRef: 'c',
    before: {kind: 'runner-execution', count: 1, meanSeconds: 1, totalSeconds: 1},
    after: {kind: 'runner-queue', count: 1, meanSeconds: 1, totalSeconds: 1}}), /same measured clock/);
}));

test('transport receipt cannot replace the reserved request identity or owner', () => fixture((_dir, file) => {
  state.initialize(file, 'repo:thread', from); state.begin(file, 'r', to); state.commit(file, 'r', decision());
  const intent = state.prepare(file, finding().key);
  state.recordDispatch(file, intent.requestId, {threadId: 'owner', link: '<t3-thread://v2/env/owner>', route: 'owner callback',
    ...{requestId: 'other', key: 'other'}});
  assert.equal(state.readState(file).inFlight?.requestId, intent.requestId);
  assert.equal(state.readState(file).inFlight?.key, finding().key);
  assert.throws(() => state.recordDispatch(file, intent.requestId, {threadId: 'replacement', link: '<t3-thread://v2/env/replacement>', route: 'r'}), /existing owner/);
}));
test('unknown locks and other review ownership are never cleared by a new run', () => fixture((_dir, file) => {
  state.initialize(file, 'repo:thread', from); mkdirSync(file + '.lock');
  assert.throws(() => state.begin(file, 'r', to), /EEXIST/); rmdirSync(file + '.lock');
  state.begin(file, 'r', to); assert.throws(() => state.abort(file, 'another'), /exact recorded/);
  state.abort(file, 'r'); assert.equal(state.readState(file).cutoff, from);
}));
test('supported snapshots distinguish real UI messages, unknown wait verdicts, pagination and runner queue identity', () => {
  const item = {itemId: 'human', position: 0, updatedAt: from, createdBy: 'user', creationSource: 'mobile', text: 'private message'};
  const snapshot = {thread: {threadId: 'owner', status: 'completed', pendingRequestCount: 0}, hasMore: false,
    items: [item, {...item, itemId: 'automatic', creationSource: 'server'}, {...item, itemId: 'wait', position: 2, createdBy: 'agent', text: 'Waiting for native proof'}]};
  const report = inspectThreads([snapshot, snapshot, null], Date.parse(from), Date.parse(to));
  assert.equal(report.humanMessageRefs.length, 1); assert.equal(report.waitCandidateRefs.length, 1);
  assert.equal(report.invalidSnapshots, 1); assert.ok(!JSON.stringify(report).includes('private message'));
  assert.equal(inspectThreads([{...snapshot, items: [{...item, position: 7}]}], 0, Date.parse(to)).threads[0].hasRequestStart, false);
  const run = {databaseId: 1, attempt: 2, headSha: 'a'.repeat(40), jobs: [{databaseId: 5, name: 'Mac',
    createdAt: '2026-11-15T00:00:00Z', startedAt: '2026-11-15T00:01:00Z', completedAt: '2026-11-15T00:03:00Z', conclusion: 'success'}]};
  const jobs = inspectJobs([run, run], Date.parse(from), Date.parse(to)).jobs;
  assert.equal(jobs.length, 1); assert.equal(jobs[0].queueSeconds, 60); assert.equal(jobs[0].runnerSeconds, 120);
  const later = {...run, jobs: [{...run.jobs[0], startedAt: '2026-11-15T06:01:00Z', completedAt: '2026-11-15T06:03:00Z'}]};
  const queueOnly = inspectJobs([later], Date.parse(from), Date.parse(to)).jobs[0];
  assert.equal(queueOnly.queueSeconds, 21600); assert.equal(queueOnly.runnerSeconds, 0);
});
test('actual CLI collects array-shaped tool results, ranks totals, and excludes private commands from artifacts', () => fixture((dir) => {
  const source = join(dir, 'rollout.jsonl'), output = join(dir, 'aggregate.json');
  const row = (seconds: number, payload: object) => JSON.stringify({type: 'response_item', timestamp: new Date(Date.parse(from) + seconds * 1000).toISOString(), payload});
  writeFileSync(source, [JSON.stringify({type: 'session_meta', payload: {id: 's', cwd: '/test-project'}}),
    row(1, {type: 'custom_tool_call', call_id: 'a', name: 'exec', input: 'cargo test private-credential'}),
    row(3, {type: 'custom_tool_call_output', call_id: 'a', output: [{type: 'input_text', text: 'done'}]})].join('\n'));
  const result = spawnSync(process.execPath, ['--experimental-strip-types', 'enablement/timing/review/index.ts', 'collect',
    '--input', source, '--workspace', '/test-project', '--from', from, '--to', to, '--out', output], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr); const text = readFileSync(output, 'utf8');
  assert.ok(!text.includes('private-credential')); const aggregate = JSON.parse(text);
  assert.deepEqual(aggregate.census.categories[0].arithmetic, {count: 1, meanSeconds: 2, totalSeconds: 2});
  const hostile = {...aggregate, processGroups: [{label: '<script>bad()</script>', count: 1, meanSeconds: 2, totalSeconds: 2}]};
  assert.ok(!chart(hostile).includes('<script>bad()'));
  hostile.processGroups[0].count = -1; assert.throws(() => chart(hostile), /Invalid measured/);
}));
