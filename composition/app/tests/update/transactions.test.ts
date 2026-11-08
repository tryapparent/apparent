import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { feed, MAIN_FEED, RELEASE_PREFIX, type MainFeed } from '../../src/update/contract.ts';
import { stage, restart } from '../../src/update/helper.ts';
import { atomicJson, paths } from '../../src/update/files.ts';
import { advances } from '../../scripts/update/publish.ts';

const old = 'a'.repeat(40), next = 'b'.repeat(40), latest = 'c'.repeat(40);
const original = '#!/bin/sh\nexit 0\n';
const updated = '#!/bin/sh\nif [ "$1" = --appimage-version ]; then exit 0; fi\nexit 7\n';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
function publication(sourceSha = next, bytes = updated): MainFeed {
  return { schema: 1, channel: 'main', target: 'linux-x64', sourceSha,
    ancestors: sourceSha === next ? [old, next] : [old, next, latest], image: {
      url: `${RELEASE_PREFIX}${sourceSha}/Apparent-Foundation-main-${sourceSha}-linux-x64.AppImage`, sha256: sha256(bytes), size: Buffer.byteLength(bytes),
    } };
}
async function sandbox(t: test.TestContext) {
  const root = await mkdtemp(join(homedir(), '.app-shell-update-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const image = join(root, 'Apparent.AppImage');
  await writeFile(image, original, { mode: 0o700 });
  return { root, image, p: paths(image) };
}
const fetcher = (release: MainFeed, bytes = updated) => async (input: string | URL | Request) =>
  String(input) === MAIN_FEED ? Response.json(release) : new Response(bytes);

test('Main selection binds channel, CPU, immutable URL, complete ancestry and size', () => {
  const good = publication();
  assert.equal(feed(good, old).sourceSha, next);
  for (const patch of [ { channel: 'stable' }, { target: 'macos-x64' }, { sourceSha: 'bad' },
    { ancestors: [next] }, { ancestors: [old, old, next] }, { image: { ...good.image, url: 'https://example.com/app' } },
    { image: { ...good.image, size: 2 ** 40 } }, { image: { ...good.image, sha256: 'bad' } } ]) assert.throws(() => feed({ ...good, ...patch }, old));
  assert.equal(advances(next, good.ancestors), true);
  assert.equal(advances(next, good.ancestors, good), false);
  assert.equal(advances(latest, publication(latest).ancestors, good), true);
  assert.throws(() => advances(old, [old], good));
  assert.throws(() => advances(latest, [latest], good));
});

test('download verifies bytes, stages separately and does not replace the running launcher', async t => {
  const { image, p } = await sandbox(t);
  assert.deepEqual(await stage(image, old, fetcher(publication())), { phase: 'ready', available: next });
  assert.equal(await readFile(image, 'utf8'), original);
  assert.equal(await readFile(p.pending, 'utf8'), updated);
  assert.equal(JSON.parse(await readFile(p.pendingInfo, 'utf8')).sourceSha, next);
  let downloads = 0;
  await stage(image, old, async input => { if (String(input) !== MAIN_FEED) downloads++; return fetcher(publication())(input); });
  assert.equal(downloads, 0, 'same verified staged revision does not download again');
});

test('runtime preflight does not inherit extract-and-run from the running app', async t => {
  const { image } = await sandbox(t);
  const saved = process.env.APPIMAGE_EXTRACT_AND_RUN;
  process.env.APPIMAGE_EXTRACT_AND_RUN = '1';
  try {
    const bytes = '#!/bin/sh\n[ -z "$APPIMAGE_EXTRACT_AND_RUN" ] || exit 8\n[ "$1" = --appimage-version ]\n';
    assert.equal((await stage(image, old, fetcher(publication(next, bytes), bytes))).phase, 'ready');
  } finally { if (saved === undefined) delete process.env.APPIMAGE_EXTRACT_AND_RUN; else process.env.APPIMAGE_EXTRACT_AND_RUN = saved; }
});

test('wrong checksum, oversized/interrupted bytes and HTTP failure preserve installed bytes', async t => {
  const { image, p } = await sandbox(t);
  for (const transport of [fetcher(publication(), updated.replace('7', '9')), fetcher(publication(), updated + 'x'),
    async () => new Response('unavailable', { status: 503 }),
    async (url: string | URL | Request) => String(url) === MAIN_FEED ? Response.json(publication()) : new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.error(new Error('lost connection')); } })),
  ]) {
    await assert.rejects(stage(image, old, transport));
    assert.equal(await readFile(image, 'utf8'), original);
    await assert.rejects(access(p.pendingInfo));
  }
});

