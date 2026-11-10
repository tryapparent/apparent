import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureRequest, type Receipt, type View} from '../src/lifecycle.ts';

const id = '0123456789abcdef0123456789abcdef';
function fixture(receipts: Receipt[]) {
  const calls: string[] = [];
  let view: View = {phase: 'confirm'};
  const take = (name: string) => { calls.push(name); const value = receipts.shift(); if (!value) throw Error('unexpected call'); return Promise.resolve(value); };
  const request = createCaptureRequest(id, {
    prepare: async () => { calls.push('prepare'); }, start: () => take('start'), inspect: () => take('inspect'), handoff: () => take('handoff'),
    wait: async () => { calls.push('wait'); }, publish: state => { view = state; },
  });
  return {request, calls, view: () => view};
}

test('one admitted request observes native state and publishes only its exact saved handoff', async () => {
  const f = fixture([{capture_id:id,status:'starting',error:'timeout'}, {capture_id:id,status:'recording'}, {capture_id:id,status:'saved'}, {capture_id:id,source:'/owned.apparent'}]);
  const result = await f.request.run();
  assert.deepEqual(result, {phase:'saved',source:'/owned.apparent'});
  assert.deepEqual(f.calls, ['prepare','start','inspect','wait','inspect','handoff']);
  assert.equal((await f.request.run()).phase, 'saved');
  assert.equal(f.calls.filter(call => call === 'start').length, 1);
});

test('occupied or mismatched native admission never starts another request', async () => {
  const f = fixture([{capture_id:'other',error:'occupied'}]);
  assert.equal((await f.request.run()).phase, 'error');
  assert.deepEqual(f.calls, ['prepare','start']);
});

test('native cancellation ends without requesting a handoff', async () => {
  const f = fixture([{capture_id:id,status:'starting'}, {capture_id:id,status:'cancelled'}]);
  assert.deepEqual(await f.request.run(), {phase:'cancelled'});
  assert.ok(!f.calls.includes('handoff'));
});

test('unusable or unrelated saved references are not published', async () => {
  for (const source of ['', 'relative.apparent', '/private/path\n.apparent', 'x'.repeat(4097)]) {
    const f = fixture([{capture_id:id,status:'saved'}, {capture_id:id,source}]);
    assert.equal((await f.request.run()).phase, 'error');
  }
});
