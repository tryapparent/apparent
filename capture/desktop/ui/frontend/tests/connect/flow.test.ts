import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startConnect, type ConnectBridge} from '../../src/connect/flow.ts';
import type {ConnectSettings} from '../../src/bridge.ts';

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
