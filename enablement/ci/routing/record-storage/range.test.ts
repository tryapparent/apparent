import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {storageControllers, nativeStorageGraph, recordBendManifest} from './qualify.ts';
import {YAML} from 'bun';
import {accepted} from '../evidence.ts';

test('real Git controller changes preserve Desktop renderer and main packaging, omit native compilation only with proof', {timeout: 15_000}, () => {
  const root = mkdtempSync(join(tmpdir(), 'storage-routing-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (...args: string[]) => execFileSync('git', args, {cwd: root, env, encoding: 'utf8'}).trim();
  const selectRange = (base: string, head: string, _cwd: string) => JSON.parse(execFileSync(process.execPath,
    ['--experimental-strip-types', new URL('../../select.ts', import.meta.url).pathname], {
      cwd: root, encoding: 'utf8', env: {...env, BASE_SHA: base, GITHUB_SHA: head,
        GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: join(root, '.git', 'outputs')},
    }));
  const write = (path: string, text: string) => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), text);};
  const commit = () => {git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic'); return git('rev-parse', 'HEAD');};
  const sources = new Map([...storageControllers].map(path => [path, readFileSync(new URL('../../../../' + path, import.meta.url), 'utf8')]));
  try {
    git('init', '-q');
    for (const [path, source] of sources) write(path, source);
    for (const path of nativeStorageGraph.keys()) write(path, readFileSync(new URL('../../../../' + path, import.meta.url), 'utf8'));
    const manifest = JSON.parse(readFileSync(new URL('../../../../' + recordBendManifest, import.meta.url), 'utf8'));
    manifest.modules.push('notes/routing-fixture.bend');
    write(recordBendManifest, JSON.stringify(manifest));
    const base = commit();
    for (const [path, source] of sources) {
      const implementation = source.replace('generation === this.#generation', 'this.#generation === generation');
      assert.notEqual(source, implementation);
      git('reset', '--hard', base);
      write(path, implementation);
      const head = commit(), result = selectRange(base, head, root);
      assert.deepEqual(result.qualifiedStorageControllers, [path]);
      assert.equal(result.plan.root, false); assert.equal(result.plan.engine, false);
      assert.equal(result.plan.client, false); assert.equal(result.plan.desktop, true);
      assert.equal(result.plan.onboarding, false);
      assert.equal(result.installer, true); assert.equal(result.publicationStreams.capture, true);
      assert.equal(result.mac_rust, false);
      assert.equal(result.platform, true);
      const workflow = (name: string) => YAML.parse(readFileSync(new URL('../../../../.github/workflows/' + name, import.meta.url), 'utf8'));
      const evaluate = (expression: string, inputs: object, needs: object) => Function('inputs', 'needs', `return (${expression});`)(inputs, needs);
      const capture = workflow('checks.yml').jobs;
      assert.equal(capture.select.outputs.plan, '${{ steps.paths.outputs.plan }}');
      assert.equal(capture.select.outputs.mac_rust, '${{ steps.paths.outputs.mac_rust }}');
      const platform = workflow('verification-platform.yml').jobs;
      const needs = {select: {outputs: {root: 'false', engine: 'false', client: 'false', desktop: 'true'}}};
      assert.equal(evaluate(platform['desktop-ui'].if, {runner: 'ubuntu-24.04', release_receipt: false}, needs), true);
      assert.equal(evaluate(platform.rust.if, {runner: 'ubuntu-24.04', release_receipt: false}, needs), false);
      const linuxTests = platform['desktop-ui'].steps.map((step: {run?: string}) => step.run ?? '').join('\n');
      assert.match(linuxTests, /npm test/); assert.match(linuxTests, /npm run test:electron/);
      // Native admission cannot accept a failed or missing selected renderer workflow.
      const cheap = {contracts: {result: 'success'}, select: {result: 'success'}};
      for (const state of ['failure', 'skipped', 'cancelled', undefined])
        assert.equal(accepted({...cheap, linux: {result: state}, macos: {result: 'success'}}, {linux: true, macos: true}, {}), false);
      assert.equal(accepted({...cheap, linux: {result: 'success'}, macos: {result: 'success'}}, {linux: true, macos: true}, {}), true);
      // A changed shared validator retains its actual cleanup/native consumers.
      write('record/storage/src/policy.ts', 'export const changed = true;');
      assert.equal(selectRange(base, commit(), root).plan.root, true);
      git('reset', '--hard', base);
      write(path, source.replace('dispose() {', 'dispose() { import("node:fs");'));
      assert.equal(selectRange(base, commit(), root).plan.root, true);
      git('reset', '--hard', base);
      write(path, source.replace('read():', 'read(extra: string):'));
      assert.equal(selectRange(base, commit(), root).plan.root, true);
      git('reset', '--hard', base);
      write(path, implementation);
      write('capture/new-consumer.rs', 'const SOURCE: &str = include_str!("record/storage/src/location-controller.ts");');
      assert.equal(selectRange(base, commit(), root).qualifiedStorageControllers.length, 0);
      git('reset', '--hard', base);
      write(path, implementation);
      write('record/storage/src/retention/worker.ts', 'import "../index.js";');
      assert.equal(selectRange(base, commit(), root).qualifiedStorageControllers.length, 0);
      git('reset', '--hard', base);
      rmSync(join(root, path)); symlinkSync('missing.ts', join(root, path));
      assert.equal(selectRange(base, commit(), root).plan.root, true);
      git('reset', '--hard', base);
      rmSync(join(root, path));
      assert.equal(selectRange(base, commit(), root).plan.root, true);
      git('reset', '--hard', base);
      git('mv', path, path + '.renamed.ts');
      assert.equal(selectRange(base, commit(), root).plan.root, true);
      git('reset', '--hard', base);
      write('record/storage/src/new-controller.ts', source);
      assert.equal(selectRange(base, commit(), root).plan.root, true);
    }
    git('reset', '--hard', base);
    const retention = 'record/storage/src/retention-controller.ts';
    write(retention, sources.get(retention)!.replace('this.#generation++;', 'this.#generation += 1;'));
    const feedback = 'record/storage/src/retention/feedback.bend';
    write(feedback, readFileSync(join(root, feedback), 'utf8') + '\n');
    const providerChange = selectRange(base, commit(), root);
    assert.deepEqual(providerChange.qualifiedStorageControllers, []);
    assert.equal(providerChange.plan.root, true);
    git('reset', '--hard', base);
    write(recordBendManifest, JSON.stringify({...manifest, inputs: manifest.inputs.filter((path: string) => path !== 'storage/')}));
    const manifestBase = commit();
    write(retention, sources.get(retention)!.replace('this.#generation++;', 'this.#generation += 1;'));
    const manifestChange = selectRange(manifestBase, commit(), root);
    assert.deepEqual(manifestChange.qualifiedStorageControllers, []);
    assert.equal(manifestChange.plan.root, true);
    assert.equal(selectRange('missing', 'missing', root).plan.root, true);
  } finally {rmSync(root, {recursive: true, force: true});}
});
