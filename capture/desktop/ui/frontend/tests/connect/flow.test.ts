import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startConnect, type ConnectBridge} from '../../src/connect/consent.ts';
import type {ConnectSettings} from '../../src/connect/protocol.ts';

const consent:ConnectSettings={status:'connected',view:{title:'apparent',status:'',detail:'',note:'',server:null,userCode:null,verificationUri:null,phase:'consent',buttons:[{command:'allow',title:'Allow',enabled:true}]}};
test('one explicit disclosed click uses the existing consent admission then upload login',async()=>{
  const actions:string[]=[];
  const started:ConnectSettings={...consent,view:{...consent.view,phase:'starting',buttons:[]}};
  const bridge:ConnectBridge={read:async()=>{throw Error('Must not start from a passive read')},command:async a=>{actions.push(a);return a==='connect'?consent:started}};
  assert.equal(await startConnect(bridge),started);
  assert.deepEqual(actions,['connect','allow']);
});
test('no authorization starts after refusal, disabled consent or an incompatible response',async()=>{
  for(const result of [{status:'disabled'},{status:'error'},{...consent,view:{...consent.view,buttons:[]}}, {...consent,view:{...consent.view,buttons:[{command:'allow',enabled:false,title:'Allow'}]}}] as ConnectSettings[]){
    const actions:string[]=[];
    await startConnect({read:async()=>result,command:async a=>{actions.push(a);return result}});
    assert.deepEqual(actions,['connect']);
  }
});
test('every non-connected result is returned unchanged without admission',async()=>{
  for(const result of [{status:'disabled'},{status:'disconnected'},{status:'cancelled'},{status:'error'}] as ConnectSettings[]){
    const actions:string[]=[];
    assert.equal(await startConnect({read:async()=>result,command:async action=>{actions.push(action);return result}}),result);
    assert.deepEqual(actions,['connect']);
  }
});
test('stale generation cancels after connect resolves and never sends allow',async()=>{
  let current=true;
  let resolve!:(value:ConnectSettings)=>void;
  const response=new Promise<ConnectSettings>(done=>{resolve=done});
  const actions:string[]=[];
  const pending=startConnect({read:async()=>consent,command:async action=>{actions.push(action);return response}},()=>current);
  assert.deepEqual(actions,['connect']);
  current=false;resolve(consent);
  assert.deepEqual(await pending,{status:'cancelled'});
  assert.deepEqual(actions,['connect']);
});
test('connect and allow rejections propagate unchanged without retries',async()=>{
  for(const failedAction of ['connect','allow']){
    const failure=new Error(failedAction),actions:string[]=[];
    await assert.rejects(startConnect({read:async()=>consent,command:async action=>{
      actions.push(action);if(action===failedAction)throw failure;return consent;
    }}),error=>error===failure);
    assert.deepEqual(actions,failedAction==='connect'?['connect']:['connect','allow']);
  }
});
test('allow response is returned unchanged, including cancellation or error',async()=>{
  for(const result of [{status:'cancelled'},{status:'error'},consent] as ConnectSettings[]){
    const actions:string[]=[];
    assert.equal(await startConnect({read:async()=>consent,command:async action=>{
      actions.push(action);return action==='connect'?consent:result;
    }}),result);
    assert.deepEqual(actions,['connect','allow']);
  }
});
test('presentation buttons alone cannot grant upload admission',async()=>{
  const result:ConnectSettings={...consent,view:{...consent.view,buttons:[],presentation:{
    tone:'neutral',headline:'',detail:'',note:'',artwork:false,compact:false,accountMenu:false,
    buttons:[{command:'allow',title:'Allow',enabled:true}],menuActions:[],sharedLinksUrl:null,
  }}};
  const actions:string[]=[];
  assert.equal(await startConnect({read:async()=>result,command:async action=>{actions.push(action);return result}}),result);
  assert.deepEqual(actions,['connect']);
});
