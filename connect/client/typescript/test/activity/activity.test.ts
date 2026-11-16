import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {recordingActivity} from '../../src/activity/index.ts';
test('only connected non-practice recording starts qualify; arbitrary fields cannot carry private data',()=>{
 assert.equal(recordingActivity({recording:true,practice:false,connected:true}),true);
 for(const v of [null,[],{}, {recording:false,practice:false,connected:true},{recording:true,practice:true,connected:true},{recording:true,practice:false,connected:false},{recording:true,practice:false,connected:true,email:'private@example.com'},{recording:'true',practice:false,connected:true}])assert.equal(recordingActivity(v),false);
});
test('real stdio protocol emits only a fixed capability, no input echo or identity',()=>{
 for(const [input,operation] of [['{"recording":true,"practice":false,"connected":true}','recording-started'],['{"recording":true,"practice":true,"connected":true}','skip'],['{"email":"private@example.com"}','skip']]){
  const r=spawnSync(process.execPath,['--experimental-strip-types','src/activity/index.ts'],{input:input+'\n',encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{operation});
 }
});
