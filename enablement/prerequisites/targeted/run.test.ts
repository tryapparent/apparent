import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync, realpathSync, symlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import {pathToFileURL} from 'node:url';

function fixture(t: any, failure = '') {
  const root = realpathSync(mkdtempSync('/tmp/apparent-dev-targeted-electron-'));
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
    'test:electron:mac': canonical.scripts['test:electron:mac'],
    build: 'node --experimental-strip-types build.ts',
    'build:prepare': 'node phase.ts prepare',
    'build:emit': 'node phase.ts emit',
  }}));
  put('build.ts', `import {appendFileSync} from 'node:fs'; appendFileSync('trace', 'build\\n'); process.exit(${failure === 'build' ? 23 : 0});`);
  put('phase.ts', `import {appendFileSync} from 'node:fs';const phase=process.argv[2];appendFileSync('trace',phase+'\\n');
    if(phase===${JSON.stringify(failure)} || (${JSON.stringify(failure)}==='build' && phase==='prepare'))process.exit(23);`);
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
  const macFiles=canonical.scripts['test:electron:mac'].split(' -- ')[1].split(' ');
  assert.equal(macFiles.length,2);
  macFiles.forEach((file:string,index:number)=>put(file,
    (file.endsWith('.ts')?"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);\n":'')+
    readFileSync(resolve(frontend,`tests/${['a','b'][index]}.cts`),'utf8')));
  put('tests/unrelated.smoke.ts', "throw Error('Unrelated renderer suite must remain outside the Mac entrypoint');");
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT; // Exercise a real independent CLI, not a nested Node test worker.
  return {root, frontend, put, macFiles, runAt: (platform: string, files = macFiles) => spawnSync(process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e',
      `import {targetedElectron} from ${JSON.stringify(pathToFileURL(resolve(root,'enablement/prerequisites/targeted/run.ts')).href)};
      process.exitCode=targetedElectron(${JSON.stringify(root)},JSON.parse(process.argv[1]),process.argv[2]);`,
      JSON.stringify(files), platform], {cwd: frontend, encoding: 'utf8', env}),
    run: (files = ['tests/a.cts', 'tests/b.cts']) => spawnSync('npm',
    ['run', 'test:electron:targeted', '--', ...files], {cwd: frontend, encoding: 'utf8', env}),
    runMac: () => spawnSync('npm',['run','test:electron:mac'],{cwd:frontend,encoding:'utf8',env}),
    trace: () => readFileSync(resolve(frontend, 'trace'), 'utf8')};
}

test('actual Mac package entrypoint prepares and runs only its bounded files, preserving failures', t => {
  for(const failure of ['', 'runtime', 'build', 'test']) {
    const f=fixture(t,failure),result=f.runMac();
    assert.equal(result.status===0,failure==='',result.stdout+result.stderr);
    const phases = process.platform === 'darwin' ? 'prepare\nemit\n' : 'build\n';
    assert.equal(f.trace(),failure==='runtime'?'install\n':failure==='build'?
      'install\n'+(process.platform === 'darwin' ? 'prepare\n' : 'build\n'):
      'install\n'+phases+'a:start\na:end\nb:start\nb:end\n');
  }
});

test('only the exact ordered canonical Mac pair omits global checks, with serial real workers', t => {
  const f = fixture(t), result = f.runAt('darwin');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.trace(), 'install\nprepare\nemit\na:start\na:end\nb:start\nb:end\n');
});

test('mixed, unknown, extra, duplicate, reordered, alias and Linux selections retain full build', t => {
  // Stop at a real failing npm build: selection is the changed boundary, not
  // another successful execution of the unchanged smoke workers in every case.
  for (const variant of ['mixed', 'unknown', 'extra', 'duplicate', 'reversed', 'alias', 'linux']) {
    const f = fixture(t, 'build');
    f.put('tests/other.cts', "const {test}=require('node:test');test('other',()=>{});");
    let files = [...f.macFiles];
    if (variant === 'mixed') files[1] = 'tests/a.cts';
    if (variant === 'unknown') files = ['tests/other.cts'];
    if (variant === 'extra') files.push('tests/other.cts');
    if (variant === 'duplicate') files.push(files[0]);
    if (variant === 'reversed') files.reverse();
    if (variant === 'alias') files[0] = './' + files[0];
    const result = f.runAt(variant === 'linux' ? 'linux' : 'darwin', files);
    assert.notEqual(result.status, 0, variant + result.stdout + result.stderr);
    assert.equal(f.trace(), 'install\nbuild\n', variant);
  }
});

