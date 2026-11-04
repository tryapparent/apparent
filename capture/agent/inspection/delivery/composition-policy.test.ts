import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { inputs } from './composition.ts';

function git(root: string, ...args: string[]) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(root: string, path: string, value: string) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
}

test('renderer package edits preserve root closure while bridge, shared ABI and native edits invalidate it', t => {
  const root = mkdtempSync(join(tmpdir(), 'apparent-root-input-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Root input policy fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  write(root, 'capture/desktop/ui/frontend/src/main.tsx', 'export const view = 1;\n');
  write(root, 'capture/desktop/workflow/electron/bridge.rs', 'pub fn dispatch() {}\n');
  write(root, 'shared/model.rs', 'pub struct Bundle { schema: u32 }\n');
  write(root, 'capture/engine/native/worker.rs', 'pub fn run_native() {}\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture');

  const baseline = inputs(root);
  assert(!baseline.some(entry => entry.path.startsWith('capture/desktop/ui/frontend/')));
  assert(baseline.some(entry => entry.path === 'capture/desktop/workflow/electron/bridge.rs'));
  assert(baseline.some(entry => entry.path === 'shared/model.rs'));
  assert(baseline.some(entry => entry.path === 'capture/engine/native/worker.rs'));

  write(root, 'capture/desktop/ui/frontend/src/main.tsx', 'export const view = 2;\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'renderer update');
  assert.deepEqual(inputs(root), baseline, 'independently packaged renderer edits must not invalidate the root receipt');

  for (const [path, value] of [
    ['capture/desktop/workflow/electron/bridge.rs', 'pub fn dispatch_v2() {}\n'],
    ['shared/model.rs', 'pub struct Bundle { schema: u64 }\n'],
    ['capture/engine/native/worker.rs', 'pub fn run_native_v2() {}\n'],
  ]) {
    const before = inputs(root);
    write(root, path, value);
    git(root, 'add', '.'); git(root, 'commit', '-qm', `change ${path}`);
    assert.notDeepEqual(inputs(root), before, `${path} must remain a root build input`);
  }
});
