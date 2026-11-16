import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureRequest, type Receipt} from '../src/lifecycle.ts';
const id = '0123456789abcdef0123456789abcdef';
function fixture(receipts: Receipt[]) {
  const calls: string[] = [];
  const take = (name: string) => { calls.push(name); const value = receipts.shift(); if (!value) throw Error('unexpected call'); return Promise.resolve(value); };
  const request = createCaptureRequest(id, {
    prepare: async () => { calls.push('prepare'); }, start: () => take('start'), inspect: () => take('inspect'), handoff: () => take('handoff'),
    wait: async () => { calls.push('wait'); }, publish: () => {},
  });
  return {request, calls};
}
test('one admitted request publishes only its exact saved handoff', async () => {
  const f = fixture([{capture_id:id,status:'starting',error:'timeout'}, {capture_id:id,status:'recording'}, {capture_id:id,status:'saved'}, {capture_id:id,bundle_path:'/owned.apparent',remote_source:'cccccccccccccccccccccccccccccccc'}]);
  assert.deepEqual(await f.request.run(), {phase:'saved',bundlePath:'/owned.apparent',remoteSource:'cccccccccccccccccccccccccccccccc'});
  assert.deepEqual(f.calls, ['prepare','start','inspect','wait','inspect','handoff']);
  assert.equal((await f.request.run()).phase, 'saved');
  assert.equal(f.calls.filter(call => call === 'start').length, 1);
});
test('occupied or mismatched admission never starts another request', async () => {
  for (const receipt of [{capture_id:'other'}, {capture_id:id,error:'occupied'}]) {
    const f = fixture([receipt]);
    assert.equal((await f.request.run()).phase, 'error');
    assert.deepEqual(f.calls, ['prepare','start']);
  }
});
test('native cancellation ends without reading a handoff', async () => {
  const f = fixture([{capture_id:id,status:'starting'}, {capture_id:id,status:'cancelled'}]);
  assert.deepEqual(await f.request.run(), {phase:'cancelled'});
  assert.ok(!f.calls.includes('handoff'));
});
test('unusable or unassociated saved bundle facts are rejected', async () => {
  for (const facts of [
    ...['', 'relative.apparent', '/private/path\n.apparent', '/' + 'x'.repeat(4096) + '.apparent'].map(bundle_path => ({bundle_path,remote_source:null})),
    ...['/private/guess.apparent', 'A'.repeat(32)].map(remote_source => ({bundle_path:'/owned.apparent',remote_source})),
  ]) {
    const f = fixture([{capture_id:id,status:'starting'}, {capture_id:id,status:'saved'}, {capture_id:id,...facts}]);
    assert.deepEqual(await f.request.run(), {phase:'error',message:'Recording has no usable handoff'});
    assert.deepEqual(f.calls, ['prepare','start','inspect','handoff']);
  }
});
