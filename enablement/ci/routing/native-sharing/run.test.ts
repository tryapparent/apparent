import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {YAML} from 'bun';
import {suitePlan} from '../consumers.ts';
import {connectPlan} from '../connect.ts';
import {covers} from '../evidence.ts';
import {unionPlan, sharedNative, nativeRequired, type Identity} from './run.ts';
const full = suitePlan(null), web = connectPlan(suitePlan(['connect/web/src/main.tsx']));
const who: Identity = {sha:'a'.repeat(40), tree:'b'.repeat(40), run:'42', attempt:'2',
  workflow:'tryapparent/apparent/.github/workflows/checks.yml@refs/heads/main'};
const receipt = {...who, schema:1, plan:full, macPlan:full, linux:true, macos:true};
const workflow = (name: string) => YAML.parse(readFileSync(new URL(`../../../../.github/workflows/${name}`, import.meta.url), 'utf8')) as any;

test('union covers overlap and standalone Connect without dropping Capture native/renderer suites', () => {
  for (const paths of [['connect/service/src/worker.ts'], ['connect/web/src/main.tsx'], ['capture/engine/runtime/mod.rs']]) {
    const capture = suitePlan(paths), connect = connectPlan(capture);
    const union = unionPlan(capture, connect);
    assert.ok(covers(union, capture)); assert.ok(covers(union, connect));
  }
  assert.equal(nativeRequired(web), false);
  const projected = {...full, root:false, engine:false, client:false};
  const union = unionPlan(projected, connectPlan(full));
  assert.equal(union.root,true); assert.equal(union.client,true); assert.equal(union.desktop,true);
});

test('only same workflow, head, tree, run and attempt with full successful platform coverage can substitute', () => {
  const check = (value: unknown) => sharedNative(JSON.stringify(value), who, connectPlan(full));
  assert.equal(check(receipt), true);
  for (const key of Object.keys(who)) assert.equal(check({...receipt,[key]:'other'}),false,key);
  for (const key of ['linux','macos']) for (const value of [false,'true','success',null,undefined])
    assert.equal(check({...receipt,[key]:value}),false,`${key}:${value}`);
  for (const raw of [undefined,'','null','{}','invalid']) assert.equal(sharedNative(raw,who,full),false);
  for (const key of ['plan','macPlan']) for (const value of [web,{},null]) assert.equal(check({...receipt,[key]:value}),false);
  assert.equal(sharedNative(JSON.stringify({...receipt,plan:web,macPlan:web}),who,web),true,'superset covers subset');
  assert.equal(sharedNative(JSON.stringify({...receipt,workflow:'other'}),{...who,workflow:'other'},web),false);
});

