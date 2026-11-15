import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t: any, failure = '') {
  const root = mkdtempSync('/tmp/apparent-dev-targeted-electron-');
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const frontend = resolve(root, 'capture/desktop/ui/frontend');
  const put = (name: string, text: string) => {
    const target = resolve(frontend, name);
    mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, text);
  };
  mkdirSync(resolve(root, 'enablement/prerequisites/targeted'), {recursive: true});
  for (const name of ['../native.ts', 'run.ts']) cpSync(
    resolve(import.meta.dirname, name), resolve(root, 'enablement/prerequisites/targeted', name));
  const canonical = JSON.parse(readFileSync('capture/desktop/ui/frontend/package.json', 'utf8'));
  put('package.json', JSON.stringify({type: 'module', scripts: {
    'test:electron:targeted': canonical.scripts['test:electron:targeted'],
    build: 'node --experimental-strip-types build.ts',
  }}));
  put('build.ts', `import {appendFileSync} from 'node:fs'; appendFileSync('trace', 'build\\n'); process.exit(${failure === 'build' ? 23 : 0});`);
  // A fresh synthetic lazy installer: no binary or ready marker exists yet.
  put('node_modules/electron/index.js', `const fs = require('node:fs');
if (!fs.existsSync(__dirname+'/bin')) {
 fs.appendFileSync(process.cwd()+'/trace', 'install\\n');
 ${failure === 'runtime' ? "throw Error('setup failed');" : ''}
 fs.writeFileSync(__dirname+'/bin', 'synthetic executable', {mode:0o700});
}
module.exports = __dirname+'/bin';`);
  for (const name of ['a', 'b']) put(`tests/${name}.cts`, `
const {test} = require('node:test'); const fs = require('node:fs');
test('${name}', async () => {
 if (!fs.existsSync('node_modules/electron/bin')) throw Error('worker reached lazy installer');
 require('electron');
 fs.mkdirSync('active-worker');
 fs.appendFileSync('trace', '${name}:start\\n');
 await new Promise(resolve => setTimeout(resolve, 100));
 fs.appendFileSync('trace', '${name}:end\\n'); fs.rmdirSync('active-worker');
 ${failure === 'test' && name === 'a' ? "throw Error('genuine assertion');" : ''}
});`);
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT; // Exercise a real independent CLI, not a nested Node test worker.
  return {root, frontend, run: (files = ['tests/a.cts', 'tests/b.cts']) => spawnSync('npm',
    ['run', 'test:electron:targeted', '--', ...files], {cwd: frontend, encoding: 'utf8', env}),
    trace: () => readFileSync(resolve(frontend, 'trace'), 'utf8')};
}

test('actual package entrypoint prepares a fresh lazy runtime before build and serial test processes', t => {
  const f = fixture(t);
  assert.equal(existsSync(resolve(f.frontend, 'node_modules/electron/bin')), false);
  const result = f.run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.trace(), 'install\nbuild\na:start\na:end\nb:start\nb:end\n');
  assert.equal(f.run().status, 0);
  assert.equal(f.trace().split('install\n').length, 2, 'no repeated install');
});
test('runtime setup failure stops before build or test work', t => {
  const f = fixture(t, 'runtime'), result = f.run();
  assert.notEqual(result.status, 0); assert.match(result.stderr, /setup failed/);
  assert.equal(f.trace(), 'install\n');
});
test('missing selected source stops before lazy setup or build', t => {
  const f = fixture(t); const result = f.run(['tests/missing.cts']);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(resolve(f.frontend, 'trace')), false);
});
test('build failure stops before tests', t => {
  const f = fixture(t, 'build'); assert.notEqual(f.run().status, 0);
  assert.equal(f.trace(), 'install\nbuild\n');
});
test('genuine test failure is preserved while remaining selected tests execute', t => {
  const f = fixture(t, 'test'), result = f.run();
  assert.notEqual(result.status, 0); assert.match(result.stdout, /genuine assertion/);
  assert.equal(f.trace(), 'install\nbuild\na:start\na:end\nb:start\nb:end\n');
});
test('flags, absent selections and paths outside source test owners are refused before preparation', t => {
  const f = fixture(t);
  for (const files of [[], ['--test-concurrency=8'], ['build.ts'], ['../outside.ts']]) {
    assert.notEqual(f.run(files).status, 0);
    assert.equal(existsSync(resolve(f.frontend, 'trace')), false);
  }
});
