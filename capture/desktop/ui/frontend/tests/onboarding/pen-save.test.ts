import {test} from 'node:test';
import assert from 'node:assert/strict';
import {savePen} from '../../src/onboarding/pen/save.ts';

test('only this click’s durable receipt confirms a save, including same-colour reselection',async()=>{
  let emit!:(state:{penSaveId?:string;penError:boolean})=>void;
  let id='',stopped=0;
  const bridge={onState:(listener:typeof emit)=>{emit=listener;return()=>{stopped++}},action:async(action:string)=>{id=action.split(':')[2];return true}};
  let completed=false;
  const first=savePen(bridge,'purple',new AbortController().signal).then(()=>{completed=true});
  emit({penError:false});emit({penSaveId:'old-selection',penError:false});
  await Promise.resolve();assert.equal(completed,false);
  const firstId=id;
  emit({penSaveId:id,penError:false});await first;
  const second=savePen(bridge,'purple',new AbortController().signal);
  assert.notEqual(id,firstId);
  emit({penSaveId:firstId,penError:false});
  emit({penSaveId:id,penError:true});
  await assert.rejects(second,/could not be saved/);
  assert.equal(stopped,2);
});

test('disconnection and leaving the picker release the receipt listener',async()=>{
  await assert.rejects(savePen(undefined,'blue',new AbortController().signal),/connection/);
  for(const accepted of [false,true]){
    let stopped=false;
    const controller=new AbortController();
    const pending=savePen({onState:()=>()=>{stopped=true},action:async()=>accepted},'blue',controller.signal);
    if(accepted)controller.abort();
    await assert.rejects(pending,accepted?/cancelled/:/connection/);
    assert.equal(stopped,true);
  }
});

test('a provider may finish saving before dispatch acknowledgement resolves',async()=>{
  let emit!:(state:{penSaveId?:string;penError:boolean})=>void;
  await savePen({onState:listener=>{emit=listener;return()=>{}},action:async action=>{
    emit({penSaveId:action.split(':')[2],penError:false});return true;
  }},'green',new AbortController().signal);
});

test('missing save confirmation times out and releases the listener',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let stopped=false;
  const pending=savePen({onState:()=>()=>{stopped=true},action:async()=>true},'blue',new AbortController().signal);
  const rejected=assert.rejects(pending,/did not confirm/);
  t.mock.timers.tick(10000);
  await rejected;assert.equal(stopped,true);
});
