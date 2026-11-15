import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {YAML} from 'bun';
import {suitePlan} from '../consumers.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const workflow = () => YAML.parse(readFileSync(join(root, '.github/workflows/checks.yml'), 'utf8'));
test('qualified fixtures get a named real Mac lane behind cheap guards; Linux admission stays independent', () => {
  const flow = workflow(), job = flow.jobs['fixture-mac'];
  assert.equal(flow.jobs.select.outputs.fixtureMac, '${{ steps.paths.outputs.fixtureMac }}');
  assert.equal(job['runs-on'], 'macos-15-intel');
  assert.deepEqual(job.needs, ['select', 'contracts']);
  assert.equal(job.steps.find((step: any) => step.name === 'Real hook and dependency-install fixtures without native application builds').run, 'node --experimental-strip-types enablement/local-tests/run.ts --fixture-mac');
  const admitted = (select: string, contracts: string, fixtureMac: string, event = 'pull_request', draft = false, cancelled = false) =>
    Function('needs', 'github', 'cancelled', `return (${job.if})`)(
      {select:{result:select,outputs:{fixtureMac}},contracts:{result:contracts}},
      {event_name:event,event:{pull_request:{draft}}}, () => cancelled);
  assert.equal(admitted('success','success','true'), true);
  assert.equal(admitted('success','success','false'), false);
  assert.equal(admitted('failure','success',''), true);
  assert.equal(admitted('success','failure','true'), false);
  assert.equal(admitted('success','success','true','pull_request',true), false);
  assert.equal(admitted('success','success','true','push'), true);
  assert.equal(admitted('success','success','true','push',false,true), false);
  for (const name of ['macos-admission', 'native-evidence']) {
    assert.ok(flow.jobs[name].needs.includes('fixture-mac'));
    assert.equal(flow.jobs[name].steps.at(-1).env.FIXTURE_MAC, '${{ needs.select.outputs.fixtureMac }}');
  }
  assert.ok(flow.jobs['tree-evidence'].needs.includes('fixture-mac'));
  assert.ok(!flow.jobs['linux-admission'].needs.includes('fixture-mac'));
});

test('real admission and shared receipts cannot waive required fresh Mac fixture proof', () => {
  const empty = suitePlan(['enablement/local-tests/reuse.test.ts']);
  const dir = mkdtempSync('/tmp/apparent-dev-fixture-admission-');
  try {
    const env = {...process.env, VERIFICATION_PLAN:JSON.stringify(empty), MAC_VERIFICATION_PLAN:JSON.stringify(empty),
      FIXTURE_MAC:'true', VERIFY_PLATFORM:'macos', GITHUB_OUTPUT:join(dir,'output'),
      CI_REUSE:JSON.stringify({macos:'true','fixture-mac':'true'})};
    for (const outcome of ['failure','cancelled','skipped',undefined,'success']) {
      const needs = {select:{result:'success'},contracts:{result:'success'},'fixture-mac':{result:outcome}};
      for (const [entry,flag] of [['enablement/ci/routing/evidence.ts','--admit'],
        ['enablement/ci/routing/native-sharing/run.ts','--receipt']]) {
        const result = spawnSync('node',['--experimental-strip-types',entry,flag],
          {cwd:root,env:{...env,CI_NEEDS:JSON.stringify(needs)},encoding:'utf8'});
        assert.equal(result.status === 0, outcome === 'success', `${entry}:${outcome}\n${result.stderr}`);
      }
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
