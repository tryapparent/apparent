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

test('real GitHub unallocated timestamp placeholders are queue time, never runner execution', () => {
  // Sanitized REST shape observed during the full review: a queued job already
  // has started_at == created_at, runner_id:0, no steps, and no completed_at.
  const job = {id: 8, name: 'synthetic Mac', status: 'queued', conclusion: null, runner_id: 0,
    created_at: '2026-11-15T00:00:10Z', started_at: '2026-11-15T00:00:10Z', completed_at: null, steps: []};
  const run = {runId: 7, attempt: 1, headSha: 'a'.repeat(40), jobs: [job]};
  const inspect = (value: any) => inspectJobs([{...run, jobs:[value]}],Date.parse(from),Date.parse(to));
  const queued = inspect(job).jobs[0];
  assert.equal(queued.queueSeconds,21590);
  assert.equal(queued.runnerSeconds,0);
  const cancelled = inspect({...job,status:'completed',conclusion:'cancelled',completed_at:'2026-11-15T00:00:30Z'}).jobs[0];
  assert.equal(cancelled.queueSeconds,20);
  assert.equal(cancelled.runnerSeconds,0);
  assert.equal(inspect({...job,runner_id:42,status:'in_progress',completed_at:'0001-01-01T00:00:00Z'}).unfinishedJobs,1);
  const {runner_id: _absent, ...withoutAllocation} = job;
  assert.equal(inspect({...withoutAllocation,status:'completed',conclusion:'cancelled',completed_at:'2026-11-15T00:00:30Z'}).unknownAllocationJobs,1);
});

test('explicit server-transported human answers remain review references while notices and inherited copies do not', () => {
  // Shape from t3_thread_read, not inferred from question/answer text. The
  // server creates the answer item after the person submits the UI request.
  const answer = {itemId:'turn-item:message:async-answer%3Aruntime-request%3Aprovider%3Acodex%3Asynthetic',
    position:1,updatedAt:from,createdBy:'user',creationSource:'server',type:'user_message',
    visibility:'local',sourceThreadId:'owner',text:'private question and actual human answer'};
  const snapshot = {thread:{threadId:'owner'},hasMore:false,items:[answer,
    {...answer,itemId:'turn-item:message:background-completion'},
    {...answer,itemId:answer.itemId+'-agent',createdBy:'agent'},
    {...answer,itemId:answer.itemId+'-inherited',visibility:'inherited'}]};
  const report = inspectThreads([snapshot,snapshot],Date.parse(from),Date.parse(to));
  assert.equal(report.humanMessageRefs.length,1);
  assert.equal(report.humanMessageRefs[0].itemId,answer.itemId);
  assert.equal(report.humanMessageRefs[0].origin,'explicit-async-answer');
  assert.ok(!JSON.stringify(report).includes('private question'));
});

// Sanitized real REST responses: run 43823181821 /attempts/{1,2}/jobs,
// collected with pagination (total_count checked). Keep execution/step identities.
const carriedRuns = JSON.parse(readFileSync(new URL('./carried-jobs.fixture.json', import.meta.url), 'utf8'));
const jobFrom = Date.parse('2026-11-16T07:20:00Z'), jobTo = Date.parse('2026-11-16T07:30:00Z');
test('producer carried completion is terminal and attributes execution once to the original attempt', () => {
  const partial = inspectJobs([carriedRuns[1]], jobFrom, jobTo);
  assert.equal(partial.unfinishedJobs, 0);
  assert.equal(partial.jobs.length, 1);
  assert.equal(partial.jobs[0].runnerSeconds, null);
  assert.equal(partial.jobs[0].queueSeconds, null);
  assert.equal(partial.jobs[0].provenance, 'unknown-prior-execution');
  for (const runs of [carriedRuns, [...carriedRuns].reverse(), [...carriedRuns, ...carriedRuns]]) {
    const result = inspectJobs(runs, jobFrom, jobTo);
    assert.equal(result.unfinishedJobs, 0);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].id, '43823181821:1:133150747097');
    assert.equal(result.jobs[0].runnerSeconds, 29);
    assert.equal(result.jobs[0].queueSeconds, 2);
  }
  assert.equal(inspectJobs(carriedRuns, Date.parse('2026-11-16T07:21:00Z'), jobTo).jobs[0].runnerSeconds, 18);
  assert.equal(inspectJobs(carriedRuns, Date.parse('2026-11-16T07:25:00Z'), jobTo).jobs.length, 0);
});

test('carried provenance requires a unique matching earlier execution, never just the name', () => {
  const [original, carried] = structuredClone(carriedRuns);
  const inspect = (runs: any[]) => inspectJobs(runs, jobFrom, jobTo);
  const change = (patch: any) => ({...original, jobs: [{...original.jobs[0], ...patch}]});
  for (const candidate of [
    {...original, runId: 99}, {...original, headSha: 'f'.repeat(40)},
    change({runner_id: 123}), change({name: 'contracts (matrix)'}),
    change({steps: []}), change({steps: original.jobs[0].steps.map((s: any) => ({...s, completed_at: s.started_at}))}),
  ]) assert.equal(inspect([candidate, carried]).jobs.find(j => j.attempt === 2).runnerSeconds, null);
  const ambiguous = {...original, jobs: [...original.jobs, {...original.jobs[0], id: 100}]};
  assert.equal(inspect([ambiguous, carried]).jobs.find(j => j.attempt === 2).runnerSeconds, null);
  // A genuinely new same-name execution has normal creation chronology.
  const rerun = {...carried, jobs: [{...carried.jobs[0], created_at: original.jobs[0].created_at}]};
  assert.equal(inspect([original, rerun]).jobs.length, 2);
  const matrix = change({id: 200, name: 'contracts (matrix)'});
  assert.equal(inspect([original, matrix, carried]).jobs.length, 2);
});

