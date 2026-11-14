import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {savedForeground} from '../foreground/saved.ts';

// Virtual time models slow AX admission and disk proof, not native Mac behavior.
function scenario() {
  let clock = 0, savedAt = -1, shares = 0, ready = false;
  const events: string[] = [];
  return {
    events,
    prepareRecording: async () => { events.push('prepare'); clock += 7000; ready = true; return {pid: 42}; },
    stop: async () => { events.push('stop'); savedAt = clock; return {capture_id: 'owned', status: 'saved'}; },
    interact: async (saved: {capture_id: string}, prepared: {pid: number}) => {
      assert.equal(saved.capture_id, 'owned'); assert.equal(prepared.pid, 42); assert.ok(ready);
      events.push('saved-observation'); clock += 2500;
      // Privacy must be observed after Saved and before first Share.
      assert.ok(savedAt >= 0); assert.equal(shares, 0); events.push('privacy'); clock += 100;
      events.push('fresh-click'); clock += 4500;
      assert.ok(clock - savedAt < 15_000, 'Saved control dismissed before input');
      shares++; return shares;
    },
    retain: async () => { events.push('proof'); clock += 9000; },
    reportRetentionFailure: (error: unknown) => { throw error; },
  };
}

test('slow setup and bundle proof exceed old saved window; real orchestration keeps both outside it', async () => {
  const old = scenario();
  const saved = await old.stop();
  await old.retain();
  const prepared = await old.prepareRecording();
  await assert.rejects(old.interact(saved, prepared), /dismissed before input/);
  const current = scenario();
  assert.equal(await savedForeground(current), 1);
  assert.deepEqual(current.events, ['prepare', 'stop', 'saved-observation', 'privacy', 'fresh-click', 'proof']);
});

test('uncertain input is never replayed; private saved proof precedes failure cleanup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'apparent-dev-foreground-proof-'));
  const source = path.join(root, 'synthetic.apparent'), retained = path.join(root, 'proof.apparent');
  const failure = Error('native input outcome unknown');
  let clicks = 0;
  try {
    await writeFile(source, 'synthetic bundle proof', {mode: 0o600});
    await assert.rejects(savedForeground({
      ...scenario(),
      stop: async () => ({bundle_path: source}),
      interact: async () => { clicks++; throw failure; },
      retain: async saved => { await cp(saved.bundle_path, retained, {errorOnExist: true, force: false}); },
    }), error => error === failure);
    await rm(source); // The actual caller also cleans up only after orchestration exits.
    assert.equal(await readFile(retained, 'utf8'), 'synthetic bundle proof');
    assert.equal(clicks, 1);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('retention failure fails success and cannot hide an input failure', async () => {
  const proofError = Error('proof failed'), inputError = Error('input failed');
  const secondary: unknown[] = [];
  const base = {...scenario(), retain: async () => { throw proofError; }, reportRetentionFailure: (e: unknown) => { secondary.push(e); }};
  await assert.rejects(savedForeground(base), e => e === proofError);
  assert.deepEqual(secondary, []);
  await assert.rejects(savedForeground({...base, interact: async () => { throw inputError; }}), e => e === inputError);
  assert.deepEqual(secondary, [proofError]);
});

test('failed setup or Stop never admits input or invents a saved bundle', async () => {
  for (const operation of ['prepareRecording', 'stop'] as const) {
    const current = scenario(), failure = Error(operation);
    await assert.rejects(savedForeground({...current, [operation]: async () => { throw failure; }}), e => e === failure);
    assert.ok(!current.events.includes('fresh-click'));
    assert.ok(!current.events.includes('proof'));
  }
});
