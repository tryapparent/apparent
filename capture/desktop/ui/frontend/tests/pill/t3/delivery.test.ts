import {test} from 'node:test';import assert from 'node:assert/strict';
import {Delivery,type Job} from '../../../electron/pill/t3/delivery.ts';
const target={origin:'https://t3.example',threadId:'exact-thread',projectId:'p',title:'Chosen'};
test('processing confirmation waits for text; duplicate readiness does not send twice; target is frozen',async()=>{
 const saved:Job[]=[],calls:object[]=[];const sender={rpc:async(_tag:string,payload:object)=>{calls.push(payload);}};
 const d=new Delivery({save:async j=>{saved.push(structuredClone(j));}},()=>sender),job=d.create('capture',target,null);
 target.threadId='changed-after-selection';await d.submit(job);assert.equal(calls.length,0);
 job.text='Exact recording';await Promise.all([d.submit(job),d.submit(job)]);await d.submit(job);
 assert.equal(calls.length,1);assert.equal((calls[0] as {threadId:string}).threadId,'exact-thread');assert.equal(saved[0].phase,'sending');assert.equal(saved.at(-1)?.phase,'sent');
});
test('uncertain acknowledgement retries identical command and message, never a second thread',async()=>{
 const calls:Record<string,unknown>[]=[],d=new Delivery({save:async()=>{}},()=>({rpc:async(_tag,p)=>{calls.push(p);if(calls.length===1)throw Error('lost reply');}}));
 const job=d.create('capture',{...target,launch:{modelSelection:{model:'default'},runtimeMode:'approval-required',interactionMode:'default',workspaceStrategy:{type:'root'}}},'Recording');
 await d.submit(job);assert.equal(job.phase,'uncertain');await d.submit(job);assert.equal(job.phase,'sent');assert.deepEqual(calls[0],calls[1]);
});
test('cancelled pending handoff cannot dispatch on readiness',async()=>{let calls=0;const d=new Delivery({save:async()=>{}},()=>({rpc:async()=>{calls++;}}));const job=d.create('capture',target,null);await d.cancel(job);job.text='ready';await d.submit(job);assert.equal(calls,0);});
test('failed intent persistence never sends; failed acknowledgement persistence retains retry text and IDs',async()=>{
 let fail=true,calls=0;const d=new Delivery({save:async()=>{if(fail)throw Error('disk unavailable');}},()=>({rpc:async()=>{calls++;fail=true;}}));
 const job=d.create('capture',target,'Recording');await assert.rejects(d.submit(job));assert.equal(calls,0);assert.equal(job.phase,'error');
 fail=false;await assert.rejects(d.submit(job));assert.equal(calls,1);assert.equal(job.phase,'uncertain');assert.equal(job.text,'Recording');
});
