import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {pushArguments} from '../execution/push.ts';

const moduleUrl = new URL('../execution/push.ts', import.meta.url).href;

test('push inherits live runner budget and preserves Git arguments', () => {
  assert.deepEqual(pushArguments(['--jobs', '2', '--', 'origin', 'HEAD:topic'], {}),
    ['--jobs', '2', '--', 'git', 'push', 'origin', 'HEAD:topic']);
  assert.deepEqual(pushArguments(['--total-budget', '0.5', '--', '--dry-run'], {}),
    ['--timeout', '0.5', '--', 'git', 'push', '--dry-run']);
  for (const args of [['--timeout', '900', '--'], ['--total-budget', 'NaN', '--'], ['--total-budget', '0', '--'], []]) {
    assert.throws(() => pushArguments(args, {}));
  }
  assert.throws(() => pushArguments(['--'], {T3_BUILD_JOBS: '2'}), /Already admitted/);
});

test('process replacement preserves failure exit and stdin', () => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    `import {replaceProcess} from ${JSON.stringify(moduleUrl)}; replaceProcess('/bin/sh', ['-c', 'read value; test "$value" = preserved || exit 1; exit 37']);`],
  {input: 'preserved\n', encoding: 'utf8'});
  assert.equal(result.status, 37, result.stderr);
});

test('replacement receives cancellation directly without a surviving wrapper child', async () => {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    `import {replaceProcess} from ${JSON.stringify(moduleUrl)}; replaceProcess('/bin/sh', ['-c', 'echo ready; exec sleep 30']);`], {stdio: ['ignore', 'pipe', 'pipe']});
  try {
    await once(child.stdout!, 'data');
    child.kill('SIGTERM');
    const [code, signal] = await once(child, 'exit');
    assert.equal(code, null);
    assert.equal(signal, 'SIGTERM');
  } finally {
    child.kill('SIGKILL');
  }
});