test('terminal missing clocks stay unknown while active and unallocated semantics survive', () => {
  const original = carriedRuns[0];
  for (const conclusion of ['success', 'failure', 'cancelled']) {
    for (const completed_at of [null, 'invalid', '0001-01-01T00:00:00Z']) {
      const result = inspectJobs([{...original, jobs: [{...original.jobs[0], conclusion, completed_at}]}], jobFrom, jobTo);
      assert.equal(result.unfinishedJobs, 0);
      assert.equal(result.jobs[0].runnerSeconds, null);
    }
  }
  const active = {...original.jobs[0], status:'in_progress', conclusion:null, completed_at:null};
  assert.equal(inspectJobs([{...original, jobs:[active]}], jobFrom, jobTo).unfinishedJobs, 1);
});

test('missing and zero-date execution starts cannot create elapsed work', () => {
  const original = carriedRuns[0];
  for (const started_at of [null, 'invalid', '0001-01-01T00:00:00Z']) {
    const result = inspectJobs([{...original, jobs:[{...original.jobs[0], started_at}]}], jobFrom, jobTo);
    assert.equal(result.unfinishedJobs, 0);
    assert.equal(result.jobs[0].runnerSeconds, null);
    assert.equal(result.jobs[0].queueSeconds, null);
  }
});

test('CI analysis separates three-hour allocation waits, runner execution and step costs at the cutoff',()=>{
  const start=Date.parse('2026-11-17T06:00:00Z'),end=Date.parse('2026-11-17T10:00:00Z');
  const a=(hour:string)=>`2026-11-17T${hour}:00:00Z`;
  const r=inspectJobs([{databaseId:123,attempt:1,headSha:'a'.repeat(40),jobs:[
    {id:10,name:'native Mac',status:'queued',conclusion:null,created_at:a('05'),started_at:a('05'),runner_id:0,labels:['macos-15-intel'],steps:[]},
    {id:11,name:'Linux verification',status:'completed',conclusion:'success',created_at:a('06'),started_at:a('07'),completed_at:a('09'),runner_id:4,labels:['ubuntu-latest'],steps:[
      {number:1,name:'Install dependencies',status:'completed',started_at:a('07'),completed_at:a('08'),conclusion:'success'},
      {number:2,name:'Build and test',status:'completed',started_at:a('08'),completed_at:a('09'),conclusion:'success'}]},
    {id:12,name:'running build',status:'in_progress',conclusion:null,created_at:a('08'),started_at:a('09'),runner_id:5,steps:[{number:1,name:'Compile',status:'in_progress',started_at:a('09'),completed_at:null}]}
  ]}],start,end);
  assert.equal(r.analysis.longestWaitingJobs[0].id,'123:1:10');
  assert.equal(r.analysis.longestWaitingJobs[0].queueAgeSeconds,18000);
  assert.equal(r.analysis.longestWaitingJobs[0].queueSeconds,14400);
  assert.equal(r.analysis.longestWaitingJobs[0].runnerSeconds,0);
  assert.match(r.analysis.longestWaitingJobs[0].waitReason,/requires provider evidence/);
  assert.equal(r.analysis.longestSteps[0].seconds,3600);
  assert.equal(r.analysis.longestSteps.find(s=>s.name==='Compile').complete,false);
  assert.equal(r.analysis.runningJobs[0].executionAgeSeconds,3600);
  assert.equal(r.analysis.queueByRunner[0].totalSeconds,14400);
  const html=chart({census:{window:{from:a('06'),to:a('10')},categories:[]},processGroups:[]});
  assert.ok(html.includes('Tool envelopes'));
});

test('report makes CI coverage gaps and unresolved action attribution explicit',async()=>{
  const {markdown}=await import('./format.ts');
  const data={census:{window:{from,to},categories:[],actionRanking:{envelopes:{clock:'tool-envelope',candidate:{label:'test build',count:2,meanSeconds:5,totalSeconds:10},largestObserved:{label:'mixed',count:1,meanSeconds:50,totalSeconds:50},winnerEstablished:false,unresolvedSeconds:50,ranked:[],limitation:'unknown attribution'}}},processGroups:[]};
  const text=markdown(data);
  assert.match(text,/Largest observed operation group: mixed/);
  assert.match(text,/Overall winner unresolved/);
  assert.match(text,/CI coverage missing/);
  assert.match(text,/2 × 5s = 10s/);
});

test('queued workflows with zero job rows retain pre-job admission waits rather than disappearing',async()=>{
  const r=inspectJobs([{databaseId:99,attempt:2,headSha:'a'.repeat(40),name:'Queued workflow',status:'queued',createdAt:'2026-11-15T00:00:00Z',jobs:[]}],Date.parse('2026-11-15T02:00:00Z'),Date.parse('2026-11-15T06:00:00Z'));
  assert.equal(r.analysis.preJobWaits[0].ageSeconds,21600);
  assert.equal(r.analysis.preJobWaits[0].windowSeconds,14400);
  assert.equal(r.analysis.coverage.runs,1);
  assert.equal(r.analysis.queueByRunner.length,0,'no invented job/runner queue');
  assert.match(r.analysis.preJobWaits[0].reason,/admission/);
  const {markdown}=await import('./format.ts');
  const text=markdown({census:{window:{from,to},categories:[]},processGroups:[],jobs:r});
  assert.match(text,/CI pre-job admission.*1 × 14400s = 14400s/);
});
