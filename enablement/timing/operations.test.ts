import {test} from 'node:test';
import assert from 'node:assert/strict';
import {describe,summarize,readRollout} from './census.ts';
import {operations} from './operations.ts';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('actual wrapper calls classify review and editing without reading embedded prose as commands',()=>{
  assert.deepEqual(operations('exec',`const r=await tools.mcp__t3_code__delegate_task({task:"inspect tools.exec_command, cargo test, git push; no execution"});text(r);`).operations,['delegated work/review']);
  assert.deepEqual(operations('exec',`text(await tools.apply_patch("*** Begin Patch\\n+tools.exec_command({cmd:'cargo test'})\\n*** End Patch"));`).operations,['source/artifact editing']);
  assert.deepEqual(operations('exec',`// tools.write_stdin({})\ntext(await tools.exec_command({cmd:"git status --short"}));`).operations,['Git inspection']);
});
test('real command forms recover hook entrypoint, gh api, log reads and non-Rust runner',()=>{
  const command=(cmd:string)=>operations('exec_command',JSON.stringify({cmd})).operations;
  assert.deepEqual(command('TMPDIR=/tmp/private node --experimental-strip-types enablement/local-tests/execution/push.ts --jobs 2 -- origin HEAD > /tmp/private/log 2>&1'),['verification/push']);
  assert.deepEqual(command('gh api repos/example/repo/actions/jobs/123'),['CI/PR operations']);
  assert.deepEqual(command('tail -6 /tmp/private/log | cut -c1-220; rg -n error /tmp/private/log | tail -4'),['source/artifact inspection']);
  assert.deepEqual(command('/home/agent/.local/bin/t3-build -- node --test example.test.ts'),['build/test runner']);
  assert.deepEqual(command('python3 /agent/gh_owned_wait.py 123 --attempt 1'),['CI observation']);
});
test('heredoc source cannot contaminate operation and dynamic commands remain unresolved',()=>{
  assert.deepEqual(operations('exec',`text(await tools.exec_command({cmd:"cat > /tmp/source.ts <<'EOF'\\nconst x = 'cargo test'; // git push\\nEOF\\ncat /tmp/source.ts"}));`).operations,['file/artifact management','source/artifact inspection']);
  assert.deepEqual(operations('exec','await tools.exec_command({cmd:prefix+"cargo test"})').operations,['unknown']);
  assert.deepEqual(operations('exec','await tools.exec_command({cmd:`echo ${secret}`})').operations,['unknown']);
  assert.equal(describe('exec','await tools.exec_command({cmd:"cat source"});await tools.exec_command({cmd:"git status"})').batched,true);
  assert.deepEqual(operations('exec_command',JSON.stringify({cmd:'echo "$(cargo test)"'})).operations,['unknown']);
});
test('mixed wrappers keep the whole interval and unresolved occupancy prevents a false winner',()=>{
  const call=(id:string,source:string,end:number)=>({id,session:'s',workspace:'/private',tool:'exec',...describe('exec',source),start:0,end,asynchronous:false});
  const known=call('known','tools.exec_command({cmd:"cargo test"})',10_000);
  const mixed=call('mixed','tools.apply_patch("cargo test");tools.exec_command({cmd:dynamicCommand})',20_000);
  const report=summarize([known,mixed],0,30_000);
  assert.equal(report.actionRanking.envelopes.candidate?.label,'Rust build/test');
  assert.equal(report.actionRanking.envelopes.winnerEstablished,false);
  assert.equal(report.actionRanking.envelopes.unresolvedSeconds,20);
  assert.equal(report.actionRanking.envelopes.ranked.reduce((n,g)=>n+g.totalSeconds,0),30);
  const safe=summarize([known,{...mixed,end:1000}],0,30_000);
  assert.equal(safe.actionRanking.envelopes.winnerEstablished,true);
  assert.ok(!JSON.stringify(report).includes('cargo test'), 'reports do not expose raw commands or patch text');
});
test('producer rollout and recovered process ranking identify the TypeScript hook without changing clocks',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'apparent-dev-operations-'));
  try{
    const file=join(dir,'rollout.jsonl');
    const row=(time:number,payload:object)=>JSON.stringify({type:'response_item',timestamp:new Date(time).toISOString(),payload});
    writeFileSync(file,[JSON.stringify({type:'session_meta',payload:{id:'s',cwd:'/fixture'}}),
      row(1000,{type:'custom_tool_call',name:'exec',call_id:'launch',input:'text(await tools.exec_command({cmd:"node --experimental-strip-types enablement/local-tests/execution/push.ts -- origin HEAD"}));'}),
      row(2000,{type:'custom_tool_call_output',call_id:'launch',output:'{"session_id":123}'}),
      row(10000,{type:'custom_tool_call',name:'exec',call_id:'poll',input:'tools.write_stdin({session_id:123})'}),
      row(11000,{type:'custom_tool_call_output',call_id:'poll',output:'{"exit_code":0}'})].join('\n'));
    const r=await readRollout(file,()=>true), s=summarize(r.calls,0,12_000);
    assert.equal(s.actionRanking.processes.candidate?.label,'verification/push');
    assert.equal(s.actionRanking.processes.candidate?.totalSeconds,10);
    assert.equal(s.actionRanking.processes.winnerEstablished,true);
    assert.equal(s.observedToolUnionSeconds,2);
    assert.equal(s.actionRanking.envelopes.ranked.find(g=>g.label==='waiting/status for verification/push')?.count,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('poll+log wrappers do not replace the actual process origin or multiply observed spans',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'apparent-dev-operation-polls-'));
  try{
    const file=join(dir,'rollout.jsonl');
    const row=(time:number,type:string,id:string,body:object)=>JSON.stringify({type:'response_item',timestamp:new Date(time).toISOString(),payload:{type,call_id:id,...body}});
    writeFileSync(file,[JSON.stringify({type:'session_meta',payload:{id:'s',cwd:'/fixture'}}),
      row(1000,'custom_tool_call','launch',{name:'exec',input:'tools.exec_command({cmd:"cargo test"})'}),
      row(2000,'custom_tool_call_output','launch',{output:'{"session_id":123}'}),
      row(4000,'custom_tool_call','poll1',{name:'exec',input:'tools.write_stdin({session_id:123});tools.exec_command({cmd:"tail /tmp/log"})'}),
      row(5000,'custom_tool_call_output','poll1',{output:'{"session_id":123}'}),
      row(9000,'custom_tool_call','poll2',{name:'exec',input:'tools.write_stdin({session_id:123})'}),
      row(10000,'custom_tool_call_output','poll2',{output:'{"exit_code":0}'})].join('\n'));
    const r=await readRollout(file,()=>true),s=summarize(r.calls,0,12000);
    assert.equal(s.actionRanking.processes.ranked.length,1);
    assert.equal(s.actionRanking.processes.candidate?.label,'Rust build/test');
    assert.equal(s.actionRanking.processes.candidate?.totalSeconds,9);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('yielded exec cells retain known wait origin without treating cell waits as extra processes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'apparent-dev-operation-cells-'));
  try{
    const file=join(dir,'rollout.jsonl');
    const row=(time:number,payload:object)=>JSON.stringify({type:'response_item',timestamp:new Date(time).toISOString(),payload});
    writeFileSync(file,[JSON.stringify({type:'session_meta',payload:{id:'s',cwd:'/fixture'}}),
      row(1000,{type:'custom_tool_call',name:'exec',call_id:'launch',input:'tools.exec_command({cmd:"cargo test"})'}),
      row(2000,{type:'custom_tool_call_output',call_id:'launch',output:'{"session_id":123}'}),
      row(3000,{type:'custom_tool_call',name:'exec',call_id:'poll',input:'tools.write_stdin({session_id:123})'}),
      row(4000,{type:'custom_tool_call_output',call_id:'poll',output:'Script running with cell ID cell:1'}),
      row(5000,{type:'function_call',namespace:'functions',name:'wait',call_id:'cell',arguments:'{"cell_id":"cell:1"}'}),
      row(10000,{type:'function_call_output',call_id:'cell',output:'completed'})].join('\n'));
    const r=await readRollout(file,()=>true),s=summarize(r.calls,0,12000);
    assert.deepEqual(r.calls.at(-1)?.waitedOperations,['Rust build/test']);
    assert.equal(s.actionRanking.envelopes.ranked.find(g=>g.label==='waiting/status for Rust build/test')?.totalSeconds,6);
    assert.equal(s.actionRanking.processes.ranked.length,0,'cell result lacks an exact process terminal endpoint');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
