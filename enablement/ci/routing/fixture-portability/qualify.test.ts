import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fixtureInputs, qualifyFixtures, fixturePlatformBoundary} from './qualify.ts';
import {moduleImports} from './imports.ts';
import {selectRange} from '../../select.ts';
import {selection, commands, contractTests, toolingCommands} from '../../../local-tests/run.ts';

const source = process.cwd();
const blobs = () => new Map([...fixtureInputs].map(path => [path, readFileSync(join(source, path), 'utf8')]));
test('module parsing ignores synthetic source strings but sees same-line production imports', () => {
  assert.deepEqual(moduleImports(`const fixture = "import './native.ts';";`), []);
  assert.deepEqual(moduleImports(`const before = 1; import './native.ts';`), ['./native.ts']);
  assert.deepEqual(moduleImports(`function before() {} /* consumer */ import './native.ts';`), ['./native.ts']);
  assert.equal(moduleImports('import {'), null);
  const files = blobs();
  files.set('enablement/local-tests/run.ts', `const before = 1; import './fixtures/runner.ts';`);
  assert.deepEqual(qualifyFixtures(files, [...fixtureInputs]), []);
  files.delete('enablement/local-tests/run.ts');
  files.set('capture/desktop/consumer.ts', "import '@fixtures/runner';");
  assert.deepEqual(qualifyFixtures(files, [...fixtureInputs]), []);
  files.delete('capture/desktop/consumer.ts');
  files.set('tsconfig.json', JSON.stringify({compilerOptions:{paths:{'@hooks/*':['enablement/local-tests/fixtures/*']}}}));
  assert.deepEqual(qualifyFixtures(files, [...fixtureInputs]), []);
  files.delete('tsconfig.json');
  const py = 'enablement/tests/test_pre_push_guard.py';
  files.set(py, files.get(py) + '\ndef added():\n    import unknown_provider\n');
  assert.deepEqual(qualifyFixtures(files, [...fixtureInputs]), []);
});
test('audited real fixture sources qualify; new reachable helpers/tests execute, unknown files do not', () => {
  const files = blobs();
  for (const path of ['enablement/local-tests/run.ts', 'enablement/ci/select.test.ts']) files.set(path, readFileSync(join(source, path), 'utf8'));
  assert.deepEqual(qualifyFixtures(files, [...fixtureInputs]), [...fixtureInputs]);
  assert.equal(fixturePlatformBoundary('', "execFileSync('cargo', ['test']);"), true);
  const helper = 'enablement/local-tests/fixtures/helper.ts';
  files.set(helper, 'export const value = 1;');
  assert.deepEqual(qualifyFixtures(files, [helper]), []);
  files.set('enablement/local-tests/fixtures/runner.ts', files.get('enablement/local-tests/fixtures/runner.ts') + "\nimport {value} from './helper.ts';\n");
  assert.deepEqual(qualifyFixtures(files, [helper]), [helper]);
  const extra = 'enablement/local-tests/fixtures/new.test.ts';
  files.set(extra, "import {test} from 'node:test'; test('new', () => {});\n");
  assert.deepEqual(qualifyFixtures(files, [extra]), [extra]);
  for (const dependency of ['../../native/provider.ts', 'electron', 'node:ffi']) {
    const changed = blobs();
    changed.set('enablement/local-tests/run.test.ts', changed.get('enablement/local-tests/run.test.ts') + `\nimport '${dependency}';\n`);
    assert.deepEqual(qualifyFixtures(changed, [...fixtureInputs]), [], dependency);
  }
  for (const consumer of ['capture/desktop/entry.ts', 'build.rs', 'enablement/local-tests/run.ts']) {
    const changed = blobs();
    changed.set(consumer, consumer === 'build.rs' ? 'include_str!("enablement/local-tests/fixtures/runner.ts");' :
      "import './fixtures/runner.ts';\nimport '../../enablement/local-tests/fixtures/runner.ts';");
    assert.deepEqual(qualifyFixtures(changed, [...fixtureInputs]), [], consumer);
  }
});

