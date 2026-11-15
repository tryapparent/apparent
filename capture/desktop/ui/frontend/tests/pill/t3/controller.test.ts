import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,readdir,stat,rm,chmod} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Controller} from '../../../electron/pill/t3/controller.ts';
import {pair} from '../../../../../workflow/t3/pair.ts';
import {fixture} from './testing/server.ts';

test('pairing alone leaves picker off; explicit Agents flag enables it without exposing secrets',async t=>{
 const f=await fixture(t);const paired=await pair(f.origin+'/pair?token=one-time');assert.equal(paired.origin,f.origin);
 await f.save();const c=new Controller(()=>{},f.config);await c.update('off','processing');assert.equal(c.view(),null);assert.equal(f.reads,0);
 await f.save(false);await c.update('off-again','processing');assert.equal(c.view(),null);
 await f.save(true);await c.update('on','processing');assert.deepEqual(c.view()?.choices.map(c=>c.id),['new','thread']);assert.equal(JSON.stringify(c.view()).includes('private-test-token'),false);
 await assert.rejects(pair('http://remote.example/pair?token=one-time'),/HTTPS/);
});

test('confirmed processing handoff survives dismissal/reload and is dispatched once to exact thread',async t=>{
 const f=await fixture(t),c=new Controller(()=>{},f.config);await c.update('capture','processing');await c.confirm('capture','thread');assert.equal(c.view()?.phase,'armed');assert.equal(f.calls.length,0);
 const files=await readdir(path.join(f.home,'t3-handoffs'));assert.equal((await stat(path.join(f.home,'t3-handoffs',files[0]))).mode&0o777,0o600);
 const restored=new Controller(()=>{},f.config);await restored.update('capture','processing');assert.equal(restored.view()?.selected,'thread');await restored.update('new-capture','recording');
 await restored.ready('capture','PRIVATE RECORDING HANDOFF');await restored.ready('capture','PRIVATE RECORDING HANDOFF');assert.equal(f.accepted.size,1);assert.equal(f.calls[0].payload.threadId,'thread');assert.equal(f.calls[0].payload.deliveryIntent,'auto');assert.equal(restored.view(),null);
 const receipt=await readFile(path.join(f.home,'t3-handoffs',files[0]),'utf8');assert.equal(JSON.parse(receipt).phase,'sent');assert.equal(receipt.includes('private-test-token'),false);
});

test('lost acknowledgement retries the same new thread, command and message with T3 defaults',async t=>{
 const f=await fixture(t);f.worktree();const c=new Controller(()=>{},f.config);await c.update('capture','completed');await c.ready('capture','Recording');f.lose();await c.confirm('capture','new');assert.equal(c.view()?.phase,'uncertain');
 await c.retry('capture');assert.equal(c.view()?.phase,'sent');assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.accepted.size,1);
 assert.equal(f.calls[0].tag,'orchestration.launchThread');assert.deepEqual(f.calls[0].payload.modelSelection,{instanceId:'fixture',model:'project-default'});assert.equal(f.calls[0].payload.runtimeMode,'auto-accept-edits');assert.deepEqual(f.calls[0].payload.workspaceStrategy,{type:'worktree',baseRef:'origin/main',startFromOrigin:true});
});

test('cancel and failed finalization never dispatch; stale confirmation cannot target a newer recording',async t=>{
 const f=await fixture(t),c=new Controller(()=>{},f.config);await c.update('capture','processing');await c.confirm('capture','thread');await c.cancel('capture');await c.ready('capture','Recording');assert.equal(f.calls.length,0);
 await c.update('failed','processing');await c.ready('failed',null);await assert.rejects(c.confirm('failed','new'),/prepared/);
 await c.update('new','processing');await assert.rejects(c.confirm('failed','thread'),/changed/);assert.equal(f.calls.length,0);
});

test('disabling the next recording keeps its Paste flow while an earlier confirmed handoff finishes',async t=>{
 const f=await fixture(t),c=new Controller(()=>{},f.config);await c.update('pending','processing');await c.confirm('pending','thread');
 await f.save(false);await c.update('off','completed');assert.equal(c.view(),null);
 await c.ready('pending','Earlier confirmed recording');assert.equal(f.calls.length,1);assert.equal(c.view(),null);
 await c.ready('off','Keep this local');assert.equal(c.view(),null);assert.equal(f.calls.length,1);
});

test('inaccessible receipts fail closed and a background persistence failure exposes recovery',async t=>{
 const f=await fixture(t),c=new Controller(()=>{},f.config);await c.update('capture','processing');await c.confirm('capture','thread');
 await chmod(path.join(f.home,'t3-handoffs'),0o755);await c.ready('capture','Kept recording');assert.equal(c.view()?.phase,'error');assert.equal(f.calls.length,0);assert.equal(c.text('capture'),'Kept recording');
 const restored=new Controller(()=>{},f.config);await restored.update('new','completed');await assert.rejects(restored.confirm('new','thread'),/receipts unavailable/);assert.equal(f.calls.length,0);
 await chmod(path.join(f.home,'t3-handoffs'),0o700);await c.retry('capture');assert.equal(c.view()?.phase,'sent');assert.equal(f.calls.length,1);
});
