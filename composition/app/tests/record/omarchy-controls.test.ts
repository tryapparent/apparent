import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecordFixture } from '@apparent/record/fixtures';
import {bindDrawingTray,type DrawingMenuItem} from '../../src/record/omarchy/drawing/tray.ts';
import { bindSilentRecordControls } from '../../src/record/omarchy/controls.ts';

function fixture(identity: { captureId: string; invocationId?: string } = {
  captureId: 'capture-one', invocationId: 'start-one',
}) {
  const f = createRecordFixture();
  f.driver.publish({ ...f.driver.current(), revision: f.driver.current().revision + 1, captures: [],
    readiness: { requirements: [] } });
  let visible = false;
  let activation: (() => void) | undefined;
  let closed = 0;
  let closeChecks = 0;
  let hideWorks = true;
  let focused = 0;
  let destroyed = false;
  let closeResult: boolean | Error = true;
  let holdClose: Promise<void> | undefined;
  const host = bindSilentRecordControls({ host: { record: f.client,
    async canClose() { closeChecks++; await holdClose; if (closeResult instanceof Error) throw closeResult; return closeResult; }, async close() { closed++; } },
    window: { hide() { if (hideWorks) visible = false; }, isVisible: () => visible, show() { visible = true; }, focus() { focused++; }, isDestroyed: () => destroyed },
    stopControl: { onActivate(listener) { activation = listener; return () => { activation = undefined; }; }, dispose() {} },
    createRequestId: () => 'tray-stop',
  });
  const publish = (phase: 'starting' | 'recording' | 'processing' | 'saved' | 'unknown' | 'cancelled') => {
    const snapshot = f.driver.current();
    f.driver.publish({ ...snapshot, revision: snapshot.revision + 1,
      captures: [{ ...identity, phase, outcomes: [], delivery: 'unknown' }] });
  };
  return { ...f, host, publish, activate: () => activation?.(), visible: () => visible,
    breakHide() { hideWorks = false; }, counts: () => ({ closed, closeChecks, focused }),
    hide() { visible = false; }, destroy() { destroyed = true; },
    closeResult(value: boolean | Error, pending?: Promise<void>) { closeResult = value; holdClose = pending; },
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

test('normal entry opens/focuses the existing connected idle surface without recording or clearing Saved', async () => {
  const f = fixture(); f.publish('saved'); const before = f.driver.current(); f.hide();
  assert.equal(f.host.openRecordingEntry(), true);
  assert.equal(f.visible(), true); assert.equal(f.counts().focused, 1);
  assert.equal(f.host.openRecordingEntry(), true);
  assert.equal(f.driver.commands().length, 0); assert.deepEqual(f.driver.current(), before);
  f.destroy(); assert.equal(f.host.openRecordingEntry(), false);
});

test('normal entry cannot expose active, uncertain or disconnected capture controls', async () => {
  for (const phase of ['starting', 'recording', 'unknown'] as const) {
    const f = fixture(); f.publish(phase);
    assert.equal(f.host.openRecordingEntry(), false); assert.equal(f.visible(), false);
    assert.equal(f.counts().focused, 0); assert.equal(f.driver.commands().length, 0);
  }
  const f = fixture(); f.driver.disconnect();
  assert.equal(f.host.openRecordingEntry(), false); assert.equal(f.visible(), false);
  const uncertain = fixture(); uncertain.driver.setNextResult('outcome-unknown'); await uncertain.start();
  assert.equal(uncertain.host.openRecordingEntry(), false); assert.equal(uncertain.visible(), false);
});

test('normal entry is sealed while close checks run, reopens on refusal, and remains sealed after positive/unknown close', async () => {
  const f = fixture(); let release!: () => void;
  f.closeResult(false, new Promise<void>(resolve => { release = resolve; }));
  const pending = f.host.canClose(); assert.equal(f.host.openRecordingEntry(), false);
  release(); assert.equal(await pending, false); assert.equal(f.host.openRecordingEntry(), true);
  f.closeResult(true); assert.equal(await f.host.canClose(), true);
  assert.equal(f.host.openRecordingEntry(), false);
  await f.host.close(); assert.equal(f.host.openRecordingEntry(), false);
  const unknown = fixture(); unknown.closeResult(new Error('unknown native check'));
  await assert.rejects(unknown.host.canClose(), /unknown native check/);
  assert.equal(unknown.host.openRecordingEntry(), false);
});

test('cannot start when controls fail to hide; no native dispatch', async () => {
  const f = fixture(); f.breakHide();
  assert.equal((await f.start()).status, 'refused');
  assert.equal(f.driver.commands().length, 0);
});

test('the public request capture ID restores controls without the native invocation ID', async () => {
  // Record projects receipt.requestId as public CaptureFact.captureId. The
  // separate native invocation ID need not be present in that public snapshot.
  const f = fixture({ captureId: 'start-one' });
  await f.start();
  f.publish('recording');
  assert.equal(f.visible(), false);
  f.publish('processing');
  assert.equal(f.visible(), true);
  f.publish('saved');
  assert.equal(await f.host.canClose(), true);
  assert.equal(f.driver.commands().filter(command => command.type === 'start-capture').length, 1);
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

function trayFixture(){
  const f=fixture();let items:DrawingMenuItem[]=[],notice='',sequence=0;
  const dispose=bindDrawingTray({record:f.host.record,stop:f.activate,menu(value){items=value;},notice(value){notice=value;},createRequestId:()=>`cancel-${++sequence}`});
  return{...f,dispose,item:(name:string)=>items.find(i=>i.label===name)!,notice:()=>notice};
}
const settle=()=>new Promise<void>(r=>setImmediate(r));
test('hidden active recording has fixed accessible Cancel using exact public identity/revision and independent Stop',async()=>{
 const f=trayFixture();f.publish('recording');const observed=f.driver.current();
 assert.equal(f.visible(),false);assert.equal(f.item('Cancel recording').enabled,true);
 f.item('Cancel recording').click();f.item('Cancel recording').click();await settle();
 const cancels=f.driver.commands().filter(c=>c.type==='cancel-capture');assert.equal(cancels.length,1);
 assert.deepEqual(cancels[0],{type:'cancel-capture',captureId:'capture-one',requestId:'cancel-1',expected:{providerEpoch:observed.providerEpoch,revision:observed.revision}});
 assert.equal(f.item('Cancel recording').enabled,false);assert.match(f.notice(),/requested; awaiting recording status/);assert.equal(f.visible(),false,'accepted command is not observed cancellation');
 f.item('Stop recording').click();await settle();assert.equal(f.driver.commands().filter(c=>c.type==='stop-capture').length,1,'waiting Cancel never blocks existing physical Stop');
 f.publish('cancelled');assert.equal(f.visible(),true);assert.equal(f.notice(),'Apparent — recording cancelled');assert.equal(f.item('Recording cancelled').enabled,false);assert.equal(f.item('Cancel recording').enabled,false);f.dispose();
});
test('stale menu capture/revision cannot retarget Cancel; unknown/disconnected/ambiguous ownership stays guarded',async()=>{
 const f=trayFixture();f.publish('recording');const stale=f.item('Cancel recording');f.publish('recording');stale.click();await settle();assert.equal(f.driver.commands().length,0);
 f.publish('unknown');assert.equal(f.item('Cancel recording').enabled,false);
 const before=f.driver.current();f.driver.publish({...before,revision:before.revision+1,captures:[{captureId:'another',phase:'recording',delivery:'unknown',outcomes:[]}]});
 stale.click();await settle();assert.equal(f.driver.commands().length,0);
 f.driver.publish({...f.driver.current(),revision:f.driver.current().revision+1,captures:[...f.driver.current().captures,{captureId:'second',phase:'recording',delivery:'unknown',outcomes:[]}]});assert.equal(f.item('Cancel recording').enabled,false);
 f.publish('recording');f.driver.disconnect();assert.equal(f.item('Cancel recording').enabled,false);f.dispose();
});
test('unknown cancellation is not retried or cleared by unrelated facts; authoritative cancelled preserves prior Saved',async()=>{
 const f=trayFixture();const previous={captureId:'previous-saved',artifactId:'same-original-artifact',phase:'saved' as const,delivery:'unknown' as const,outcomes:[]};
 const publish=(phase:'recording'|'unknown'|'cancelled')=>f.driver.publish({...f.driver.current(),revision:f.driver.current().revision+1,captures:[previous,{captureId:'capture-one',phase,delivery:'unknown',outcomes:[]}]});
 publish('recording');f.driver.setNextResult('outcome-unknown');f.item('Cancel recording').click();await settle();assert.match(f.notice(),/cancellation outcome unknown/);
 publish('recording');f.item('Cancel recording').click();await settle();assert.equal(f.driver.commands().filter(c=>c.type==='cancel-capture').length,1);
 assert.equal(f.visible(),false);assert.deepEqual(f.driver.current().captures[0],previous);assert.equal(f.driver.current().captures.filter(c=>c.phase==='saved').length,1);
 publish('cancelled');assert.equal(f.notice(),'Apparent — recording cancelled');assert.deepEqual(f.driver.current().captures[0],previous);assert.equal(f.driver.current().captures.filter(c=>c.phase==='saved').length,1);f.dispose();
});
test('positive refusal reports refusal without claiming cancelled; disposed menu never dispatches',async()=>{
 const f=trayFixture();f.publish('recording');f.driver.setNextResult('refused');f.item('Cancel recording').click();await settle();
 assert.match(f.notice(),/cancellation refused/);assert.equal(f.driver.current().captures[0].phase,'recording');assert.equal(f.visible(),false);assert.equal(f.item('Cancel recording').enabled,true);
 f.publish('recording');assert.match(f.notice(),/cancellation refused/);const item=f.item('Cancel recording');f.dispose();item.click();await settle();assert.equal(f.driver.commands().filter(c=>c.type==='cancel-capture').length,1);
});

test('pending cancellation leaves physical Stop live and late command reply cannot undo observed cancelled',async()=>{
 const f=fixture();f.publish('recording');let release!:()=>void;
 const gate=new Promise<void>(r=>{release=r;});let items:DrawingMenuItem[]=[],notice='';
 const record={...f.host.record,async execute(command:Parameters<typeof f.host.record.execute>[0]){
   const result=await f.host.record.execute(command);if(command.type==='cancel-capture')await gate;return result;
 }};
 const dispose=bindDrawingTray({record,stop:f.activate,menu(value){items=value;},notice(value){notice=value;},createRequestId:()=> 'pending-cancel'});
 items.find(i=>i.label==='Cancel recording')!.click();await settle();
 items.find(i=>i.label==='Stop recording')!.click();await settle();assert.equal(f.driver.commands().filter(c=>c.type==='stop-capture').length,1);
 f.publish('cancelled');assert.equal(notice,'Apparent — recording cancelled');release();await settle();assert.equal(notice,'Apparent — recording cancelled');dispose();
});
test('a replacement provider cannot settle the prior provider cancellation by reusing its public capture ID',async()=>{
 const f=trayFixture();f.publish('recording');f.driver.setNextResult('outcome-unknown');f.item('Cancel recording').click();await settle();
 const current=f.driver.current();f.driver.reconnect({...current,providerEpoch:'replacement-provider',revision:1,captures:current.captures.map(c=>({...c,phase:'cancelled'}))});
 assert.match(f.notice(),/cancellation outcome unknown/);assert.equal(f.item('Cancel recording').enabled,false);f.dispose();
});
test('late cancellation refusal from a retired provider stays unknown in the replacement provider',async()=>{
 const f=fixture();f.publish('recording');let release!:()=>void;
 const gate=new Promise<void>(r=>{release=r;});let items:DrawingMenuItem[]=[],notice='';
 f.driver.setNextResult('refused');
 const record={...f.host.record,async execute(command:Parameters<typeof f.host.record.execute>[0]){const result=await f.host.record.execute(command);await gate;return result;}};
 const dispose=bindDrawingTray({record,stop:f.activate,menu(value){items=value;},notice(value){notice=value;}});
 items.find(i=>i.label==='Cancel recording')!.click();await settle();const previous=f.driver.current();
 f.driver.reconnect({...previous,providerEpoch:'replacement-provider',revision:1});release();await settle();
 assert.match(notice,/cancellation outcome unknown/);assert.equal(items.find(i=>i.label==='Cancel recording')!.enabled,false);dispose();
});
