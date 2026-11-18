import {test} from 'node:test';
import assert from 'node:assert/strict';
import {describe,summarize,readRollout} from './census.ts';
import {operations} from './operations.ts';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const observer = `timeout 2700 bash -c 'rc=0; for id in 101 102 103 104; do gh run watch "$id" -R example/repo --exit-status --compact --interval 60 || rc=1; done; exit "$rc"' > /tmp/synthetic.log 2>&1`;

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

test('substitutions outside literal preparation lines stay unknown',()=>{
  const push = 'node --experimental-strip-types enablement/local-tests/execution/push.ts -- origin HEAD';
  const job = 'job=$(mktemp -d /tmp/apparent-dev-example-XXXXXX)';
  const guard = 'test -z "$(git status --porcelain)"';
  const command = (cmd:string) => operations('exec_command', JSON.stringify({cmd})).operations;
  for (const ambiguous of [
    '$(git status --porcelain)',
    'printf "%s" "$(git status --porcelain)"',
    'eval "$(git status --porcelain)"',
    'test -z "$(git status --porcelain; git push)"',
    'test -z "$(git status --porcelain $(echo extra))"',
    'test -z "$\\\n(git status --porcelain)"',
    'test -z "$(git status --porcelain "$path")"',
    'test "$(git rev-parse "$ref")" = "$(git rev-parse HEAD^)"',
    'test "$(git rev-parse origin/main)" = "$(git rev-parse HEAD^^)"',
    'test -z "`git status --porcelain`"',
    'test -z "$(git status --porcelain"',
    `${guard} extra`,
    'job=$(mktemp /tmp/apparent-dev-example-XXXXXX)',
    'job=$(mktemp -d /tmp/elsewhere-XXXXXX)',
    'job=$(mktemp -d /tmp/apparent-dev-$name-XXXXXX)',
    'job=$(mktemp -d /tmp/apparent-dev-example-XXXXXX))',
    `cat >"$(echo logfile)"\n${guard}`,
    `cat >"unclosed\n${job}\n"`,
    `cat > >(echo output)\n${job}`,
    `cat <<EOF\n${guard}\nEOF`,
    `cat <<'END'suffix\n${job}\nENDsuffix`,
    `cat <<'END'\n${job}`,
  ]) assert.deepEqual(command(ambiguous + '\n' + push), ['unknown'], ambiguous);

  for (const inert of [
    `cat <<'EOF' # inline comment\n${job}\n${guard}\nEOF`,
    `cat <<-"EOF"\n\t${job}\n\tEOF`,
    `printf '%s' '\n${job}\n${guard}\n'`,
    `cat <'$(git status --porcelain)'`,
  ]) assert.deepEqual(command(inert + '\n' + push),
    [inert.startsWith('printf') ? 'file/artifact management' : 'source/artifact inspection', 'verification/push'], inert);
});

