import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs, run } from './build-dev-app.ts';

test('arguments expose help, plan and explicit source/input/output', () => {
  assert.equal(parseArgs(['--help']), 'help');
  assert.deepEqual(parseArgs(['--source-root', '/src', '--inputs', 'in.json', '--output', 'out', '--plan'], '/tmp'),
    { sourceRoot: '/src', inputs: join(process.cwd(), 'in.json'), output: join(process.cwd(), 'out'), plan: true });
  assert.throws(() => parseArgs(['--inputs']), /requires a value/);
  assert.throws(() => parseArgs(['--wat']), /Unknown option/);
});

test('missing builder gives an actionable full-desktop prerequisite error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dev-app-cli-'));
  try { await assert.rejects(run({ sourceRoot: root, plan: true }), /Use --source-root.*not fall back/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('plan locates the accepted builder and build invokes it in source cwd with explicit inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dev-app-cli-'));
  try {
    const scripts = join(root, 'composition/app/scripts');
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'build-omarchy.ts'), '// inert fixture');
    const plan = await run({ sourceRoot: root, plan: true });
    assert(plan && plan.builder.endsWith('composition/app/scripts/build-omarchy.ts'));
    let invocation: unknown;
    const fakeSpawn = ((...args: unknown[]) => {
      invocation = args;
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    }) as typeof import('node:child_process').spawn;
    await run({ sourceRoot: root, inputs: '/private/admitted.json', output: '/tmp/fresh-bundle', plan: false }, fakeSpawn);
    const [command, args, opts] = invocation as [string, string[], { cwd: string }];
    assert.equal(command, process.execPath);
    assert.deepEqual(args, ['--experimental-strip-types', join(scripts, 'build-omarchy.ts'), '/private/admitted.json', '/tmp/fresh-bundle']);
    assert.equal(opts.cwd, root);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('nonzero builder exit is surfaced as an actionable error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dev-app-cli-'));
  try {
    const scripts = join(root, 'composition/app/scripts');
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'build-omarchy.ts'), '');
    const fakeSpawn = (() => { const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', 17, null)); return child; }) as typeof import('node:child_process').spawn;
    await assert.rejects(run({ sourceRoot: root, inputs: '/x', output: '/y', plan: false }, fakeSpawn), /exit code 17.*preserve/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
