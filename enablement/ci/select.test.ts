import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, unlinkSync, chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {YAML} from 'bun';
import {select, changedPaths, macDecision, requiresMacRust, selectRange, documentationOnlyPath, needsPlatform, requiresMacRustRange, presentationInputs} from './select.ts';
import {selectedOwners, suitePlan, publicMarkdown, linuxDrivers, owners} from './routing/consumers.ts';
import {selection as localSelection, commands as localCommands, contractTests} from '../local-tests/run.ts';

const root = new URL('../../', import.meta.url);
const workflow = (name: string) => YAML.parse(readFileSync(new URL(`.github/workflows/${name}`, root), 'utf8')) as any;
const ci = () => workflow('checks.yml');
function admitted(expression: string, needs: any, event = 'pull_request', draft = false, cancelled = false,
  context: {repository?: string; ref?: string; ancestors?: string[]} = {}) {
  // GitHub applies success() to conditions without a status function, including
  // skipped transitive ancestors even when a direct admission job succeeded.
  if (!/\b(?:always|cancelled|success|failure)\s*\(/.test(expression) &&
      [...Object.values(needs).map((job: any) => job.result), ...(context.ancestors ?? [])].some(result => result !== 'success')) return false;
  return Function('github', 'needs', 'cancelled', 'always', `return (${expression});`)(
    {event_name: event, repository: context.repository ?? 'tryapparent/apparent', ref: context.ref ?? (event === 'push' ? 'refs/heads/main' : 'refs/pull/1/merge'), event: {pull_request: {draft}}}, needs, () => cancelled, () => true);
}
function parents(outputs: any = {}, reuse: any = {}) {
  return {contracts: {result: 'success'}, hermes: {result: 'success'}, select: {result: 'success', outputs}, reuse: {result: 'success', outputs: reuse}, portable: {result: 'success'}};
}
test('independent stream workflows, manual diagnostics, PR integration checkout and read-only verification', () => {
  assert.deepEqual(readdirSync(new URL('.github/workflows/', root)).filter(name =>
    Object.keys(workflow(name).on).some(event => !['workflow_dispatch', 'workflow_call'].includes(event))).sort(), ['checks.yml', 'hermes.yml', 'stream-connect.yml', 'stream-public.yml']);
  assert.deepEqual(Object.keys(ci().on), ['pull_request', 'push']);
  assert.deepEqual(ci().on.pull_request.types, ['opened', 'reopened', 'synchronize', 'ready_for_review', 'converted_to_draft']);
  assert.equal(ci().permissions.contents, 'read');
  for (const name of ['verification.yml', 'verification-mac.yml']) assert.deepEqual(Object.keys(workflow(name).on), ['workflow_dispatch']);
  for (const job of Object.values(ci().jobs) as any[]) for (const step of job.steps ?? []) {
    if (step.uses === 'actions/checkout@v4') {
      assert.equal(step.with.ref, undefined, 'verify the proposed merge, not only the branch head');
      assert.equal(step.with['persist-credentials'], false);
    }
  }
});
test('PR updates coalesce but main commits cannot cancel earlier code verification', () => {
  const c = ci().concurrency;
  assert.match(c.group, /github.sha/);
  for (const [event, expected] of [['pull_request', true], ['push', false]])
    assert.equal(admitted(c['cancel-in-progress'].slice(3, -2), {}, String(event)), expected);
});
test('source suites run on ready PRs and main; unknown selection broadens and cancellation prevents allocation', () => {
  for (const name of ['linux', 'macos']) {
    const job = ci().jobs[name];
    assert.deepEqual(job.needs, ['contracts', 'select', 'reuse', 'portable']);
    for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
      const needs = parents({platform: 'true', macos: 'true', mac_rust: 'true', hermes: 'true'});
      needs.select.result = result;
      assert.equal(admitted(job.if, needs), true, `${name}: ${result}`);
      assert.equal(admitted(job.if, needs, 'push'), true);
      assert.equal(admitted(job.if, needs, 'pull_request', true), false);
      assert.equal(admitted(job.if, needs, 'pull_request', false, true), false);
      needs.contracts.result = 'failure';
      assert.equal(admitted(job.if, needs), false);
    }
  }
});
test('each consumer can be skipped independently; skipping Hermes does not block unrelated suites', () => {
  const jobs = ci().jobs;
  const needs = parents({platform: 'true', macos: 'true', mac_rust: 'true', hermes: 'false'});
  needs.hermes.result = 'skipped';
  assert.equal(admitted(jobs.linux.if, needs), true);
  assert.equal(admitted(jobs.macos.if, needs), true);
  needs.select.outputs.platform = 'false';
  assert.equal(admitted(jobs.linux.if, needs), false);
  assert.equal(admitted(jobs.macos.if, needs), false);
});
test('main reuses only explicit passed evidence; PRs cannot claim main reuse', () => {
  for (const key of ['linux', 'macos', 'portable']) {
    const name = key === 'hermes_macos' ? 'hermes-macos' : key;
    const needs = parents({platform: 'true', macos: 'true', mac_rust: 'true', portable: 'true', hermes: 'true'}, {[key]: 'true'});
    assert.equal(admitted(ci().jobs[name].if, needs, 'push'), false, name);
    for (const value of ['', 'unknown', 'false', undefined]) {
      needs.reuse.outputs[key] = value;
      assert.equal(admitted(ci().jobs[name].if, needs, 'push'), true, name);
    }
  }
});
test('Linux release waits for exact-main admission without waiting for Mac', () => {
  const job = ci().jobs['release-linux'];
  assert.deepEqual(job.needs, ['linux-admission','select']);
  assert.equal(job.uses, './.github/workflows/release-linux.yml');
  assert.equal(job.with.publish_main, true);
  assert.match(ci().jobs['linux-admission'].if, /github.event_name == 'push'/);
  assert.ok(!ci().jobs['linux-admission'].needs.some((name: string) => name.startsWith('mac')));
  assert.equal(workflow('release-linux.yml').concurrency['cancel-in-progress'], false);
  assert.match(workflow('release-linux.yml').jobs.admit.steps.find((s: any) => s.id === 'gate').run, /--platform linux --sha/);
});
test('Hermes-only changes never start unrelated Linux packaging; mixed and unknown inputs retain publication',()=>{
 const expression=ci().jobs['release-linux'].if;
 const outputs=(paths:string[]|null)=>{
  const plan=suitePlan(paths);
  return {hermes:String(plan.hermes),platform:String(needsPlatform(paths)),public:String(select(paths).public),portable:String(plan.browser||plan.service||plan.tools)};
 };
 const allowed=(value:any)=>admitted(expression,{...parents(value),'linux-admission':{result:'success'}},'push');
 for(const path of ['hermes/desktop/controller.ts','hermes/plugin.yaml','hermes/tests/test_inspect.py','.github/workflows/hermes.yml'])assert.equal(allowed(outputs([path])),false,path);
 for(const path of ['capture/engine/runtime/recording/mod.rs','capture/agent/setup/hermes.ts','public/site/src/main.tsx','connect/web/src/main.tsx'])assert.equal(allowed(outputs(['hermes/plugin.yaml',path])),true,path);
 assert.equal(allowed(outputs(null)),true);
 for(const key of ['hermes','platform','public','portable']){
  const unknown:any=outputs(['hermes/plugin.yaml']);delete unknown[key];assert.equal(allowed(unknown),true,key);
 }
});
test('Linux publication survives intentional ancestor skips but requires successful exact-main admission', () => {
  const expression = ci().jobs['release-linux'].if;
  for (const ancestors of [['success'], ['success', 'skipped'], ['skipped', 'skipped']]) {
    const needs = {...parents(), 'linux-admission': {result: 'success'}};
    assert.equal(admitted(expression, needs, 'push', false, false, {ancestors}), true);
    for (const result of ['failure', 'skipped', 'cancelled', undefined]) {
      needs['linux-admission'].result = result as string;
      assert.equal(admitted(expression, needs, 'push', false, false, {ancestors}), false, String(result));
    }
  }
  const needs = {...parents(), 'linux-admission': {result: 'success'}};
  assert.equal(admitted(expression, needs, 'push', false, true), false);
  assert.equal(admitted(expression, needs, 'pull_request'), false);
  assert.equal(admitted(expression, needs, 'push', false, false, {repository: 'fork/apparent'}), false);
  assert.equal(admitted(expression, needs, 'push', false, false, {ref: 'refs/heads/feature'}), false);
});
test('portable checks execute once; nested platforms consume plans rather than empty-tree diffs', () => {
  const platform = workflow('verification-platform.yml');
  for (const name of ['linux', 'macos']) {
    assert.equal(ci().jobs[name].with.portable, false);
    assert.match(ci().jobs[name].with.plan, /needs.select.outputs.(mac_plan|plan)/);
  }
  assert.equal(platform.on.workflow_call.inputs.portable.default, true);
  assert.equal(platform.on.workflow_call.inputs.plan.default, '');
  assert.ok(platform.jobs.select.steps.some((s: any) => s.run?.includes('--portable') && s.if === 'inputs.portable'));
  assert.doesNotMatch(readFileSync(new URL('.github/workflows/verification-platform.yml', root), 'utf8'), /hash-object -t tree/);
  assert.equal(platform.jobs['desktop-ui'].if, "needs.select.outputs.desktop == 'true'");
  assert.equal(platform.jobs['connect-client'].if, "needs.select.outputs.client == 'true'");
  assert.match(platform.jobs.rust.if, /outputs.root.*outputs.engine/);
  assert.ok(ci().jobs.portable.steps.some((s: any) => s.run?.includes('--portable')));
});
test('Public-only inputs keep their actual web verification and avoid native suites', () => {
  for (const path of ['README.md', 'public/site/src/main.tsx', 'public/site/package.json',
    'public/site/src/copy.md', 'capture/agent/docs/usage.md', 'capture/desktop/docs/guides/recording.md']) {
    assert.equal(select([path]).public, true, path);
    assert.equal(needsPlatform([path]), false, path);
    assert.deepEqual(selectedOwners([path]), ['public']);
  }
  assert.equal(needsPlatform(['capture/agent/skills/apparent/SKILL.md']), true, 'skill body is embedded in the native CLI');
  const source = readFileSync(new URL('public/site/scripts/site-build/agent-files.ts', root), 'utf8');
  const consumed = [...new Set([...source.matchAll(/\b(?:repo|guide)\("([^"]+\.md)"\)/g)].map(m => m[1]))].sort();
  assert.deepEqual(consumed, [...publicMarkdown].sort(), 'new build consumers require review');
});
test('Connect web is portable; service retains real integration plus its canonical service checks', () => {
  assert.deepEqual(selectedOwners(['connect/web/src/NewPage.tsx']), ['web']);
  assert.equal(needsPlatform(['connect/web/src/NewPage.tsx']), false);
  const service = suitePlan(['connect/service/src/worker.ts']);
  assert.equal(service.service, true); assert.equal(service.client, true); assert.equal(service.root, true);
  assert.equal(service.browser, true);
});
test('ordinary prose composes with Linux-only exemptions; shipped instructions and unknown inputs remain broad', () => {
  const linux = 'capture/desktop/linux/integration/appearance.rs';
  for (const prose of ['capture/engine/docs/capture.md', 'capture/desktop/docs/linux/linux.md', 'enablement/docs/continuous-delivery.md']) {
    assert.equal(documentationOnlyPath(prose), true);
    assert.equal(needsPlatform([prose]), false);
    assert.deepEqual(select([prose]), {public:false, updater:false});
    assert.equal(macDecision([linux, prose]).macos, false);
  }
  for (const path of ['unknown.md', 'unknown/docs/test.md',
    'Cargo.toml', 'Cargo.lock', 'build.rs', 'enablement/native-build/build.ts',
    'capture/desktop/native/Settings.swift', 'capture/desktop/assets/app-icon.png', 'public/site/unknown.rs']) {
    assert.equal(needsPlatform([path]), true, path);
  }
  for (const paths of [null, []]) assert.equal(needsPlatform(paths), true);
});
test('Linux drivers select launch-free contracts and Hermes changes select inspection', () => {
  for (const path of linuxDrivers) assert.deepEqual(selectedOwners([path]), ['capture-tools']);
  assert.deepEqual(selectedOwners(['hermes/desktop/controller.ts']), ['hermes']);
  assert.equal(suitePlan(['public/site/src/main.tsx']).hermes, false);
  assert.equal(suitePlan(['capture/desktop/ui/frontend/src/hermes/mailbox.ts']).hermes, true);
});
test('standalone Enablement regression tests select tooling while execution inputs and mixed changes retain consumers', () => {
  const audited = ['enablement/local-tests/reuse.test.ts', 'enablement/prerequisites/native.test.ts'];
  for (const path of audited) {
    assert.deepEqual(selectedOwners([path]), ['tooling'], path);
    assert.deepEqual(suitePlan([path]), {root:false, engine:false, desktop:false, client:false,
      browser:false, service:false, tools:false, hermes:false}, path);
    assert.deepEqual(localCommands(['tooling'], 'base', 'head').map(command => command.argv), [
      ['python3', 'enablement/verification.py', '--base', 'base', '--head', 'head', '--pr'],
      ['node', '--experimental-strip-types', '--test', 'enablement/local-tests/desktop-install.test.ts'],
      ['python3', '-m', 'unittest', 'discover', '-s', 'enablement/directory-width/tests', '-p', 'test_*.py'],
    ]);
    assert.ok(contractTests().some(command => command.argv.includes(path)), `${path} remains in the mandatory full contract inventory`);
  }
  for (const path of ['enablement/prerequisites/native.ts', 'enablement/native-build/build.ts',
    'enablement/prerequisites/new-regression.test.ts'])
    assert.deepEqual(selectedOwners([path]), [...owners], path);
  assert.deepEqual(selectedOwners([audited[0], 'capture/engine/src/lib.rs']), ['engine', 'tooling']);
});

function repository(action: (git: (...args: string[]) => string, dir: string) => void) {
  const dir = mkdtempSync((process.env.TMPDIR || '/tmp') + '/apparent-dev-selector-');
  const previous = process.cwd(), inherited = {...process.env};
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
  process.chdir(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  try {git('init', '-qb', 'main');git('config', 'user.name', 'CI fixture');git('config', 'user.email', 'ci@example.invalid');action(git, dir);}
  finally {process.chdir(previous);Object.assign(process.env, inherited);rmSync(dir, {recursive: true, force: true});}
}
function cli(base: string, head: string, dir: string) {
  const output = dir + '/.git/selection'; writeFileSync(output, '');
  const result = JSON.parse(execFileSync(process.execPath, [new URL('enablement/ci/select.ts', root).pathname], {
    env: {...process.env, BASE_SHA: base, GITHUB_SHA: head, GITHUB_OUTPUT: output}, encoding: 'utf8'}));
  const fields = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => [line.slice(0,line.indexOf('=')), line.slice(line.indexOf('=')+1)]));
  for (const [key,value] of Object.entries(result)) if (key !== 'reasons') assert.equal(fields[key], typeof value === 'object' ? JSON.stringify(value) : String(value));
  return result;
}
test('repository AGENTS guidance uses contracts only through hosted and local Git selectors', () => repository((git, dir) => {
  writeFileSync('AGENTS.md', 'before');git('add', '.');git('commit', '-qm', 'base');const base = git('rev-parse', 'HEAD');
  const check = (from: string, product: boolean) => {
    const head = git('rev-parse', 'HEAD'), hosted = cli(from, head, dir);
    const local = localSelection(from, head, dir);
    assert.equal(hosted.platform, product);assert.equal(hosted.mac_rust, product);
    assert.equal(local.rustChanged, product);
    if (!product) {
      assert.ok(Object.values(hosted.plan).every(value => value === false));
      assert.equal(hosted.public, false);assert.equal(hosted.macos, false);assert.equal(hosted.updater, false);
      assert.deepEqual(local.selected, []);
      assert.deepEqual(localCommands(local.selected, from, head, 'linux', local.rustChanged)
        .map(command => command.argv), [['python3', 'enablement/verification.py', '--base', from, '--head', head, '--pr']]);
    }
  };
  writeFileSync('AGENTS.md', 'after');git('commit', '-qam', 'edit');check(base, false);
  const edited = git('rev-parse', 'HEAD');
  mkdirSync('capture');writeFileSync('capture/AGENTS.md', 'nested');git('add', '.');git('commit', '-qm', 'add');check(edited, false);
  git('mv', 'AGENTS.md', 'capture/AGENTS-old.md');git('commit', '-qm', 'unknown rename');check(edited, true);
  for (const operation of ['delete', 'guidance-rename', 'chmod', 'symlink', 'mixed-rust', 'mixed-skill', 'mixed-unknown']) {
    git('checkout', '--detach', edited);
    if (operation === 'delete') git('rm', 'AGENTS.md');
    if (operation === 'guidance-rename') {mkdirSync('capture', {recursive: true});git('mv', 'AGENTS.md', 'capture/AGENTS.md');}
    if (operation === 'chmod') chmodSync('AGENTS.md', 0o755);
    if (operation === 'symlink') {unlinkSync('AGENTS.md');symlinkSync('elsewhere', 'AGENTS.md');}
    if (operation.startsWith('mixed-')) {
      writeFileSync('AGENTS.md', 'mixed');
      const path = operation === 'mixed-rust' ? 'source.rs' : operation === 'mixed-skill' ? 'SKILL.md' : 'unknown.md';
      writeFileSync(path, 'product or unknown input');
    }
    git('add', '.');git('commit', '-qm', operation);
    check(edited, !['delete', 'guidance-rename'].includes(operation));
  }
}));
test('production Git selector preserves both rename sides, full history and fail-closed unknown/empty/shallow deltas', () => repository((git,dir) => {
  mkdirSync('public/site/src', {recursive: true});writeFileSync('public/site/src/page.tsx','before');
  git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  git('mv','public/site/src/page.tsx','unknown.ts');git('commit','-qm','move');const head=git('rev-parse','HEAD');
  assert.deepEqual(changedPaths(base,head), ['public/site/src/page.tsx','unknown.ts']);
  assert.equal(cli(base,head,dir).platform,true);
  for (const [a,b] of [['',''],['0'.repeat(40),head],[base,base],[head,base]]) assert.equal(cli(a,b,dir).platform,true);
  writeFileSync('.git/shallow',base+'\n');assert.equal(cli(base,head,dir).platform,true);
}));
test('regular Public additions/deletions stay owner-local; unsafe mode/type changes broaden', () => repository((git,dir) => {
  writeFileSync('README.md','before');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  writeFileSync('README.md','after');git('commit','-qam','edit');const edited=git('rev-parse','HEAD');
  assert.equal(cli(base,edited,dir).platform,false);
  chmodSync('README.md',0o755);git('add','.');git('commit','-qm','mode');assert.equal(cli(edited,git('rev-parse','HEAD'),dir).platform,true);
  git('checkout','--detach',edited);unlinkSync('README.md');symlinkSync('build.rs','README.md');git('add','.');git('commit','-qm','type');assert.equal(cli(edited,git('rev-parse','HEAD'),dir).platform,true);
  git('checkout','--detach',edited);git('rm','README.md');git('commit','-qm','delete');assert.equal(cli(edited,git('rev-parse','HEAD'),dir).platform,false);
}));
for (const path of presentationInputs) test('renderer-only proof retains Mac Electron while mixed/native and unsafe statuses retain Rust: '+path, () => repository((git,dir) => {
  mkdirSync(path.slice(0,path.lastIndexOf('/')),{recursive:true});writeFileSync(path,'before');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  writeFileSync(path,'after');git('commit','-qam','edit');const head=git('rev-parse','HEAD');
  const result=cli(base,head,dir);assert.equal(result.mac_rust,false);assert.equal(result.mac_plan.root,false);assert.equal(result.mac_plan.desktop,true);assert.equal(result.plan.root,true);
  assert.equal(requiresMacRustRange(base,head),false);
  for (const operation of ['delete','rename','chmod','symlink']) {
    git('checkout','--detach',base);
    if(operation==='delete')git('rm',path);if(operation==='rename')git('mv',path,'unknown.ts');
    if(operation==='chmod')chmodSync(path,0o755);if(operation==='symlink'){unlinkSync(path);symlinkSync('elsewhere',path);}
    git('add','.');git('commit','-qm',operation);assert.equal(cli(base,git('rev-parse','HEAD'),dir).mac_rust,true,operation);
  }
  git('checkout','--detach',head);writeFileSync('Cargo.toml','native dependency');git('add','.');git('commit','-qm','mixed');assert.equal(cli(base,git('rev-parse','HEAD'),dir).mac_rust,true);
}));

test('staged Engine-only deltas retain both platform native execution without the application', () => repository((git,dir) => {
  const path='capture/engine/src/session.rs';mkdirSync('capture/engine/src',{recursive:true});writeFileSync(path,'before');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  writeFileSync(path,'after');git('commit','-qam','engine');const result=cli(base,git('rev-parse','HEAD'),dir);
  assert.equal(result.plan.root,false);assert.equal(result.plan.engine,true);assert.equal(result.mac_rust,true);assert.equal(result.mac_plan.engine,true);
}));

test('portable tool contracts retain the updater harness disk-image/OCR prerequisites before execution', () => {
  const harness=workflow('linux-updater-harness.yml').jobs.contracts.steps;
  for (const [steps, execution, condition] of [
    [ci().jobs.portable.steps,'--portable',"needs.select.result != 'success' || fromJSON(needs.select.outputs.plan).tools"],
    [workflow('verification-platform.yml').jobs.select.steps,'--portable','inputs.portable'],
  ] as const) {
    const run=steps.findIndex((step:any)=>step.run?.includes(execution));
    for(const name of ['Install disk-image contract dependency (no KVM required)','Install OCR preprocessing dependency']) {
      const existing=harness.find((step:any)=>step.name===name);
      const index=steps.findIndex((step:any)=>step.name===name);
      assert.ok(index>=0&&index<run,name+' must precede the real contract suite');
      assert.equal(steps[index].run,existing.run);
      assert.equal(steps[index].if,condition);
    }
  }
});

test('recipient playback provisions FFmpeg and stable Chrome before the portable suite', () => {
  const recipient=readFileSync(new URL('connect/service/test/sharing/recipient-browser.mjs',root),'utf8');
  assert.match(recipient,/execFileSync\('ffmpeg'/);
  assert.match(recipient,/libx264/);
  for(const [steps,condition] of [
    [ci().jobs.portable.steps,"needs.select.result != 'success' || fromJSON(needs.select.outputs.plan).service"],
    [workflow('verification-platform.yml').jobs.select.steps,'inputs.portable'],
  ] as const) {
    const run=steps.findIndex((step:any)=>step.run?.includes('--portable'));
    const media=steps.findIndex((step:any)=>step.name==='Install recipient media fixture dependency');
    assert.ok(media>=0&&media<run,'media tool must exist before the real recipient fixture');
    assert.match(steps[media].run,/apt-get install -y --no-install-recommends ffmpeg$/);
    assert.equal(steps[media].if,condition);
    assert.equal(steps.find((step:any)=>step.id==='chrome').with['chrome-version'],'stable');
  }
});

test('audited Record inputs retain Desktop and native platform consumers only', () => {
  for (const pkg of ['storage', 'completion']) {
    for (const input of ['src/policy.ts', 'test/policy.test.ts', 'package.json', 'package-lock.json', 'tsconfig.json', ...(pkg === 'storage' ? ['build.ts'] : [])]) {
      const paths = [`record/${pkg}/${input}`];
      assert.deepEqual(selectedOwners(paths), ['capture', 'desktop']);
      assert.deepEqual(suitePlan(paths), {root: true, engine: false, desktop: true, client: false,
        browser: false, service: false, tools: false, hermes: false});
      assert.deepEqual(select(paths), {public: false, updater: false});
      assert.equal(needsPlatform(paths), true);
      assert.equal(macDecision(paths).macos, true);
      assert.equal(requiresMacRust(paths, []), true);
    }
    assert.deepEqual(selectedOwners([`record/${pkg}/AGENTS.md`]), []);
    for (const input of ['instructions/AGENTS.md', 'src/SKILL.md', 'native.rs', 'native.swift', 'native.S', 'Cargo.toml', 'src/unknown.bin', 'build.sh'])
      assert.deepEqual(selectedOwners([`record/${pkg}/${input}`]), selectedOwners(null));
  }
  assert.deepEqual(selectedOwners(['record/unknown/src/policy.ts']), selectedOwners(null));
  assert.deepEqual(selectedOwners(['record/storage/src/policy.ts', 'connect/web/src/api.ts']), ['capture', 'desktop', 'web']);
});

test('Hermes owns independent package verification and publication; native admission has no Hermes ancestors',()=>{
 const h=workflow('hermes.yml');
 assert.equal(h.name,'continuous delivery hermes');
 assert.equal(h.jobs.verify.strategy['fail-fast'],false);
 const validator=h.jobs.verify.steps.find((s:any)=>s.name==='Install supported Hermes validator').run;
 assert.match(validator,/uv sync.*--frozen --no-dev/);
 assert.match(validator,/fetch --depth 1 origin [a-f0-9]{40}/);
 assert.doesNotMatch(validator,/HERMES_NIX_BUILD/);
 assert.deepEqual(h.jobs.publish.needs,['contracts','clean','verify']);
 assert.match(h.jobs.publish.if,/github.event_name == 'push'/);
 assert.match(h.jobs.publish.if,/outputs.affected == 'true'/);
 assert.equal(h.jobs.verify.strategy.matrix.os.length,2);
 const consumer=h.jobs.verify.steps.find((s:any)=>s.name==='Verify Agent setup consumes the exact compiled archive');
 assert.equal(consumer.env.HERMES_PACKAGE,'${{ steps.package.outputs.directory }}');
 assert.match(consumer.run,/hermes\/distribution\/consumer\.test\.ts/);
 const routing=h.jobs.verify.steps.find((s:any)=>s.name==='Routing, bridge and package installation contracts');
 assert.match(routing.run,/capture\/agent\/setup\/hermes\.test\.ts/);
 assert.doesNotMatch(routing.run,/if \[/);
 const isolated=h.jobs.clean.steps.find((s:any)=>s.name==='Prove isolated package build and compiled integration tests').run;
 assert.doesNotMatch(isolated,/consumer\.test|capture\/agent/);
 for(const name of ['hermes','hermes-macos'])assert.equal(ci().jobs[name],undefined);
 for(const name of ['linux','macos','tree-evidence','linux-admission','macos-admission'])assert.ok(!ci().jobs[name].needs.some((n:string)=>n.startsWith('hermes')));
 assert.deepEqual(selectedOwners(['.github/workflows/hermes.yml']),['hermes']);
 assert.deepEqual(selectedOwners(['hermes/desktop/package-lock.json']),['hermes']);
 assert.deepEqual(selectedOwners(['hermes/skills/recordings/SKILL.md']),['hermes']);
});
