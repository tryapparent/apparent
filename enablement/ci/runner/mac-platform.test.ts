import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {YAML} from 'bun';
import {suitePlan} from '../routing/consumers.ts';

const root = new URL('../../../', import.meta.url);
const jobs = YAML.parse(readFileSync(new URL('.github/workflows/verification-platform.yml',root),'utf8')).jobs;
function enabled(expression: string, inputs: any, outputs: any) {
  return Function('inputs','needs',`return (${expression});`)(inputs,{select:{outputs}});
}
test('each selected Mac platform uses one allocation; Linux retains independent parallel suites', () => {
  for (let mask=0;mask<16;mask++) {
    const flags=['root','engine','desktop','client'];
    const outputs=Object.fromEntries(flags.map((key,i)=>[key,String(!!(mask&(1<<i)))]));
    for(const runner of ['macos-15-intel','ubuntu-24.04']) for(const release_receipt of [false,true]) {
      const inputs={runner,mac_rust:true,release_receipt};
      const selected=['rust','desktop-ui','connect-client'].filter(key=>enabled(jobs[key].if,inputs,outputs));
      const packed=runner==='macos-15-intel'&&!release_receipt;
      assert.equal(selected.length, packed?Number(mask!==0):
        Number(outputs.root==='true'||outputs.engine==='true')+Number(outputs.desktop==='true')+Number(outputs.client==='true'));
      if(packed&&mask) assert.deepEqual(selected,['rust']);
    }
  }
});

test('packed Mac preserves required native proof, renderer/client execution and complete-cache ordering', () => {
  const steps=jobs.rust.steps;
  for(const name of ['Native Mac Storage and error-reporting controls against the installed Rust GUI',
    'Native GPUI Copy capture ID against the same installed App',
    'Native Electron selected-reference control against the installed Rust App',
    'Installed Mac foreground capture and sharing',
    'Early Mac Electron to Rust Settings integration (not native GUI proof)'])
    assert.ok(steps.some((s:any)=>s.name===name),name);
  const renderer=steps.find((s:any)=>s.name==='Mac Desktop policy and renderer checks');
  assert.match(renderer.run,/npm test\n.*npm run test:electron/);
  assert.match(renderer.if,/outputs.desktop == 'true'/);
  assert.equal(renderer['timeout-minutes'],15);
  const client=steps.findIndex((s:any)=>s.id==='client');
  assert.match(steps[client].if,/outputs.client == 'true'/);
  assert.equal(steps[client]['timeout-minutes'],20);
  for(const command of ['cargo build --manifest-path connect/client/Cargo.toml --locked --timings',
    'cargo test --manifest-path connect/client/Cargo.toml --locked --timings --no-run',
    'cargo test --manifest-path connect/client/Cargo.toml --locked --timings -- --test-threads=2'])
    assert.ok(steps[client].run.includes(command));
  assert.ok(steps.findIndex((s:any)=>s.run?.includes("CACHE_ON_FAILURE=true"))>client);
  assert.equal(jobs.rust['timeout-minutes'],60);
  assert.ok(steps.filter((s:any)=>s.name==='Mac Desktop policy and renderer checks'||s.id==='client')
    .every((s:any)=>s.if.includes('!inputs.release_receipt')),'manual calls execute only their original independent suites');
});

test('a failed packed client command propagates and cleans its private temporary root', t => {
  const job=mkdtempSync(join(tmpdir(),'apparent-dev-packed-client-'));
  t.after(()=>rmSync(job,{recursive:true,force:true}));
  mkdirSync(join(job,'bin'));mkdirSync(join(job,'home'));
  writeFileSync(join(job,'bin/cargo'),'#!/bin/sh\nprintf "%s\\n" "$1" >> "$PROBE_CALLS"\nexit 19\n',{mode:0o700});
  const result=spawnSync('bash',['-eo','pipefail','-c',jobs.rust.steps.find((s:any)=>s.id==='client').run],{
    cwd:root,encoding:'utf8',env:{...process.env,HOME:join(job,'home'),PATH:join(job,'bin')+':'+process.env.PATH,
      PROBE_CALLS:join(job,'calls'),APPARENT_TIMING_FILE:join(job,'timings')}});
  assert.equal(result.status,19,result.stderr);
  assert.equal(readFileSync(join(job,'calls'),'utf8'),'build\n');
  assert.deepEqual(readdirSync(join(job,'home')),[]);
});

test('a native exemption must receive the selector native-free plan, never an inconsistent or unknown plan', () => {
  const step=jobs.rust.steps.find((s:any)=>s.name==='Reject an inconsistent Mac native exemption');
  for(const [plan,success] of [[JSON.stringify(suitePlan(['public/site/src/main.tsx'])),true],
    [JSON.stringify(suitePlan(null)),false],['malformed',false]] as const) {
    const result=spawnSync('bash',['-eo','pipefail','-c',step.run],{cwd:root,encoding:'utf8',env:{...process.env,VERIFICATION_PLAN:plan}});
    assert.equal(result.status===0,success,result.stderr);
  }
  for(const flag of ['root','engine']) {
    const outputs={root:'false',engine:'false',desktop:'false',client:'false',[flag]:'true'};
    const inputs={runner:'macos-15-intel',mac_rust:false,release_receipt:false};
    assert.equal(enabled(jobs.rust.if,inputs,outputs),true,'inconsistent native-only plans must enter the rejection guard');
  }
});
