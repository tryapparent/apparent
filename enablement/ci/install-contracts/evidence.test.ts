import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {selectRange} from '../select.ts';
import {YAML} from 'bun';
import {lookup, matches, trusted, installCommand, fixtureStep} from './evidence.ts';
import {installationContracts, fixtureMacCommands} from '../../local-tests/run.ts';
const identity = {sha: 'a'.repeat(40), tree: 'b'.repeat(40), run: '123', attempt: '2',
  workflow: 'tryapparent/apparent/.github/workflows/checks.yml@refs/pull/42/merge',
  node: 'v22.23.0', npm: '10.9.4', image:'macos15:20261108.0031', osRelease:'24.6.0', platform: 'darwin', arch: 'x64', suite: installCommand};
const receipt = () => ({schema: 1, ...identity});
const job = () => ({name: 'Mac hook fixtures', run_id: 123, run_attempt: 2, status: 'completed', conclusion: 'success',
  labels: ['macos-15-intel'], steps: [{name: fixtureStep, status: 'completed', conclusion: 'success'}]});
const artifact = () => ({id: 9, name: 'mac-install-contracts-2', expired: false, size_in_bytes: 300});
const env = {GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'tryapparent/apparent', GITHUB_SHA: identity.sha, GITHUB_EVENT_NAME: 'pull_request'};

test('exact suite and candidate evidence from the successful required named job is reusable without a wait', async () => {
  assert.deepEqual(installationContracts(null), [installCommand]);
  assert.deepEqual(fixtureMacCommands()[0], installCommand);
  const paths: string[] = [];
  assert.equal(await lookup(identity, async path => {
    paths.push(path);
    return path.includes('/jobs?') ? {total_count: 1, jobs: [job()]} : {total_count: 1, artifacts: [artifact()]};
  }, async id => {assert.equal(id, 9); return receipt();}), true);
  assert.deepEqual(paths, ['actions/runs/123/attempts/2/jobs?per_page=100', 'actions/runs/123/artifacts?per_page=100']);
  assert.equal(trusted(identity, env), true);
});

test('failed, skipped, absent, unrelated, stale or incomplete producer evidence runs fresh', async () => {
  for (const jobs of [[], [job(), job()], ...['failure','skipped','cancelled',null].map(conclusion => [{...job(), conclusion}]),
    [{...job(), status: 'in_progress'}], [{...job(), name: 'unrelated'}], [{...job(), run_attempt: 1}],
    [{...job(), run_id: 124}], [{...job(), labels: ['ubuntu-24.04']}], [{...job(), steps: []}],
    [{...job(), steps: [{name: fixtureStep, status:'completed', conclusion:'failure'}]}]]) {
    let reads = 0;
    assert.equal(await lookup(identity, async () => ({total_count: jobs.length, jobs}), async () => {reads++; return receipt();}), false);
    assert.equal(reads, 0);
  }
  assert.equal(await lookup(identity, async () => ({total_count: 101, jobs:[job()]}), async () => receipt()), false);
  for (const artifacts of [[], [artifact(), artifact()], [{...artifact(), expired: true}],
    [{...artifact(), name: 'mac-install-contracts-1'}], ...[-1,0,undefined,'300',2000000].map(size_in_bytes => [{...artifact(), size_in_bytes}]),
    ...[-1,0,undefined,'9'].map(id => [{...artifact(), id}])]) {
    assert.equal(await lookup(identity, async path => path.includes('/jobs?') ? {total_count:1,jobs:[job()]} :
      {total_count:artifacts.length,artifacts}, async () => receipt()), false);
  }
  assert.equal(await lookup(identity, async () => {throw Error('403');}, async () => receipt()), false);
  assert.equal(await lookup(identity, async path => path.includes('/jobs?') ? {total_count:1,jobs:[job()]} :
    {total_count:1,artifacts:[artifact()]}, async () => {throw Error('invalid archive');}), false);
});

