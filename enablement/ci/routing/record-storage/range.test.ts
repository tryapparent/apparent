import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {storageControllers, nativeStorageGraph} from './qualify.ts';
import {YAML} from 'bun';
import {accepted} from '../evidence.ts';

test('real Git controller changes preserve Desktop renderer and main packaging, omit native compilation only with proof', () => {
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
    // Include the real moved install consumer in the reference audit.
    const install = 'capture/desktop/enablement/local-tests/desktop-install.ts';
    write(install, readFileSync(new URL('../../../../' + install, import.meta.url), 'utf8'));
    const base = commit();
    for (const [path, source] of sources) {
      git('reset', '--hard', base);
      write(path, source.replace('generation === this.#generation', 'this.#generation === generation'));
      const head = commit(), result = selectRange(base, head, root);
      assert.deepEqual(result.qualifiedStorageControllers, [path]);
      assert.equal(result.plan.root, false); assert.equal(result.plan.engine, false);
      assert.equal(result.plan.client, false); assert.equal(result.plan.desktop, true);
      assert.equal(result.plan.onboarding, false);
      assert.equal(result.installer, true); assert.equal(result.publicationStreams.capture, true);
      assert.equal(result.mac_rust, false);
      const sharedFile = join(root, '.git', 'shared');
      execFileSync(process.execPath, ['--experimental-strip-types',
        new URL('../native-sharing/run.ts', import.meta.url).pathname, '--plan'], {
        cwd: root, env: {...env, BASE_SHA: base, GITHUB_SHA: head, GITHUB_EVENT_NAME: 'pull_request',
          VERIFICATION_PLAN: JSON.stringify(result.plan), MAC_VERIFICATION_PLAN: JSON.stringify(result.mac_plan),
          MAC_RUST: String(result.mac_rust), GITHUB_OUTPUT: sharedFile},
      });
      const shared = Object.fromEntries(readFileSync(sharedFile, 'utf8').trim().split('\n').map(line => {
        const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
      }));
      assert.deepEqual(JSON.parse(shared.plan), result.plan);
      assert.equal(shared.platform, 'true'); assert.equal(shared.mac_rust, 'false');
      const workflow = (name: string) => YAML.parse(readFileSync(new URL('../../../../.github/workflows/' + name, import.meta.url), 'utf8'));
      const evaluate = (expression: string, inputs: object, needs: object) => Function('inputs', 'needs', `return (${expression});`)(inputs, needs);
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
      write(path, source.replace('generation === this.#generation', 'this.#generation === generation'));
      write('capture/new-consumer.rs', 'const SOURCE: &str = include_str!("record/storage/src/location-controller.ts");');
      assert.equal(selectRange(base, commit(), root).qualifiedStorageControllers.length, 0);
      git('reset', '--hard', base);
      write(path, source.replace('generation === this.#generation', 'this.#generation === generation'));
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
    assert.equal(selectRange('missing', 'missing', root).plan.root, true);
  } finally {rmSync(root, {recursive: true, force: true});}
});
