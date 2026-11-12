import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {YAML} from 'bun';
import {affectsStream, currentStream, streamPaths, type Stream} from './streams.ts';

const root = new URL('../../../', import.meta.url);
const workflows = {capture: 'checks.yml', connect: 'stream-connect.yml', public: 'stream-public.yml', hermes: 'hermes.yml'};
test('both automatic events use the reviewed positive directory inventory', () => {
  for (const [stream, file] of Object.entries(workflows)) {
    const workflow = YAML.parse(readFileSync(new URL('.github/workflows/' + file, root), 'utf8'));
    for (const event of ['push', 'pull_request']) assert.deepEqual(workflow.on[event].paths, streamPaths[stream as Stream]);
    if (stream === 'public' || stream === 'connect') {
      const job = workflow.jobs[stream === 'public' ? 'deploy' : 'hosted'];
      assert.equal(job.steps.find((step: any) => step.uses === 'actions/checkout@v4').with['fetch-depth'], 0);
    }
  }
  for (const stream of Object.keys(workflows) as Stream[]) {
    for (const path of ['shared/new/file.ts', 'composition/new/file.ts']) assert.equal(affectsStream(stream, path), true);
    assert.equal(affectsStream(stream, 'unowned/new.ts'), false);
  }
  assert.equal(affectsStream('public', 'capture/desktop/ui/frontend/tests/reference-native.cjs'), false);
  assert.equal(affectsStream('public', 'enablement/prerequisites/mac-picker.test.ts'), false);
  assert.equal(affectsStream('hermes', 'public/site/src/App.tsx'), false);
  assert.equal(affectsStream('capture', 'public/site/src/App.tsx'), false);
  assert.equal(affectsStream('public', 'public/new/file.ts'), true);
  assert.equal(affectsStream('capture', 'capture/desktop/new/file.ts'), true);
  assert.equal(affectsStream('connect', 'connect/new/file.ts'), true);
  assert.equal(affectsStream('hermes', 'hermes/new/file.ts'), true);
});

test('cheap contracts surface new top-level ownership instead of selecting every stream', () => {
  const paths = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
  const directories = new Set(['.cargo', '.github', '.githooks', 'capture', 'record', 'connect', 'public', 'shared', 'composition', 'enablement', 'hermes']);
  const files = new Set(['.gitignore', 'AGENTS.md', 'CONTRIBUTING.md', 'Cargo.toml', 'Cargo.lock', 'LICENSE', 'README.md', 'build.rs', 'main.rs']);
  const unowned = paths.filter(path => path.includes('/') ? !directories.has(path.split('/')[0]) : !files.has(path));
  assert.deepEqual(unowned, [], 'declare new directory ownership and workflow consumers');
});

test('pending exact-candidate delivery survives unrelated main changes, but not affected, rename, deletion or divergent inputs', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stream-candidate-'));
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
  const put = (path: string) => {mkdirSync(join(cwd, path, '..'), {recursive: true}); writeFileSync(join(cwd, path), 'fixture');};
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
    put('public/site/page.ts'); git('add', '.'); git('commit', '-qm', 'candidate'); const candidate = git('rev-parse', 'HEAD');
    assert.equal(currentStream('public', candidate, 'HEAD', cwd), true);
    put('capture/desktop/change.ts'); git('add', '.'); git('commit', '-qm', 'unrelated');
    assert.equal(currentStream('public', candidate, 'HEAD', cwd), true);
    put('AGENTS.md'); put('capture/desktop/docs/new.md'); git('add', '.'); git('commit', '-qm', 'ordinary guidance');
    // Capture source already changed since candidate; compare with that checkpoint.
    const docsParent = git('rev-parse', 'HEAD^');
    assert.equal(currentStream('capture', docsParent, 'HEAD', cwd), true);
    put('capture/agent/skills/apparent/SKILL.md'); git('add', '.'); git('commit', '-qm', 'embedded instructions');
    assert.equal(currentStream('capture', docsParent, 'HEAD', cwd), false);
    git('mv', 'public/site/page.ts', 'capture/desktop/moved.ts'); git('commit', '-qm', 'rename');
    assert.equal(currentStream('public', candidate, 'HEAD', cwd), false);
    git('reset', '--hard', candidate); put('shared/change.ts'); git('add', '.'); git('commit', '-qm', 'shared');
    assert.equal(currentStream('public', candidate, 'HEAD', cwd), false);
    assert.throws(() => currentStream('public', git('rev-parse', 'HEAD'), candidate, cwd));
    assert.throws(() => currentStream('public', 'invalid', 'HEAD', cwd));
  } finally {rmSync(cwd, {recursive: true, force: true});}
});