test('every candidate/runtime/plan identity field is required; selector flags cannot supply trust', () => {
  for (const key of Object.keys(identity)) assert.equal(matches({...receipt(), [key]: 'incompatible'}, identity), false, key);
  assert.equal(matches({...receipt(), schema: 2}, identity), false);
  assert.equal(matches(undefined, identity), false);
  for (const patch of [{GITHUB_ACTIONS: ''}, {GITHUB_REPOSITORY: 'elsewhere/repo'}, {GITHUB_SHA: 'c'.repeat(40)},
    {GITHUB_EVENT_NAME:'workflow_dispatch'}]) assert.equal(trusted(identity, {...env,...patch}), false);
  for (const patch of [{platform:'linux'}, {arch:'arm64'}, {workflow:'tryapparent/apparent/.github/workflows/verification.yml@refs/heads/main'},
    {run:''}, {attempt:'0'}]) assert.equal(trusted({...identity,...patch},env), false);
});

test('hosted producer and both platform plans keep parallel native execution and mandatory admission', () => {
  const checks = YAML.parse(readFileSync('.github/workflows/checks.yml','utf8'));
  const platform = YAML.parse(readFileSync('.github/workflows/verification-platform.yml','utf8'));
  assert.ok(!checks.jobs.macos.needs.includes('fixture-mac'), 'no new serialization edge');
  assert.ok(!checks.jobs.linux.needs.includes('fixture-mac'));
  for (const name of ['macos-admission','tree-evidence','native-evidence']) assert.ok(checks.jobs[name].needs.includes('fixture-mac'));
  assert.equal(checks.jobs.macos.with.plan, '${{ needs.select.outputs.mac_plan }}');
  assert.equal(checks.jobs.linux.with.plan, '${{ needs.select.outputs.plan }}');
  const steps = checks.jobs['fixture-mac'].steps;
  assert.equal(steps.find((s: any) => s.name === fixtureStep).run, 'node --experimental-strip-types enablement/local-tests/run.ts --fixture-mac');
  assert.equal(steps.at(-1).with.name, 'mac-install-contracts-${{ github.run_attempt }}');
  assert.equal(steps.at(-1).if, undefined, 'upload only after fixture success');
  assert.equal(platform.permissions.actions, 'read');
  const manual = YAML.parse(readFileSync('.github/workflows/verification.yml', 'utf8'));
  assert.equal(manual.jobs.verify.permissions.actions, 'read');
  assert.equal(manual.jobs.verify.permissions.contents, 'read');
  const nativeSteps = platform.jobs.rust.steps;
  const installIndex = nativeSteps.findIndex((s: any) => s.name === 'Local Desktop install reuse contracts');
  assert.equal(nativeSteps[installIndex].if, "runner.os == 'macOS' && (needs.select.outputs.root == 'true' || needs.select.outputs.engine == 'true' || needs.select.outputs.desktop == 'true')");
  assert.equal(nativeSteps[installIndex].env.GH_TOKEN, '${{ github.token }}');
  assert.ok(installIndex < nativeSteps.findIndex((s: any) => s.name === 'Prepare locked native prerequisites before first Cargo'));
  for (const plan of [checks.jobs.linux,checks.jobs.macos]) assert.equal(plan.with.portable, false);
  assert.equal(steps.find((s:any) => s.uses === 'actions/setup-node@v4').with['node-version'], '22.23.0');
  assert.equal(nativeSteps.find((s:any) => s.uses === 'actions/setup-node@v4').with['node-version'],
    "${{ runner.os == 'macOS' && '22.23.0' || '22' }}");
});


