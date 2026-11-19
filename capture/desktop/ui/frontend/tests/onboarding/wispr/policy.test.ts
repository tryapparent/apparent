import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WisprOnboarding,savedWisprExperiment,type WisprContext,type WisprResult} from '../../../electron/onboarding/wispr.ts';
import {facts as preferenceFacts} from '../../../src/settings/labs/policy.ts';

const ready:WisprContext={platform:'macos',step:'shortcut',fix:false,shortcutChosen:false,wisprFlowEnabled:true};
test('no native discovery or quit outside the explicit macOS experiment and shortcut decision',async()=>{
  let calls=0;const provider=async()=>{calls++;return {status:'running',apps:['wisprFlow']} as WisprResult;};
  for(const context of [null,{...ready,wisprFlowEnabled:false},{...ready,platform:'linux'},{...ready,step:'permissions'},
    {...ready,fix:true},{...ready,shortcutChosen:true}]){
    const service=new WisprOnboarding(()=>context,async()=>true,provider,'darwin');
    assert.deepEqual(await service.request('read'),{status:'disabled'});
    assert.deepEqual(await service.request('quit'),{status:'disabled'});
  }
  assert.deepEqual(await new WisprOnboarding(()=>ready,async()=>false,provider,'darwin').request('quit'),{status:'disabled'});
  assert.deepEqual(await new WisprOnboarding(()=>ready,async()=>true,provider,'linux').request('quit'),{status:'disabled'});
  assert.equal(calls,0);
});
test('default off and malformed config fail closed without leaking unrelated preferences',async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'wispr-'));
  try{
    assert.equal(await savedWisprExperiment(home),false);
    await mkdir(path.join(home,'.config/apparent'),{recursive:true});
    const file=path.join(home,'.config/apparent/config.json');
    for(const value of ['{}','invalid',JSON.stringify({experiments:{onboardingWisprFlow:'true'}})]){
      await writeFile(file,value);assert.equal(await savedWisprExperiment(home),false);
    }
    await writeFile(file,JSON.stringify({secret:'private',experiments:{onboardingWisprFlow:true}}));
    assert.equal(await savedWisprExperiment(home),true);
    assert.throws(()=>preferenceFacts({saved:null,wisprSaved:'true'}));
  }finally{await rm(home,{recursive:true,force:true});}
});
test('quit success requires a provider exit receipt; refusal and unknown remain distinct',async()=>{
  for(const status of ['closed','refused','unknown'] as const){
    const service=new WisprOnboarding(()=>ready,async()=>true,async operation=>{
      if(operation==='read')return {status:'running',apps:['wisprFlow']};
      return {status};
    },'darwin');
    await service.request('read');
    assert.deepEqual(await service.request('quit'),{status});
    await assert.rejects(service.request('force-quit'),/Forbidden/);
  }
});
test('closing or leaving setup invalidates pending admission and native completion',async()=>{
  let enabled!:(value:boolean)=>void,calls=0;
  const admission=new WisprOnboarding(()=>ready,()=>new Promise(resolve=>enabled=resolve),async()=>{calls++;return {status:'closed'};},'darwin');
  const pending=admission.request('quit');admission.close();enabled(true);
  assert.deepEqual(await pending,{status:'disabled'});assert.equal(calls,0);
  let finish!:(value:WisprResult)=>void,signal:AbortSignal|undefined;
  const service=new WisprOnboarding(()=>ready,async()=>true,async(operation,current)=>{
    if(operation==='read')return {status:'running',apps:['superwhisper']};
    signal=current;return new Promise(resolve=>finish=resolve);
  },'darwin');
  await service.request('read');
  const quit=service.request('quit');await Promise.resolve();
  assert.deepEqual(await service.request('quit'),{status:'unknown'});
  service.close();assert.equal(signal?.aborted,true);finish({status:'closed'});
  assert.deepEqual(await quit,{status:'disabled'});
});

test('quit uses only the apps offered in the current shortcut visit',async()=>{
  const requests: Array<readonly string[]> = [];
  const service=new WisprOnboarding(()=>ready,async()=>true,async(operation,_signal,apps)=>{
    if(operation==='read')return {status:'running',apps:['superwhisper']};
    requests.push(apps);
    return {status:'closed'};
  },'darwin');
  assert.deepEqual(await service.request('quit'),{status:'unknown'});
  assert.deepEqual(await service.request('read'),{status:'running',apps:['superwhisper']});
  assert.deepEqual(await service.request('quit'),{status:'closed'});
  assert.deepEqual(await service.request('quit'),{status:'unknown'});
  await service.request('read');
  service.close();
  assert.deepEqual(await service.request('quit'),{status:'unknown'});
  assert.deepEqual(requests,[['superwhisper']]);
});