test('complete Git deltas use one local/CI authority, safe additions execute and boundaries fail closed', () => {
  const dir = mkdtempSync('/tmp/apparent-dev-portable-');
  const env = {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'};
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].includes(key)) delete env[key];
  const git = (...args: string[]) => execFileSync('git', args, {cwd: dir, env, encoding: 'utf8', stdio: ['ignore','pipe','pipe']}).trim();
  const put = (path: string, text: string) => {mkdirSync(dirname(join(dir, path)), {recursive: true}); writeFileSync(join(dir, path), text);};
  const commit = () => {git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD');};
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    for (const [path, text] of blobs()) put(path, text);
    const base = commit();
    put('enablement/local-tests/fixtures/runner.ts', readFileSync(join(source, 'enablement/local-tests/fixtures/runner.ts'), 'utf8') + '\n// fixture repair\n');
    let head = commit();
    const accepted = selectRange(base, head, dir);
    assert.deepEqual(accepted.selected, ['tooling']);
    assert.equal(accepted.macos, false); assert.equal(accepted.platform, false);
    assert.deepEqual(selection(base, head, dir).plan, accepted.plan);
    assert.deepEqual(selectRange(base, head, dir, true).plan, accepted.plan);
    assert.ok(commands(accepted.selected, base, head).some(command => command.argv.includes('--pr')));
    assert.ok(toolingCommands().some(command => command.argv.includes('enablement/local-tests/desktop-install.test.ts')));
    assert.ok(contractTests().some(command => command.argv.includes('enablement/local-tests/run.test.ts')));
    put('enablement/local-tests/desktop-install.test.ts', readFileSync(join(source, 'enablement/local-tests/desktop-install.test.ts'), 'utf8') + '\n// install repair\n');
    head = commit();
    assert.equal(selectRange(base, head, dir).fixtureMac, true);
    assert.equal(selectRange(base, head, dir).plan.root, false);
    put('enablement/local-tests/fixtures/new.test.ts', "import {test} from 'node:test'; test('must run', () => {});\n");
    head = commit();
    assert.ok(selectRange(base, head, dir).qualifiedFixtures.includes('enablement/local-tests/fixtures/new.test.ts'));
    // Inventory must include additions in the owning source tree; execute it for real.
    mkdirSync(join(dir, 'enablement/prerequisites'), {recursive: true});
    put('enablement/prerequisites/finite.test.ts', "import {test} from 'node:test'; test('finite', () => {});");
    const inventory = contractTests(dir);
    assert.ok(inventory[0].argv.includes('enablement/local-tests/fixtures/new.test.ts'));
    const output = execFileSync('node', ['--experimental-strip-types', '--test', 'enablement/local-tests/fixtures/new.test.ts'], {cwd: dir, env, encoding: 'utf8'});
    assert.match(output, /must run/);
    const good = head;
    for (const path of ['capture/desktop/provider.rs', 'enablement/local-tests/run.ts', 'enablement/verification.py', 'enablement/local-tests/unknown.ts']) {
      git('reset', '--hard', good); put(path, '// native or unknown boundary'); head = commit();
      assert.equal(selectRange(base, head, dir).plan.root, true, path);
      if (path === 'enablement/local-tests/run.ts') assert.equal(selectRange(base, head, dir).fixtureMac, true);
    }
    git('reset', '--hard', good);
    chmodSync(join(dir, 'enablement/local-tests/fixtures/runner.ts'), 0o755); head = commit();
    assert.equal(selectRange(base, head, dir).inputProofKnown, false);
    git('reset', '--hard', good); git('mv', 'enablement/local-tests/fixtures/runner.ts', 'enablement/local-tests/fixtures/renamed.ts'); head = commit();
    assert.equal(selectRange(base, head, dir).plan.root, true);
    git('reset', '--hard', good); git('rm', 'enablement/local-tests/fixtures/runner.ts'); head = commit();
    assert.equal(selectRange(base, head, dir).plan.root, true);
    assert.equal(selectRange('unknown', head, dir).plan.root, true);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('the actual PR1294 six-file consolidation selects tooling and lightweight Mac proof', () => {
  const git = (...args: string[]) => execFileSync('git', args, {cwd: source, encoding: 'utf8'}).trim();
  const head = git('rev-parse', '04ab6588ae36d8fec14754dd6867a0498ecab0cf');
  const base = git('rev-parse', head + '^');
  const hosted = selectRange(base, head, source);
  assert.equal(hosted.paths.length, 6);
  assert.deepEqual(hosted.selected, ['tooling']);
  assert.equal(hosted.platform, false);
  assert.equal(hosted.fixtureMac, true);
  assert.deepEqual(selection(base, head, source).plan, hosted.plan);
});