test('real dirty candidate declines reuse before any API request; evidence edits retain the named fixture lane', () => {
  const directory = mkdtempSync('/tmp/apparent-dev-install-candidate-');
  const git = (...args: string[]) => execFileSync('git', args, {cwd:directory,encoding:'utf8'}).trim();
  try {
    git('init','-q'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid');
    const source = join(directory,'enablement/ci/install-contracts/evidence.ts');
    execFileSync('mkdir',['-p',join(directory,'enablement/ci/install-contracts')]);
    writeFileSync(source,'baseline'); git('add','.'); git('commit','-qm','baseline');
    const base = git('rev-parse','HEAD');
    writeFileSync(source,'changed');
    const module = pathToFileURL(join(process.cwd(),'enablement/ci/install-contracts/evidence.ts')).href;
    const script = `Object.defineProperty(process, 'platform', {value:'darwin'});
      process.env.GH_TOKEN='synthetic';
      let requests = 0; globalThis.fetch = () => {requests++; throw Error('must not query for a dirty tree')};
      const {alreadyPassed} = await import(${JSON.stringify(module)});
      if (await alreadyPassed(${JSON.stringify(directory)}) || requests !== 0) process.exit(7);`;
    execFileSync('node',['--experimental-strip-types','--input-type=module','-e',script], {env: {...process.env, ...env,
      ImageOS:'macos15', ImageVersion:'20261108.0031', GITHUB_SHA:base, GITHUB_RUN_ID:'123', GITHUB_RUN_ATTEMPT:'2', GITHUB_WORKFLOW_REF:identity.workflow}});
    git('add','.'); git('commit','-qm','evidence input');
    assert.equal(selectRange(base,git('rev-parse','HEAD'),directory).fixtureMac,true);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

for (const stalled of ['request', 'json', 'archive', 'absent']) {
  test(`hosted evidence ${stalled} returns to fallback without abandoning top-level await`, {timeout: 15_000}, () => {
    const directory = mkdtempSync('/tmp/apparent-dev-install-deadline-');
    const childEnv = {...process.env};
    for (const key of execFileSync('git', ['rev-parse', '--local-env-vars'], {encoding: 'utf8'}).trim().split('\n')) delete childEnv[key];
    const git = (...args: string[]) => execFileSync('git', args, {cwd: directory, env: childEnv, encoding: 'utf8'}).trim();
    try {
      git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
      writeFileSync(join(directory, 'source'), 'candidate'); git('add', '.');
      git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'candidate');
      const module = pathToFileURL(join(process.cwd(), 'enablement/ci/install-contracts/evidence.ts')).href;
      // A separate real Node process has no other referenced handles to conceal
      // an unref'ed deadline. Hung response bodies must be bounded too.
      const script = `import assert from 'node:assert/strict';
        Object.defineProperty(process, 'platform', {value:'darwin'});
        Object.defineProperty(process, 'arch', {value:'x64'});
        const pending = () => new Promise(() => {});
        let requests = 0, aborts = 0;
        globalThis.fetch = async (url, {signal}) => {
          requests++; signal.addEventListener('abort', () => aborts++);
          if (${JSON.stringify(stalled)} === 'request') return pending();
          if (url.includes('/jobs?')) return {ok:true, json: () =>
            ${JSON.stringify(stalled)} === 'json' ? pending() : Promise.resolve({total_count:1, jobs:[${JSON.stringify(job())}]})};
          if (url.includes('/artifacts?')) return {ok:true, json: async () => ({total_count:1, artifacts:[${JSON.stringify(artifact())}]})};
          return {ok:true, arrayBuffer: pending};
        };
        if (${JSON.stringify(stalled)} === 'absent') globalThis.fetch = async () => {
          requests++; return {ok:true, json:async () => ({total_count:0,jobs:[]})};
        };
        const {alreadyPassed} = await import(${JSON.stringify(module)});
        assert.equal(await alreadyPassed(${JSON.stringify(directory)}), false);
        assert.equal(requests, ${stalled === 'archive' ? 3 : 1});
        assert.equal(aborts, ${stalled === 'absent' ? 0 : stalled === 'archive' ? 3 : 1});
        assert.ok(!process.getActiveResourcesInfo().includes('Timeout'), 'Evidence deadline leaked');
        console.log('required-suite-fallback');`;
      const output = execFileSync('node', ['--experimental-strip-types', '--input-type=module', '-e', script], {
        encoding: 'utf8', timeout: 12_000, env: {...childEnv, ...env, GH_TOKEN: 'synthetic', ImageOS: 'macos15',
          ImageVersion: '20261108.0031', GITHUB_SHA: git('rev-parse', 'HEAD'), GITHUB_RUN_ID: '123',
          GITHUB_RUN_ATTEMPT: '2', GITHUB_WORKFLOW_REF: identity.workflow}});
      assert.match(output, /required-suite-fallback/);
    } finally {rmSync(directory, {recursive: true, force: true});}
  });
}
