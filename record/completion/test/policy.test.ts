import {test} from 'node:test';
import assert from 'node:assert/strict';
import {begin, reduce as reduceWithAdmission} from '../src/policy.ts';
import type {Context, CopyPolicy, Event, State} from '../src/policy.ts';
import { run } from '../../../shared/enablement/bend/toolchain.ts';
import { bendScratch } from '../../../shared/enablement/bend/build.ts';
import { buildAdmission } from '../../enablement/ci/bend/build.ts';

const modes: ReturnType<CopyPolicy['copy_mode']>[] = await bendScratch(async (directory) => {
  await buildAdmission(directory);
  return JSON.parse(run(process.execPath, ['--input-type=module', '-e', `
    import admission from "./copy-admission.mjs";
    console.log(JSON.stringify(Array.from({length: 8}, (_, mask) =>
      admission.copy_mode(...[1, 2, 4].map(bit => Boolean(mask & bit))))));
  `], directory));
});
const policy: CopyPolicy = {
  may_copy: (saved, current, connected) => saved && current && connected,
  copy_mode: (...facts) => modes[facts.reduce((mask, fact, index) => mask | (Number(fact) << index), 0)],
};
const reduce = (state: State, event: Event) => reduceWithAdmission(state, event, policy);
const capture = {generation: '9007199254740993', captureId: 'capture-a', requestId: 'request-a'};
const context: Context = {capture, platform:'linux', source:'screen', agentRequested:false,
  autoPasteEnabled:false, lab:false, pasteTargetAvailable:true};
const saved: Event = {type:'finalized',capture,outcome:{kind:'saved',bundlePath:'/synthetic/a.apparent'}};
const copied: Event = {type:'clipboard',capture,result:'copied'};