test('only a finite literal observer accounts for the full shell envelope',()=>{
  const command = (cmd:string) => operations('exec_command', JSON.stringify({cmd})).operations;
  assert.deepEqual(command(observer), ['CI observation']);
  assert.deepEqual(command(observer.split(' > ')[0]), ['CI observation']);
  for (const unsupported of [
    observer.replace('101 102 103 104', '$ids'),
    observer.replace('101 102 103 104', '$(cat run-ids)'),
    observer.replace('"$id"', '"${!id}"'),
    observer.replace('do gh', 'do command gh'),
    observer.replace('do gh', 'do eval gh'),
    observer.replace('gh run watch', 'echo gh run watch'),
    observer.replace('done; exit', 'git push; done; exit'),
    observer.replace('/tmp/synthetic.log', '$(log_path)'),
    observer.replace('2700', '$limit'),
    observer.replace('2700', '0'),
    observer.replace('2700 bash', '2700 bash -l'),
    observer.replace('bash -c', 'bash -c "literal"'),
    `BASH_ENV=/tmp/setup ${observer}`,
    `${observer} &`,
    `${observer}; git push`,
    `${observer} <<EOF\ninput\nEOF`,
    `cat <<'EOF'\n${observer}\nEOF`,
    `printf '%s' '${observer.replaceAll("'", "'\\''")}'`,
  ]) assert.ok(!command(unsupported).includes('CI observation'), unsupported);
  assert.deepEqual(operations('exec', 'tools.exec_command({cmd: prefix + ' + JSON.stringify(observer) + '})').operations, ['unknown']);
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

test('literal observer attribution follows exact rollout links without changing either clock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apparent-dev-observer-'));
  try {
    const row = (time:number, payload:object) => JSON.stringify({type:'response_item', timestamp:new Date(time).toISOString(), payload});
    const poll = 'text(await tools.write_stdin({session_id: 53643, chars: ""}));';
    const firstWait = 4_000;
    const terminalWait = firstWait + 31 * 44_628;
    const processEnd = terminalWait + 44_629;
    const read = async (cmd:string) => {
      const file = join(dir, 'rollout.jsonl');
      const rows = [JSON.stringify({type:'session_meta', payload:{id:'s', cwd:'/fixture'}}),
        row(1_000, {type:'custom_tool_call', name:'exec', call_id:'launch', input:`text(await tools.exec_command({cmd:${JSON.stringify(cmd)}, yield_time_ms:1000}));`}),
        row(2_000, {type:'custom_tool_call_output', call_id:'launch', output:'Process running with session ID 53643'}),
        row(firstWait, {type:'custom_tool_call', name:'exec', call_id:'poll', input:poll}),
        row(firstWait + 44_628, {type:'custom_tool_call_output', call_id:'poll', output:'Script running with cell ID cell:1'}),
      ];
      for (let i = 1; i <= 30; i++) {
        const start = firstWait + i * 44_628;
        rows.push(row(start, {type:'function_call', namespace:'functions', name:'wait', call_id:`wait-${i}`, arguments:JSON.stringify({cell_id:`cell:${i}`})}));
        if (i === 1) rows.push(
          row(start, {type:'function_call', namespace:'functions', name:'wait', call_id:'unlinked', arguments:'{"cell_id":"cell:unknown"}'}),
          row(start + 1_000, {type:'function_call_output', call_id:'unlinked', output:'unrelated cell result'}));
        rows.push(row(start + 44_628, {type:'function_call_output', call_id:`wait-${i}`, output:i < 30 ? `Script running with cell ID cell:${i+1}` : 'Process running with session ID 53643'}));
      }
      rows.push(row(terminalWait, {type:'custom_tool_call', name:'exec', call_id:'terminal', input:poll}),
        row(processEnd, {type:'custom_tool_call_output', call_id:'terminal', output:'Process exited with code 1'}));
      writeFileSync(file, rows.join('\n'));
      return (await readRollout(file, () => true)).calls;
    };
    const after = await read(observer);
    const before = await read(observer.replace('101 102 103 104', '$ids'));
    const baseline = summarize(before, 0, processEnd + 1_000);
    const report = summarize(after, 0, processEnd + 1_000);
    assert.equal(report.calls, 34);
    assert.equal(report.calls, baseline.calls);
    assert.deepEqual(report.tools, baseline.tools);
    assert.equal(report.observedToolUnionSeconds, 1429.097);
    assert.equal(report.observedToolUnionSeconds, baseline.observedToolUnionSeconds);
    assert.deepEqual(after.map(({id, start, end, processObservedEnd, asynchronous}) => ({id, start, end, processObservedEnd, asynchronous})),
      before.map(({id, start, end, processObservedEnd, asynchronous}) => ({id, start, end, processObservedEnd, asynchronous})));
    assert.equal(after[0].processObservedEnd, processEnd);
    assert.equal(after.filter(c => c.processObservedEnd !== undefined).length, 1);
    assert.equal(after.find(c => c.id === 'unlinked')?.waitedOperations, undefined);
    assert.equal(after.filter(c => c.waitedOperations?.join() === 'CI observation').length, 32);
    assert.equal(report.actionRanking.envelopes.unresolvedSeconds, 1);
    const arithmetic = ({count, meanSeconds, totalSeconds}:{count:number; meanSeconds:number; totalSeconds:number}) => ({count, meanSeconds, totalSeconds});
    const waiting = report.actionRanking.envelopes.ranked.find(g => g.label === 'waiting/status for CI observation');
    const baselineLinked = summarize(before.filter(c => c.waitedOperations), 0, processEnd + 1_000);
    const unresolved = baselineLinked.actionRanking.envelopes.ranked.find(g => g.label === 'process wait');
    assert.ok(waiting && unresolved);
    assert.equal(waiting.count, 32);
    assert.equal(unresolved.unresolved, true);
    assert.ok(Math.abs(waiting.totalSeconds - 1428.097) < 1e-9);
    assert.equal(waiting.meanSeconds.toFixed(3), '44.628');
    assert.deepEqual(arithmetic(waiting), arithmetic(unresolved));
    assert.equal(report.actionRanking.envelopes.ranked.length, 3);
    assert.equal(report.actionRanking.processes.ranked.length, 1);
    assert.equal(baseline.actionRanking.processes.ranked.length, 1);
    assert.equal(baseline.actionRanking.processes.ranked[0].label, 'script execution (purpose unresolved)');
    assert.equal(report.actionRanking.processes.ranked[0].label, 'CI observation');
    assert.deepEqual(arithmetic(report.actionRanking.processes.ranked[0]), arithmetic(baseline.actionRanking.processes.ranked[0]));
    assert.equal(report.actionRanking.processes.ranked[0].totalSeconds, (processEnd - 1_000) / 1000);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
