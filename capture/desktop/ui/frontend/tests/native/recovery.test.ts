import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../mac-storage-native.cjs', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  const nativeFailure = async name => {') + '  const nativeFailure = '.length,
  source.indexOf('\n  const reopen =', source.indexOf('  const nativeFailure ='))).trim().replace(/;$/, '');

test('native recovery rediscovers the owned helper after navigation retires General', async () => {
  const unavailable = 'Agents Settings could not open.';
  const evidence: Record<string, unknown> = {};
  const inspected: number[] = [];
  const screenshots: number[] = [];
  let discoveries = 0;
  const child = async () => ++discoveries === 1 ? 10 : 20;
  const invoke = async (pid: number) => {
    inspected.push(pid);
    if (pid === 10) throw new Error('Owned application is absent');
    return `AXStaticText|${unavailable}`;
  };
  const poll = async (operation: () => Promise<unknown>) => {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await operation(); } catch (error) { last = error; }
    }
    throw last;
  };
  const visible = (pid: number) => poll(() => invoke(pid));
  const nativeFailure = new Function('child', 'helper', 'poll', 'visible', 'invoke', 'evidence', 'assert',
    'unavailable', 'skill', 'shot', 'read', 'readRuntimeState', 'home', 'budget', 'recovery', 'diagnoseState', 'rustPID', `return (${body})`)(
    child, '/owned/helper', poll, visible, invoke, evidence, assert, unavailable, 'canonical skill',
    async (pid: number) => screenshots.push(pid), async () => ({ agentDemoVideo: true }),
    async () => ({ status: 'connected', phase: 'idle' }), '/synthetic', (ms: number) => ms, {}, () => { throw new Error('Unexpected diagnostic on success'); });
  assert.equal(await nativeFailure('recovery'), 20);
  assert.deepEqual(inspected, [10, 20]);
  assert.deepEqual(screenshots, [20]);
});

test('healthy diagnostic cannot replace the failed daemon-idle assertion', async () => {
  const recovery: Record<string, unknown> = {};
  const failed = { status: 'error', message: 'unavailable' };
  let diagnostics = 0;
  const nativeFailure = new Function('child', 'helper', 'poll', 'visible', 'invoke', 'evidence', 'assert',
    'unavailable', 'skill', 'shot', 'read', 'readRuntimeState', 'home', 'budget', 'recovery', 'diagnoseState', 'rustPID', `return (${body})`)(
    async () => 20, '/owned/helper', async (operation: () => Promise<unknown>) => operation(), undefined,
    async () => 'Recovery guidance', {}, assert, 'Recovery guidance', 'canonical skill',
    async () => {}, async () => ({ agentDemoVideo: true }), async () => failed, '/synthetic', (ms: number) => ms,
    recovery, async () => { diagnostics++; return { result: 'reply', phase: 'idle' }; }, () => { throw new Error('No native process in this unit test'); });
  await assert.rejects(nativeFailure('recovery'), { code: 'ERR_ASSERTION' });
  assert.equal(diagnostics, 1);
  assert.deepEqual((recovery.stateRead as { result: unknown }).result, failed);
  assert.deepEqual(recovery.stateDiagnostic, { result: 'reply', phase: 'idle' });
});