test('only a successful publication requests copy; only the actual receipt says copied', () => {
  const decision = reduce(begin(context,true),saved);
  assert.deepEqual(decision.effects,[{type:'copy',capture,mode:'bundle'}]);
  assert.equal(decision.state.status,'Saved');
  assert.equal(decision.state.observation?.clipboard,'notRequested');
  const done = reduce(decision.state,copied);
  assert.equal(done.state.status,'Saved · copied');
  assert.equal(done.state.observation?.clipboard,'copied');
  assert.deepEqual(done.effects,[]);
  assert.deepEqual(reduce(done.state,saved),{state:done.state,effects:[]});
  assert.deepEqual(reduce(done.state,{...copied,result:'failed'}),{state:done.state,effects:[]});
});
test('clipboard failure retains the exact saved artifact and offers manual access', () => {
  const state = reduce(reduce(begin(context,true),saved).state,{type:'clipboard',capture,result:'failed'}).state;
  assert.deepEqual(state.observation?.outcome,saved.outcome);
  assert.equal(state.status,'Saved · open bundle (copy failed)');
});
test('saved image warnings preserve finalized facts without implying decoder or capture failure', () => {
  const warning = 'Some captured-ink stills have no settled post-stroke sample. Full stroke metadata is retained; inspect recording.mp4 for the recorded appearance.';
  const withWarning = {...context, imageQualityWarning: warning};
  const decision = reduce(begin(withWarning,true),saved);
  assert.equal(decision.state.status,'Saved');
  assert.equal(decision.state.observation?.clipboard,'notRequested');
  assert.deepEqual(decision.state.notifications,[{title:'Capture image quality warning',body:warning}]);
  assert.deepEqual(decision.effects,[{type:'copy',capture,mode:'bundle'}]);
  const copiedState = reduce(decision.state,copied).state;
  assert.equal(copiedState.status,'Saved · copied');
  assert.deepEqual(copiedState.notifications,decision.state.notifications);
  const manual = reduce(reduce(begin({...withWarning,autoPasteEnabled:true},true),saved).state,copied);
  assert.deepEqual(manual.state.notifications[0],decision.state.notifications[0]);
  assert.equal(manual.state.notifications.length,1);
  for (const state of [begin(withWarning,false), begin({...withWarning,platform:'macos'},true),
    reduce(begin(withWarning,true),{type:'disconnect'}).state]) {
    assert.deepEqual(reduce(state,saved).state.notifications,[]);
  }
  assert.deepEqual(reduce(begin(withWarning,true),{type:'finalized',capture,outcome:{kind:'failed',message:'publication failed'}}).state.notifications,[]);
});
test('finalization failures never copy or become saved', () => {
  for(const message of ['publication failed','No screen frames were captured (privacy gate)']) {
    const decision = reduce(begin(context,true),{type:'finalized',capture,outcome:{kind:'failed',message}});
    assert.deepEqual(decision.effects,[]);
    assert.equal(decision.state.observation?.outcome.kind,'failed');
    assert.equal(decision.state.observation?.clipboard,'notRequested');
    assert.match(decision.state.status!,/^Capture failed/);
    assert.deepEqual(reduce(decision.state,copied),{state:decision.state,effects:[]});
    assert.deepEqual(reduce(decision.state,saved),{state:decision.state,effects:[]});
  }
});
for(const type of ['dismiss','cancel','revoke'] as const) {
  test(`${type} retains terminal receipt facts but cannot copy or update a consumer`,()=>{
    const decision = reduce(reduce(begin(context,true),{type}).state,saved);
    assert.deepEqual(decision.effects,[]);
    assert.deepEqual(decision.state.observation,{capture,outcome:saved.outcome,clipboard:'notRequested',current:false});
    const inFlight = reduce(reduce(begin(context,true),saved).state,{type});
    assert.deepEqual(reduce(inFlight.state,copied),{state:inFlight.state,effects:[]});
  });
}
test('out-of-order results and new generations cannot overwrite the current capture',()=>{
  const newer = begin({...context,capture:{...capture,generation:'9007199254740994'}},true);
  assert.deepEqual(reduce(newer,saved),{state:newer,effects:[]});
  for(const wrong of [{...capture,captureId:'b'},{...capture,requestId:'b'}]) {
    assert.deepEqual(reduce(begin(context,true),{...saved,capture:wrong}).effects,[]);
  }
  assert.equal(reduce(begin(context,false),saved).state.observation?.current,false);
  assert.deepEqual(reduce(begin(context,true),copied).effects,[]);
  assert.equal(reduce(begin(context,true),copied).state.observation,null);
});
test('disconnect/reconnect replays facts without repeating a potentially completed copy',()=>{
  const inFlight = reduce(begin(context,true),saved).state;
  const lost = reduce(inFlight,{type:'disconnect'}).state;
  const restored = reduce(lost,{type:'reconnect'});
  assert.deepEqual(restored.effects,[]);
  assert.equal(restored.state.status,'Saved');
  assert.deepEqual(reduce(restored.state,saved).effects,[]);
  assert.deepEqual(reduce(restored.state,copied).effects,[]);
  const disconnected = reduce(begin(context,true),{type:'disconnect'}).state;
  assert.deepEqual(reduce(disconnected,saved).effects,[]);
});
test('auto paste only dispatches a draft to an available target on both platforms', () => {
  for (const platform of ['linux', 'macos'] as const) {
    const enabled = {...context, platform, autoPasteEnabled:true};
    const started = reduce(begin(enabled,true),saved);
    assert.deepEqual(started.effects,[{type:'copy',capture,mode:'autoPasteDraft'}]);
    assert.equal(reduce(started.state,copied).state.status, 'Saved · paste dispatched');
    const stopped = reduce(started.state,{...copied,result:'failed'});
    assert.equal(stopped.state.status, 'Saved · auto paste stopped');
    assert.match(stopped.state.notifications.at(-1)!.body,/Check your composer before retrying/);
    assert.deepEqual(reduce(stopped.state,{type:'reconnect'}).effects,[]);
    for (const restriction of [
      {agentRequested:true}, {source:'phone'} as const, {lab:true},
      {pasteTargetAvailable:false}, {autoPasteEnabled:false},
    ]) {
      assert.deepEqual(reduce(begin({...enabled,...restriction},true),saved).effects,[{type:'copy',capture,mode:'bundle'}]);
    }
    assert.deepEqual(reduce(begin(enabled,false),saved).effects,[]);
  }
});