test('canonical-looking symlink redirects use full build; unsafe redirects fail before setup', t => {
  const f = fixture(t, 'build'), original = resolve(f.frontend, f.macFiles[0]);
  rmSync(original); symlinkSync(resolve(f.frontend, 'tests/a.cts'), original);
  const result = f.runAt('darwin');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.trace(), 'install\nbuild\n');
  const unsafe = fixture(t), file = resolve(unsafe.frontend, unsafe.macFiles[0]);
  rmSync(file); writeFileSync(resolve(unsafe.root, 'outside.ts'), 'export {};'); symlinkSync(resolve(unsafe.root, 'outside.ts'), file);
  assert.notEqual(unsafe.runAt('darwin').status, 0);
  assert.equal(existsSync(resolve(unsafe.frontend, 'trace')), false);
});

test('short preparation preserves lazy runtime, phase failure, and genuine assertion propagation', t => {
  for (const failure of ['runtime', 'prepare', 'emit', 'test']) {
    const f = fixture(t, failure), result = f.runAt('darwin');
    assert.notEqual(result.status, 0, failure);
    const expected = failure === 'runtime' ? 'install\n' : failure === 'prepare' ? 'install\nprepare\n'
      : failure === 'emit' ? 'install\nprepare\nemit\n' : 'install\nprepare\nemit\na:start\na:end\nb:start\nb:end\n';
    assert.equal(f.trace(), expected);
  }
});

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

// Freeze the previously shipped command inventory, not a second implementation
// of phase selection. Moving a native producer/check changes this contract.
const buildInventory = [
  'node --experimental-strip-types ../../../../composition/onboarding/prepare.ts',
  ...['record-capture-request', 'record-media'].map(name => `node --experimental-strip-types scripts/build-${name}.ts`),
  'node --experimental-strip-types scripts/agent-media/build.ts',
  ...['notes', 'storage-policy', 'updates', 'pill'].map(name => `node --experimental-strip-types scripts/build-${name}.ts`),
  'python3 ../../../../shared/ui/scripts/check-theme.py',
  'tsc --noEmit', 'npm run typecheck:settings-native', 'npm run typecheck:installer',
  'vite build', 'node --experimental-strip-types scripts/build-connect-transport.ts',
];
const frontendPackage = 'capture/desktop/ui/frontend/package.json';

test('producer phase inventory preserves full order, native/theme preparation and all noEmit checks', () => {
  const {scripts} = JSON.parse(readFileSync(frontendPackage, 'utf8'));
  assert.equal(scripts.build, buildInventory.join(' && '), 'ordinary and targeted builds use the same producers');
  assert.deepEqual(['build:prepare', 'build:typecheck', 'build:emit'].flatMap(name => scripts[name].split(' && ')), buildInventory);
  assert.deepEqual(scripts['build:typecheck'].split(' && '), buildInventory.slice(9, 12));
  for (const config of ['tsconfig.json', 'scripts/settings-native/tsconfig.json']) {
    const {compilerOptions} = JSON.parse(readFileSync(resolve('capture/desktop/ui/frontend', config), 'utf8'));
    assert.equal(compilerOptions.noEmit, true);
    assert.ok(!compilerOptions.incremental && !compilerOptions.composite, 'no build-info side effect');
  }
  assert.match(scripts['typecheck:installer'], /^tsc --noEmit /);
  assert.match(scripts['test:electron'], /&& npm run build &&/);
  const workflow = readFileSync('.github/workflows/verification-platform.yml', 'utf8');
  assert.match(workflow, /if: runner.os == 'Linux'\n        shell: bash\n        run: xvfb-run -a npm run test:electron/);
  const settings = readFileSync('capture/desktop/scripts/packaging/stage-settings.py', 'utf8');
  assert.ok(settings.includes('subprocess.run(["npm", "run", "build"], cwd=frontend, env=env, check=True)'));
});
