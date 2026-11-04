import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('../dist/rpc.cjs',import.meta.url));

type Message=Record<string,any>;
async function actor(t:any,control:(message:Message)=>Message|'eof',initial='{"private":"synthetic-keep","large":9007199254740993}') {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'config-rpc-'));await fs.chmod(root,0o700);
  const config=path.join(root,'config.json');await fs.writeFile(config,initial,{mode:0o600});
  const child=spawn(process.execPath,[entry],{stdio:['pipe','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null){child.kill();await once(child,'exit');}await fs.rm(root,{recursive:true,force:true});});
  const result=new Promise<{message:Message;code:number|null}>((resolve,reject)=>{
    let bytes='',terminal:Message|undefined;
    const deadline=setTimeout(()=>{child.kill();reject(new Error('Private config actor deadline'));},5000);
    child.on('error',error=>{clearTimeout(deadline);reject(error);});
    child.stdout.on('data',chunk=>{
      bytes+=String(chunk);
      while(bytes.includes('\n')) {
        const end=bytes.indexOf('\n'),message=JSON.parse(bytes.slice(0,end));bytes=bytes.slice(end+1);
        if(message.event==='result'){terminal=message;continue;}
        try {
          const response=control(message);
          if(response==='eof') child.stdin.end(); else child.stdin.write(JSON.stringify(response)+'\n');
        } catch(error){child.kill();clearTimeout(deadline);reject(error);}
      }
    });
    child.on('exit',code=>{clearTimeout(deadline);if(terminal)resolve({message:terminal,code});else reject(new Error('Private config actor exited without a result'));});
  });
  child.stdin.write(JSON.stringify({v:1,op:'begin',path:[...Buffer.from(config)],guarded:true})+'\n');
  return {config,result};
}
const update=(message:Message):Message=>{
  if(message.event==='admit')return {v:1,op:'admit',allowed:true};
  if(message.event==='checkpoint')return {v:1,op:'checkpoint',continue:true};
  assert.equal(message.event,'snapshot');
  assert.ok(message.json.includes('9007199254740993'));
  return {v:1,op:'patch',json:'[{"path":["enabled"],"present":true,"value":true}]'};
};

test('private native adapter applies intent under the sole writer and preserves lossless unrelated values',async t=>{
  const f=await actor(t,update);const result=await f.result;
  assert.deepEqual(result,{message:{v:1,event:'result',ok:true,published:true},code:0});
  const raw=await fs.readFile(f.config,'utf8');assert.ok(raw.includes('9007199254740993'));
  const config=JSON.parse(raw);assert.equal(config.private,'synthetic-keep');assert.equal(config.enabled,true);
});

test('publication refusal/EOF before rename cannot write or acknowledge a commit',async t=>{
  const f=await actor(t,message=>message.event==='checkpoint'&&message.stage==='beforePublish'?'eof':update(message));
  const result=await f.result;assert.equal(result.message.ok,false);assert.equal(result.message.published,false);
  assert.equal(await fs.readFile(f.config,'utf8'),'{"private":"synthetic-keep","large":9007199254740993}');
});

test('unchanged-value native transaction still reports post-rename uncertainty',async t=>{
  const f=await actor(t,message=>{
    if(message.event==='snapshot')return {v:1,op:'patch',json:'[]'};
    if(message.event==='checkpoint'&&message.stage==='beforeDirectorySync')return {v:1,op:'checkpoint',continue:false};
    return update(message);
  });
  const result=await f.result;assert.equal(result.message.ok,false);assert.equal(result.message.code,'outcome-unknown');
  assert.equal(result.message.published,true);
});

test('private patch cannot replace the whole config or traverse inherited properties',async t=>{
  const f=await actor(t,message=>message.event==='snapshot'?{v:1,op:'patch',json:'[{"path":[],"present":true,"value":{}}]'}:update(message));
  const result=await f.result;assert.equal(result.message.ok,false);assert.equal(result.message.published,false);
  assert.equal(await fs.readFile(f.config,'utf8'),'{"private":"synthetic-keep","large":9007199254740993}');
});