test('producer-generated receipts feed the real consumer and failed/absent producers emit no receipt', () => {
  const dir = mkdtempSync('/tmp/apparent-dev-native-receipt-test-');
  const git = (ref: string) => execFileSync('git',['rev-parse',ref],{encoding:'utf8'}).trim();
  const identity = {...who,sha:git('HEAD'),tree:git('HEAD^{tree}')};
  const output = join(dir,'output');
  const needs = {select:{result:'success'},contracts:{result:'success'},linux:{result:'success'},macos:{result:'success'}};
  try {
    const run = (value: unknown) => spawnSync('node',['--experimental-strip-types','enablement/ci/routing/native-sharing/run.ts','--receipt'], {encoding:'utf8',env:{...process.env,
      GITHUB_RUN_ID:who.run,GITHUB_RUN_ATTEMPT:who.attempt,GITHUB_WORKFLOW_REF:who.workflow,GITHUB_OUTPUT:output,
      CI_NEEDS:JSON.stringify(value),VERIFICATION_PLAN:JSON.stringify(full),MAC_VERIFICATION_PLAN:JSON.stringify(full)}});
    const result = run(needs); assert.equal(result.status,0,result.stderr);
    const raw = readFileSync(output,'utf8').trim().replace(/^receipt=/,'');
    assert.equal(sharedNative(raw,identity,connectPlan(full)),true);
    for (const name of ['linux','macos','contracts','select']) for (const result of ['failure','skipped','cancelled','in_progress',undefined]) {
      rmSync(output,{force:true}); const failed = run({...needs,[name]:{result}});
      assert.notEqual(failed.status,0,`${name}:${result}`);
      assert.throws(()=>readFileSync(output));
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('automatic execution has one producer per platform and an acyclic consumer dependency; manual retains cold execution', () => {
  const checks = workflow('checks.yml'), connect = workflow('stream-connect.yml');
  assert.deepEqual(Object.keys(connect.on),['workflow_dispatch','workflow_call']);
  assert.deepEqual(checks.jobs.connect.needs,['select','native-evidence']);
  assert.match(checks.jobs.connect.if,/native-evidence.*result == 'success'/);
  assert.match(checks.jobs.connect.with.shared_native,/native-evidence/);
  for (const platform of ['linux','macos']) {
    assert.equal(checks.jobs[platform].uses,'./.github/workflows/verification-platform.yml');
    assert.match(connect.jobs[platform].if,/needs.select.outputs.shared != 'true'/);
    assert.ok(checks.jobs['native-evidence'].needs.includes(platform));
  }
  assert.match(connect.jobs.admit.if,/needs.select.outputs.shared == 'true'/);
  for (const graph of [checks.jobs,connect.jobs]) {
    const visit = (name: string, stack: string[] = []) => {
      assert.ok(!stack.includes(name),`cycle: ${[...stack,name]}`);
      const parents = graph[name].needs ?? [];
      for (const parent of Array.isArray(parents)?parents:[parents]) visit(parent,[...stack,name]);
    };
    for (const name of Object.keys(graph)) visit(name);
  }
  assert.equal(workflow('verification-platform.yml').on.workflow_call.inputs.portable.default,true);
  assert.equal(workflow('verification-platform.yml').on.workflow_call.inputs.mac_rust.default,true);
});

test('Connect CLI falls back cold on absent or invalid receipt and accepts the actual producer identity', () => {
  const dir = mkdtempSync('/tmp/apparent-dev-native-consumer-test-');
  const git = (ref: string) => execFileSync('git',['rev-parse',ref],{encoding:'utf8'}).trim();
  const valid = {...receipt,sha:git('HEAD'),tree:git('HEAD^{tree}')};
  try {
    for (const [raw, expected] of [[undefined,false],['{}',false],[JSON.stringify({...valid,attempt:'1'}),false],[JSON.stringify(valid),true]] as const) {
      const output = join(dir,'output'); rmSync(output,{force:true});
      const result = spawnSync('bun',['enablement/ci/routing/connect.ts'], {encoding:'utf8',env:{...process.env,
        GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:who.run,GITHUB_RUN_ATTEMPT:who.attempt,
        GITHUB_WORKFLOW_REF:who.workflow,GITHUB_OUTPUT:output,SHARED_NATIVE:raw}});
      assert.equal(result.status,0,result.stderr);
      const values = Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
      assert.equal(values.shared,String(expected)); assert.equal(values.native,'true');
      assert.ok(covers(JSON.parse(values.plan),connectPlan(full)));
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('real selector composition preserves Capture-only exemptions and selects full Connect on affected main', () => {
  const dir = mkdtempSync('/tmp/apparent-dev-native-plan-test-');
  const git = (...args: string[]) => execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  const cli = new URL('./run.ts',import.meta.url).pathname;
  try {
    git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
    execFileSync('mkdir',['-p',join(dir,'capture/desktop/docs'),join(dir,'connect/web/src'),join(dir,'enablement/timing')]);
    const {writeFileSync} = require('node:fs');
    writeFileSync(join(dir,'capture/desktop/docs/linux.md'),'before');
    writeFileSync(join(dir,'enablement/timing/command.ts'),'before');
    writeFileSync(join(dir,'connect/web/src/main.tsx'),'before');git('add','.');git('commit','-qm','base');
    const base = git('rev-parse','HEAD');
    const run = (event: string, capture: typeof full) => {
      const output = join(dir,'output');rmSync(output,{force:true});
      const result = spawnSync('bun',[cli,'--plan'],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:event,
        GITHUB_REF:event==='push'?'refs/heads/main':'refs/pull/1/merge',BASE_SHA:base,GITHUB_SHA:git('rev-parse','HEAD'),GITHUB_OUTPUT:output,
        VERIFICATION_PLAN:JSON.stringify(capture),MAC_VERIFICATION_PLAN:JSON.stringify(capture),MAC_RUST:'false'}});
      assert.equal(result.status,0,result.stderr);
      return Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
    };
    writeFileSync(join(dir,'capture/desktop/docs/linux.md'),'after');git('add','.');git('commit','-qm','capture prose');
    const narrow = suitePlan(['capture/desktop/docs/linux.md']);
    const capture = run('pull_request',narrow);
    assert.equal(capture.connect,'false');assert.deepEqual(JSON.parse(capture.plan),narrow,'no Connect stream must add zero suites');
    git('reset','--hard',base);
    writeFileSync(join(dir,'enablement/timing/command.ts'),'after');git('add','enablement');git('commit','-qm','tooling only');
    const tooling = suitePlan(['enablement/timing/command.ts']);
    const toolingMain = run('push',tooling);
    assert.equal(toolingMain.connect,'false');assert.equal(toolingMain.platform,'false');
    assert.deepEqual(JSON.parse(toolingMain.plan),tooling,'broad event filters must not add Connect consumers');
    git('reset','--hard',base);
    writeFileSync(join(dir,'connect/web/src/main.tsx'),'after');git('add','connect');git('commit','-qm','web only');
    const pr = run('pull_request',web);assert.equal(pr.connect,'true');assert.equal(pr.platform,'false');
    const main = run('push',web);assert.equal(main.connect,'true');assert.equal(main.mac_rust,'true');
    assert.ok(covers(JSON.parse(main.plan),connectPlan(full)));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
