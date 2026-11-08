import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialProgress, onboardingProgressCodec } from '@apparent/onboarding';
import { createRecordFixture } from '@apparent/record/fixtures';
import type { ConfigBackend } from '@apparent/config-host';
import { hasReviewedOnboardingWriter } from '../../src/onboarding/writer.ts';
import { buildOmarchyPackage } from '../../scripts/build-omarchy.ts';

const hostCompiled = await build({ entryPoints: [fileURLToPath(new URL('../../src/onboarding/host.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  define: { 'import.meta.url': JSON.stringify(new URL('../../src/onboarding/host.ts', import.meta.url).href) } });
const hostModule = { exports: {} as any };
new Function('require', 'module', 'exports', hostCompiled.outputFiles[0].text)(createRequire(import.meta.url), hostModule, hostModule.exports);
const { bindOnboardingWriter } = hostModule.exports;

test('writer-version compatibility is distinct from startup refusal and does not admit an arbitrary future producer', () => {
  assert.equal(hasReviewedOnboardingWriter('2dbee5bcc778eb02c724ab3b9169f95784c976a54baaf75ca5042d08ea02bea2'), true);
  assert.equal(hasReviewedOnboardingWriter('9768f559f97b10e40b3efa348c54f220a87242794529d3d4fce37ace1b1e18d0'), false);
  assert.equal(hasReviewedOnboardingWriter('a'.repeat(64)), false);
});

test('actual package entry refuses an unreviewed onboarding writer before creating package output',
  { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'onboarding-package-gate-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = join(directory, 'package');
    await assert.rejects(buildOmarchyPackage(output, { target: 'linux-x64',
      gui: { executableSha256: '9768f559f97b10e40b3efa348c54f220a87242794529d3d4fce37ace1b1e18d0' } } as any), /onboarding writer fence/);
    await assert.rejects(stat(output), { code: 'ENOENT' });
  });

const completed = () => ({ ...initialProgress(), status: 'completed' as const, stage: 'complete' as const, setupCompleted: true });
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../../src/onboarding/entry.tsx', import.meta.url))],
  bundle: true, platform: 'browser', format: 'esm', write: false, jsx: 'automatic',
  define: { 'import.meta.url': JSON.stringify('file:///synthetic-onboarding/renderer.js') } });
const { createOnboardingEntry } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

function fixture(done = true) {
  const source = createRecordFixture();
  source.driver.publish({ ...source.driver.current(), revision: source.driver.current().revision + 1,
    captures: [], readiness: { requirements: [] } });
  let value = onboardingProgressCodec.encode(done ? completed() : initialProgress());
  let revision = 4, writes = 0, opens = 0, closes = 0;
  let canOpen = true;
  const surfaces: string[] = [];
  return {
    source, surfaces, get value() { return structuredClone(value); },
    get writes() { return writes; }, get opens() { return opens; }, get closes() { return closes; },
    refuseOpen() { canOpen = false; }, allowOpen() { canOpen = true; },
    create: () => createOnboardingEntry({
      record: { read: async () => source.driver.current(), execute: source.client.execute, observe: source.client.observe },
      progress: { read: async () => ({ revision, value: structuredClone(value) }),
        async compareAndSwap(expected: number, next: typeof value) {
          if (expected !== revision) return { status: 'conflict', revision, current: structuredClone(value) };
          writes++; value = structuredClone(next); return { status: 'saved', revision: ++revision };
        } },
      openRecordingEntry: async () => { opens++; return canOpen; },
    }, (snapshot: {kind:string}) => surfaces.push(snapshot.kind), () => { closes++; }),
  };
}

test('installed owner factory preserves remembered setup, returns normally, and replays only explicitly', async () => {
  const f = fixture(), entry = await f.create();
  await entry.contribution.activation.activate({ reason: 'firstLaunch' });
  await entry.contribution.activation.activate({ reason: 'resume' });
  assert.equal(f.opens, 2); assert.equal(f.closes, 0); assert.equal(f.writes, 0);
  assert.equal(f.surfaces.at(-1), 'hidden'); assert.deepEqual(f.source.driver.commands(), []);
  await entry.contribution.activation.replayTour();
  const state = onboardingProgressCodec.decode(f.value);
  assert.equal(state.setupCompleted, true); assert.equal(state.stage, 'welcome');
  assert.equal(f.writes, 1); assert.equal(f.surfaces.at(-1), 'tour');
  await entry.dispose();
  let observed = false; const off = f.source.client.observe(() => { observed = true; }); off();
  assert(observed, 'disposing this entry must not detach the authoritative provider');
});

test('failed recording handoff stays retryable and never closes the shared destination', async () => {
  const f = fixture(); f.refuseOpen(); const entry = await f.create();
  await assert.rejects(entry.contribution.activation.activate({ reason: 'firstLaunch' }), /not opened/);
  assert.equal(f.writes, 0); assert.equal(f.closes, 0);
  f.allowOpen(); await entry.contribution.activation.activate({ reason: 'resume' });
  assert.equal(f.opens, 2); assert.equal(f.closes, 0); assert.equal(f.surfaces.at(-1), 'hidden');
  await entry.dispose();
});

test('new setup uses actual Record facts without completing a lesson or starting capture', async () => {
  const f = fixture(false), entry = await f.create();
  await entry.contribution.activation.activate({ reason: 'firstLaunch' });
  assert.equal(f.surfaces.at(-1), 'tour'); assert.equal(f.opens, 0);
  assert.equal(onboardingProgressCodec.decode(f.value).setupCompleted, false);
  assert.equal(f.writes, 0); assert.deepEqual(f.source.driver.commands(), []);
  await entry.dispose();
});

test('actual owner adoption requires verified native writer before access and retirement before activation', async () => {
  const calls: string[] = [];
  let retired = true;
  const value = onboardingProgressCodec.encode(completed());
  const backend = {
    async readForAdoption() { calls.push('adopt-read'); return { owner: { present: true, revision: 4, value }, legacy: { present: false, value: null } }; },
    async retireOnboardingLegacyWriter() { calls.push('retire'); return retired ? { status: 'retired' } : { status: 'unknown', message: 'unknown' }; },
    async read() { calls.push('read'); return { revision: 4, value }; },
  } as unknown as ConfigBackend;
  await assert.rejects(bindOnboardingWriter(backend, async () => { throw Error('unverified native writer'); }));
  assert.equal(calls.length, 0);
  const store = await bindOnboardingWriter(backend, async () => { calls.push('verify-writer'); });
  assert.deepEqual(calls, ['verify-writer', 'adopt-read', 'retire', 'verify-writer']);
  assert.equal(onboardingProgressCodec.decode((await store.read()).value as any).setupCompleted, true);
  calls.length = 0; retired = false;
  await assert.rejects(bindOnboardingWriter(backend, async () => { calls.push('verify-writer'); }), /retirement is unknown/);
  assert.deepEqual(calls, ['verify-writer', 'adopt-read', 'retire']);
  calls.length = 0;
  backend.readForAdoption = async () => { calls.push('adopt-read'); throw Error('unknown persisted state'); };
  await assert.rejects(bindOnboardingWriter(backend, async () => { calls.push('verify-writer'); }), /requires reconciliation/);
  assert.deepEqual(calls, ['verify-writer', 'adopt-read']);
});
