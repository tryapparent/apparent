import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {YAML} from 'bun';
import {authenticatedSuites} from '../routing/evidence.ts';
import {suitePlan} from '../routing/consumers.ts';
const workflow = YAML.parse(readFileSync('.github/workflows/verification-platform.yml', 'utf8'));
const jobs = workflow.jobs, native = jobs['native-acceptance'];
const evalIf = (expression: string, inputs: any, needs: any, cancelled = false) =>
  Function('inputs', 'needs', 'github', 'cancelled', `return (${expression})`)(inputs, needs,
    {ref: 'refs/heads/main', repository: 'tryapparent/apparent', event_name: 'push'}, () => cancelled);
test('normal failed-job retry consumes immutable dependency outputs without compile/package commands', () => {
  assert.deepEqual(native.needs, ['select', 'rust']);
  assert.equal(native['runs-on'], 'macos-15-intel');
  const restore = native.steps.find((s: any) => s.id === 'install');
  assert.equal(restore.run, 'node --experimental-strip-types capture/desktop/enablement/native-candidate/restore.ts');
  assert.equal(restore.env.CANDIDATE_ID, '${{ needs.rust.outputs.candidate_id }}');
  assert.equal(restore.env.CANDIDATE_DIGEST, '${{ needs.rust.outputs.candidate_digest }}');
  assert.equal(restore.env.CANDIDATE_ATTEMPT, '${{ needs.rust.outputs.candidate_attempt }}');
  assert.equal(jobs.rust.outputs.candidate_id, '${{ steps.candidate_upload.outputs.artifact-id }}');
  assert.equal(jobs.rust.outputs.candidate_digest, '${{ steps.candidate_upload.outputs.artifact-digest }}');
  const shell = native.steps.map((s: any) => s.run ?? '').join('\n');
  assert.doesNotMatch(shell, /cargo |install-app\.sh|--retain-installed/);
  for (const [id, cap] of [['native_storage', 10], ['native_copy_id', 4], ['native_reference', 4], ['native_foreground', 6]]) {
    const step = native.steps.find((s: any) => s.id === id);
    assert.ok(step); assert.equal(step['timeout-minutes'], cap); assert.equal(step['continue-on-error'], undefined);
    assert.ok(native.steps.indexOf(restore) < native.steps.indexOf(step));
  }
  assert.match(native.steps.find((s: any) => s.id === 'native_foreground').if, /steps.install.outcome == 'success'/);
  assert.ok(native.steps.filter((s: any) => s.uses === 'actions/upload-artifact@v4').every((s: any) =>
    s.if?.includes('always()') && s.with.name.endsWith('-${{ github.run_attempt }}')), 'preserve every failed attempt without artifact-name collisions');
});
test('root Mac plans require fresh GUI success; other platform plans skip it without blocking release-ready', () => {
  for (const runner of ['macos-15-intel', 'ubuntu-24.04']) for (const root of ['true', 'false', '']) {
    const inputs = {runner, release_receipt: true};
    const select = {result: 'success', outputs: {root}};
    const required = runner === 'macos-15-intel' && root === 'true';
    assert.equal(evalIf(native.if, inputs, {select}), required);
    for (const result of ['success', 'skipped', 'failure', 'cancelled', '']) {
      const needs = {select, rust: {result: 'success'}, 'desktop-ui': {result: 'skipped'},
        'connect-client': {result: 'skipped'}, 'native-acceptance': {result}};
      assert.equal(evalIf(jobs['release-ready'].if, inputs, needs), required ? result === 'success' : result === 'skipped');
      assert.equal(evalIf(jobs['release-ready'].if, inputs, needs, true), false);
      assert.equal(evalIf(jobs['release-ready'].if, inputs, {...needs, rust: {result: 'failure'}}), false);
    }
  }
});
test('retained archive or green compilation never substitutes for fresh native result in exact-tree receipts', () => {
  const plan = suitePlan(null);
  const inventory = ['contracts','select','tree-evidence','macos / select','macos / platform (macos-15-intel)']
    .map(name => ({name, status: 'completed', conclusion: 'success'}));
  assert.equal(authenticatedSuites(inventory, plan, plan).macos, false);
  for (const conclusion of ['success','failure','cancelled','skipped',null]) {
    const actual = [...inventory, {name: 'macos / Native acceptance (macos-15-intel)', status: 'completed', conclusion}];
    assert.equal(authenticatedSuites(actual, plan, plan).macos, conclusion === 'success');
  }
  assert.equal(authenticatedSuites(inventory, plan, {...plan, root: false}).macos, true);
});
