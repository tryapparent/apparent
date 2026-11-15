import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentsPreferences, preferenceEnabled, preferenceFacts} from '../../../src/agents/policy.ts';

test('Agents defaults on, respects saved false and never treats read failure as enabled', () => {
  assert.equal(preferenceEnabled({saved: null}), true);
  assert.equal(preferenceEnabled({saved: false}), false);
  assert.equal(preferenceEnabled({saved: true}), true);
  assert.equal(preferenceEnabled({error: 'config_read_failed'}), undefined);
  assert.throws(() => preferenceFacts({saved: 'false'}));
  assert.deepEqual(preferenceFacts({saved: false, token: 'private'}), {saved: false});
});

test('Only a matching parent acknowledgement can complete a preference change', async () => {
  const messages: object[] = [];
  const bridge = new AgentsPreferences(message => messages.push(message));
  const saving = bridge.request(false);
  assert.deepEqual(messages, [{action: 'agents-preference', request: 1, enabled: false}]);
  await assert.rejects(bridge.request(true), /pending/);
  bridge.receive({request: 99, facts: {saved: true}});
  bridge.receive({request: 1, facts: {error: 'config_write_failed'}});
  assert.deepEqual(await saving, {error: 'config_write_failed'});
  const reading = bridge.request();
  assert.deepEqual(messages[1], {action: 'agents-preference', request: 2});
  bridge.receive({request: 2, facts: {saved: false}});
  assert.deepEqual(await reading, {saved: false});
  await assert.rejects(bridge.request('false'), /Invalid/);
  const closed = bridge.request();
  bridge.close();
  await assert.rejects(closed, /closed/);
});

test('An unacknowledged write times out and allows a fresh read', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const bridge = new AgentsPreferences(() => {});
  const saving = assert.rejects(bridge.request(false), /timed out/);
  context.mock.timers.tick(3500);
  await saving;
  const reading = bridge.request();
  bridge.receive({request: 1, facts: {saved: true}});
  bridge.receive({request: 2, facts: {saved: false}});
  assert.deepEqual(await reading, {saved: false});
});

test('T3 picker is off by default and has an independent acknowledged preference', async()=>{
 const {t3PickerEnabled}=await import('../../../src/agents/policy.ts');
 assert.equal(t3PickerEnabled({saved:null}),false);
 assert.equal(t3PickerEnabled({saved:true,t3Saved:null}),false);
 assert.equal(t3PickerEnabled({saved:true,t3Saved:true}),true);
 assert.equal(t3PickerEnabled({saved:false,t3Saved:false}),false);
 assert.equal(t3PickerEnabled({error:'config_read_failed'}),undefined);
 const messages:object[]=[],bridge=new AgentsPreferences(value=>messages.push(value));
 const saving=bridge.request(true,'t3');assert.deepEqual(messages,[{action:'agents-preference',request:1,enabled:true,setting:'t3'}]);
 bridge.receive({request:1,facts:{saved:false,t3Saved:true,t3Configured:false}});
 assert.deepEqual(await saving,{saved:false,t3Saved:true,t3Configured:false});
 assert.throws(()=>preferenceFacts({saved:true,t3Saved:'true'}));
});

 test('Auto paste defaults off and saves independently through the acknowledged bridge',async()=>{
  const {autoPasteEnabled}=await import('../../../src/agents/policy.ts');
  assert.equal(autoPasteEnabled({saved:null}),false);
  assert.equal(autoPasteEnabled({saved:null,autoPasteSaved:true}),true);
  assert.equal(autoPasteEnabled({error:'config_read_failed'}),undefined);
  assert.throws(()=>preferenceFacts({saved:null,autoPasteSaved:'true'}));
  const messages:object[]=[];const bridge=new AgentsPreferences(m=>messages.push(m));
  const saving=bridge.request(true,'autoPaste');
  assert.deepEqual(messages,[{action:'agents-preference',request:1,enabled:true,setting:'autoPaste'}]);
  bridge.receive({request:1,facts:{saved:false,autoPasteSaved:true,autoPasteSupported:true}});
  assert.equal(autoPasteEnabled(await saving),true);
});
