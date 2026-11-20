import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentsPreferences, preferenceEnabled, preferenceFacts} from '../../../src/settings/agents/policy.ts';

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

test('T3 has an independent acknowledged preference', async()=>{
 const messages:object[]=[],bridge=new AgentsPreferences(value=>messages.push(value));
 const saving=bridge.request(true,'t3');assert.deepEqual(messages,[{action:'agents-preference',request:1,enabled:true,setting:'t3'}]);
 bridge.receive({request:1,facts:{saved:false,t3Saved:true,t3Configured:false}});
 assert.deepEqual(await saving,{saved:false,t3Saved:true,t3Configured:false});
 assert.throws(()=>preferenceFacts({saved:true,t3Saved:'true'}));
});

test('connection facts expose only a canonical origin, expiry and preference state',()=>{
  const fields={saved:null,t3Configured:true,t3Origin:'https://t3.example',t3ExpiresAt:12345,token:'private',refreshToken:'private'};
  assert.deepEqual(preferenceFacts(fields),{saved:null,t3Configured:true,t3Origin:'https://t3.example',t3ExpiresAt:12345});
  for(const origin of ['https://user:private@t3.example','https://t3.example/?token=private','not a URL'])
    assert.deepEqual(preferenceFacts({...fields,t3Origin:origin,t3ExpiresAt:Infinity}),{saved:null,t3Configured:true});
});
test('a cancelled queued connection and closed Settings never dispatch a native mutation; later requests recover',async()=>{
 const {PreferenceQueue}=await import('../../../src/settings/agents/policy.ts');
 const queue=new PreferenceQueue(),abort=new AbortController();
 let release!:()=>void,writes=0,active=true;
 const reading=queue.run(()=>new Promise<void>(resolve=>release=resolve));
 await Promise.resolve();
 const saving=queue.run(async()=>{writes++;},()=>active,abort.signal);
 abort.abort();release();await reading;await assert.rejects(saving);assert.equal(writes,0);
 active=false;await assert.rejects(queue.run(async()=>{writes++;},()=>active));assert.equal(writes,0);
 active=true;await queue.run(async()=>{writes++;},()=>active);assert.equal(writes,1);
});
