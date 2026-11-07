import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecordFixture } from '@apparent/record/fixtures';
import { bindSilentRecordControls } from '../../src/record/omarchy/controls.ts';

function fixture() {
  const f = createRecordFixture();
  f.driver.publish({ ...f.driver.current(), revision: f.driver.current().revision + 1, captures: [],
    readiness: { requirements: [] } });
  let visible = false;
  let activation: (() => void) | undefined;
  let closed = 0;
  let closeChecks = 0;
  let hideWorks = true;
  const host = bindSilentRecordControls({ host: { record: f.client,
    async canClose() { closeChecks++; return true; }, async close() { closed++; } },
    window: { hide() { if (hideWorks) visible = false; }, isVisible: () => visible, show() { visible = true; } },
    stopControl: { onActivate(listener) { activation = listener; return () => { activation = undefined; }; }, dispose() {} },
    createRequestId: () => 'tray-stop',
  });
  const publish = (phase: 'starting' | 'recording' | 'processing' | 'saved' | 'unknown' | 'cancelled') => {
    const snapshot = f.driver.current();
    f.driver.publish({ ...snapshot, revision: snapshot.revision + 1,
      captures: [{ captureId: 'capture-one', invocationId: 'start-one', phase, outcomes: [], delivery: 'unknown' }] });
  };
  return { ...f, host, publish, activate: () => activation?.(), visible: () => visible,
    breakHide() { hideWorks = false; }, counts: () => ({ closed, closeChecks }),
    start() { const s = f.driver.current(); return host.record.execute({ type: 'start-capture', requestId: 'start-one',
      expected: { providerEpoch: s.providerEpoch, revision: s.revision }, delivery: 'host-default' }); },
  };
}

test('hides before Start and uses exact current capture/revision for one tray Stop', async () => {
  const f = fixture();
  assert.equal(f.visible(), true);
  await f.start();
  assert.equal(f.visible(), false);
  // Renderer disconnect cannot remove the main-process Stop observation.
  f.host.record.detach();
  f.publish('recording');
  assert.equal(await f.host.canClose(), false);
  assert.equal(f.counts().closeChecks, 0);
  const expected = f.driver.current();
  f.activate(); f.activate();
  await new Promise(resolve => setImmediate(resolve));
  const stop = f.driver.commands().filter(c => c.type === 'stop-capture');
  assert.equal(stop.length, 1);
  assert.deepEqual(stop[0], { type: 'stop-capture', captureId: 'capture-one', requestId: 'tray-stop',
    expected: { providerEpoch: expected.providerEpoch, revision: expected.revision } });
  f.publish('processing');
  assert.equal(f.visible(), true);
  f.publish('saved');
  assert.equal(await f.host.canClose(), true);
  await f.host.close();
  assert.equal(f.counts().closed, 1);
});

test('cannot start when controls fail to hide; no native dispatch', async () => {
  const f = fixture(); f.breakHide();
  assert.equal((await f.start()).status, 'refused');
  assert.equal(f.driver.commands().length, 0);
});

test('unknown Start remains hidden and close refuses; tray inspection never retries Start', async () => {
  const f = fixture(); f.driver.setNextResult('outcome-unknown');
  await f.start();
  assert.equal(f.visible(), false);
  assert.equal(await f.host.canClose(), false);
  f.publish('unknown'); f.activate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.driver.commands().filter(c => c.type === 'start-capture').length, 1);
  assert.equal(f.driver.commands().at(-1)?.type, 'inspect-capture');
  assert.equal(f.visible(), false);
});

test('tray Cancel remains available for known starting capture while Start is awaiting its result', async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const execute = f.client.execute.bind(f.client);
  f.client.execute = async command => {
    const result = await execute(command);
    if (command.type === 'start-capture') await pending;
    return result;
  };
  const start = f.start();
  f.publish('starting');
  f.activate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.driver.commands().at(-1)?.type, 'cancel-capture');
  assert.equal(await f.host.canClose(), false, 'admitted Start must still settle');
  f.publish('cancelled'); release(); await start;
  assert.equal(f.visible(), true);
  assert.equal(f.driver.current().captures.some(capture => capture.phase === 'saved'), false);
});
