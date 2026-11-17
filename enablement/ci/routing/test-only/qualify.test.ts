import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, renameSync, symlinkSync, unlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {YAML} from 'bun';
import {selectRange} from '../../select.ts';
import {owners, routingProblems} from '../consumers.ts';
import {contractTests} from '../../../local-tests/run.ts';

const path = 'enablement/ci/runner/mac-platform.test.ts';
const original = readFileSync(path, 'utf8');
function repository(t: any) {
  const cwd = mkdtempSync(join(tmpdir(), 'apparent-dev-ci-test-routing-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
  const put = (name: string, text: string) => {mkdirSync(dirname(join(cwd, name)), {recursive:true}); writeFileSync(join(cwd, name), text);};
  git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
  put(path, original); put('capture/engine/src/lib.rs', '// native');
  // Real adjacent caller bytes are part of the candidate reference inventory.
  for (const adjacent of ['enablement/ci/routing/engine-inputs/qualify.ts',
    'enablement/ci/routing/engine-inputs/range.test.ts',
    'capture/desktop/ui/frontend/tests/foreground/mac.ts',
    'enablement/ci/runner/mac-pill-bootstrap.test.ts']) put(adjacent, readFileSync(adjacent, 'utf8'));
  const commit = () => {git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'synthetic'); return git('rev-parse', 'HEAD');};
  return {cwd, git, put, commit, base: commit()};
}
test('real committed modification selects contracts only on PR and main, with guarded native admission', t => {
  const r = repository(t);
  r.put(path, original + '\n// stronger assertion\n'); const head = r.commit();
  // Working-tree corruption cannot grant or remove committed qualification.
  r.put(path, "import './unreviewed.ts';");
  for (const main of [false, true]) {
    const result = selectRange(r.base, head, r.cwd, main);
    assert.deepEqual(result.qualifiedCiTests, [path]);
    assert.deepEqual(result.selected, ['tooling']);
    for (const field of ['platform','macos','updater','fixtureMac','installer','hermes','public'] as const) assert.equal(result[field], false, field);
    assert.ok(Object.values(result.requiredStreams).every(value => !value));
    assert.ok(Object.values(result.publicationStreams).every(value => !value));
    assert.deepEqual(routingProblems(result), []);
    assert.ok(result.reasons.includes('tooling:qualified-ci-test:' + path));
    const jobs = YAML.parse(readFileSync('.github/workflows/checks.yml','utf8')).jobs;
    for (const name of ['linux','macos']) {
      const expression = jobs[name].if;
      const needs = {contracts:{result:'success'}, select:{result:'success', outputs:Object.fromEntries(Object.entries(result).map(([key,value])=>[key,String(value)]))}, reuse:{result:'success',outputs:{}}, portable:{result:'skipped'}, 'record-media':{result:'skipped'}};
      const enabled = () => Function('needs','github','cancelled',`return (${expression})`)(needs,{event_name:main?'push':'pull_request',event:{pull_request:{draft:false}}},()=>false);
      assert.equal(enabled(), false);
      needs.select.result = 'failure'; assert.equal(enabled(), true, 'selector failure retains native fallback');
      needs.contracts.result = 'failure'; assert.equal(enabled(), false, 'contracts failure cannot bypass admission');
    }
  }
  // Owner contract directories may share the invocation; root contracts must
  // still run without flags that could filter out the reviewed test.
  assert.ok(contractTests().some(({argv}) => argv[0] === 'bun' && argv[1] === 'test'
    && argv.slice(2).includes('enablement/ci/') && argv.slice(2).every(path => !path.startsWith('-'))));
  const cli = spawnSync('bun', [new URL('../../select.ts',import.meta.url).pathname, '--admit'], {
    cwd:r.cwd, encoding:'utf8', env:{...process.env, BASE_SHA:r.base, GITHUB_SHA:head,
      GITHUB_EVENT_NAME:'pull_request', GITHUB_OUTPUT:join(r.cwd,'output')}});
  assert.equal(cli.status,0,cli.stderr);
  const output=JSON.parse(cli.stdout);
  assert.deepEqual(output.selected,['tooling']); assert.equal(output.mac_rust,false);
  r.put('unknown-owner/file.ts','// ownership is required');
  const rejected=spawnSync('bun',[new URL('../../select.ts',import.meta.url).pathname,'--admit'],{
    cwd:r.cwd, encoding:'utf8',env:{...process.env,BASE_SHA:r.base,GITHUB_SHA:r.commit(),
      GITHUB_EVENT_NAME:'pull_request',GITHUB_OUTPUT:join(r.cwd,'rejected-output')}});
  assert.notEqual(rejected.status,0); assert.match(rejected.stderr,/Declare directory ownership/);
});
test('mixed actual execution inputs retain their own consumers', t => {
  const r = repository(t); r.put(path, original + '\n// regression\n');
  r.put('capture/engine/src/lib.rs', '// changed native'); const result = selectRange(r.base, r.commit(), r.cwd);
  assert.deepEqual(result.selected, ['engine','tooling']); assert.equal(result.macos,true); assert.equal(result.platform,true);
  assert.deepEqual(routingProblems(result), []);
});
for (const kind of ['import','dynamic','export','invalid','consumer','alias','unknown','delete','rename','mode','type','addition']) test('conservative fallback: '+kind, t => {
  const r = repository(t); r.put(path, original + '\n// regression\n');
  if (kind === 'import') r.put(path, original + "\nimport './new.ts';");
  if (kind === 'dynamic') r.put(path, original + "\nvoid import('./new.ts');");
  if (kind === 'export') r.put(path, original + "\nexport * from './new.ts';");
  if (kind === 'invalid') writeFileSync(join(r.cwd,path), Buffer.from([0xff]));
  if (kind === 'consumer') r.put('capture/engine/consumer.ts', "import '../../enablement/ci/runner/mac-platform.test.ts';");
  if (kind === 'alias') r.put('tsconfig.json', '{"compilerOptions":{"paths":{"@contracts/*":["enablement/ci/runner/*"]}}}');
  if (kind === 'unknown') r.put('enablement/ci/runner/new.test.ts', '// unknown');
  if (kind === 'delete') unlinkSync(join(r.cwd,path));
  if (kind === 'rename') renameSync(join(r.cwd,path),join(r.cwd,path+'.moved'));
  if (kind === 'mode') chmodSync(join(r.cwd,path),0o755);
  if (kind === 'type') {unlinkSync(join(r.cwd,path)); symlinkSync('missing',join(r.cwd,path));}
  let base = r.base;
  if (kind === 'addition') {r.git('rm','-f',path); base=r.commit(); r.put(path,original);}
  const head = r.commit(), result = selectRange(base, head, r.cwd);
  if (kind !== 'unknown') assert.deepEqual(result.qualifiedCiTests, []);
  assert.deepEqual(result.selected, [...owners]);
  assert.equal(result.macos,true); assert.equal(result.platform,true);
});
test('unknown history cannot qualify', t => {
  const r=repository(t); assert.deepEqual(selectRange('absent',r.base,r.cwd).selected,[...owners]);
});
for (const kind of ['bytes', 'import', 'mode']) test('an earlier adjacent qualifier change revokes its reviewed mention: '+kind, t => {
  const r=repository(t), adjacent='enablement/ci/routing/engine-inputs/qualify.ts';
  if (kind === 'mode') chmodSync(join(r.cwd,adjacent),0o755);
  else r.put(adjacent,readFileSync(adjacent,'utf8')+(kind === 'import' ? "\nimport '../../runner/mac-platform.test.ts';\n" : '\n// changed observation\n'));
  const base=r.commit();
  r.put(path,original+'\n// regression\n');
  const result=selectRange(base,r.commit(),r.cwd);
  assert.deepEqual(result.qualifiedCiTests,[]);
  assert.deepEqual(result.selected,[...owners]);
});
test('five-file Desktop platform split retains actual execution consumers', t => {
  const r=repository(t);
  const execution=['.github/workflows/verification-platform.yml', 'capture/desktop/ui/frontend/package.json',
    'enablement/docs/continuous-delivery.md', 'enablement/prerequisites/targeted/run.test.ts'];
  for(const file of execution) r.put(file,readFileSync(file,'utf8'));
  const base=r.commit();
  for(const file of execution) r.put(file,readFileSync(file,'utf8')+'\n');
  r.put(path,original+'\n// regression\n');
  const result=selectRange(base,r.commit(),r.cwd);
  assert.deepEqual(result.selected,['capture','engine','desktop','capture-tools','client','tooling']);
  assert.equal(result.macos,true, 'native execution inputs retain Mac consumers');
  assert.deepEqual(routingProblems(result),[]);
});