test('a stale feed cannot replace a newer pending or installed Main build', async t => {
  const { image, p } = await sandbox(t);
  await stage(image, old, fetcher(publication(latest)));
  await assert.rejects(stage(image, old, fetcher(publication())), /stale|diverges/);
  assert.equal(JSON.parse(await readFile(p.pendingInfo, 'utf8')).sourceSha, latest);
  await atomicJson(p.installed, { sourceSha: latest });
  await assert.rejects(stage(image, old, fetcher(publication())), /stale|diverges/);
  assert.equal(await readFile(image, 'utf8'), original);
});

test('image, metadata and download aliases do not write through to another file', async t => {
  const { root, image, p } = await sandbox(t);
  const other = join(root, 'other'); await writeFile(other, 'preserve', { mode: 0o600 });
  const alias = join(root, 'alias.AppImage'); await symlink(image, alias);
  await assert.rejects(stage(alias, old, fetcher(publication())));
  await symlink(other, p.pendingInfo);
  await assert.rejects(stage(image, old, fetcher(publication())));
  await rm(p.pendingInfo); await symlink(other, p.pending);
  await assert.rejects(stage(image, old, fetcher(publication())));
  assert.equal(await readFile(other, 'utf8'), 'preserve');
  assert.equal(await readFile(image, 'utf8'), original);
});

test('early zero/nonzero exit restores the actual launcher and marker and suppresses that release', async t => {
  for (const exit of [0, 7]) await t.test(`exit ${exit}`, async t => {
    const { image, p } = await sandbox(t);
    await stage(image, old, fetcher(publication()));
    await assert.rejects(restart(image, old, 2147483647, '1', { launch: () => spawn('/bin/sh', ['-c', `exit ${exit}`]) }), /restored/);
    assert.equal(await readFile(image, 'utf8'), original);
    assert.deepEqual(JSON.parse(await readFile(p.installed, 'utf8')), { sourceSha: old });
    await assert.rejects(stage(image, old, fetcher(publication())), /failed to start/);
    assert.deepEqual(await stage(image, old, fetcher(publication(latest))), { phase: 'ready', available: latest });
  });
});

test('readiness accepts the new image, keeps a recoverable backup and does not roll back later exit', async t => {
  const { image, p } = await sandbox(t);
  await stage(image, old, fetcher(publication()));
  await restart(image, old, 2147483647, '1', { launch: (_image, ready) => spawn('/bin/sh', ['-c', 'umask 077; printf %s "$2" > "$1"; sleep 0.05', 'ready', ready, next]) });
  assert.equal(await readFile(image, 'utf8'), updated);
  assert.equal(await readFile(p.backup, 'utf8'), original);
  assert.equal(JSON.parse(await readFile(p.installed, 'utf8')).sourceSha, next);
  await assert.rejects(access(p.pendingInfo));
  await assert.rejects(access(p.failed));
});

test('a readiness signal for another revision cannot accept the downloaded image', async t => {
  const { image, p } = await sandbox(t);
  await stage(image, old, fetcher(publication()));
  await assert.rejects(restart(image, old, 2147483647, '1', { launch: (_image, ready) => spawn('/bin/sh', ['-c',
    'umask 077; printf %s "$2" > "$1"; sleep 0.05', 'ready', ready, old]) }), /restored/);
  assert.equal(await readFile(image, 'utf8'), original);
  assert.equal(JSON.parse(await readFile(p.failed, 'utf8')).sourceSha, next);
});

test('cooperative startup timeout rolls back; a still-live child is never killed or rolled back', async t => {
  const { image, p } = await sandbox(t);
  await stage(image, old, fetcher(publication()));
  await assert.rejects(restart(image, old, 2147483647, '1', { readinessMs: 50, launch: () => spawn('/bin/sleep', ['5']) }), /restored/);
  assert.equal(await readFile(image, 'utf8'), original);
  await rm(p.failed); await stage(image, old, fetcher(publication()));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await assert.rejects(restart(image, old, 2147483647, '1', { readinessMs: 75,
      launch: () => { child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)']); return child; } }), /still live/);
    assert.equal(await readFile(image, 'utf8'), updated);
    assert.equal(await readFile(p.backup, 'utf8'), original);
    await assert.rejects(access(p.failed));
  } finally { if (child && child.exitCode === null) { child.ref(); const done = new Promise(resolve => child!.once('exit', resolve)); child.kill('SIGKILL'); await done; } }
});
