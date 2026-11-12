const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
test('popup assets replace old output without shipping another runtime and refuse symlink destinations', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apparent-popup-assets-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'), out = path.join(dir, 'installed');
  await fs.mkdir(path.join(source, 'electron/notes'), { recursive: true });
  await fs.mkdir(path.join(source, 'dist'));
  await fs.writeFile(path.join(source, 'electron/notes/main.cjs'), 'notes');
  await fs.writeFile(path.join(source, 'electron/notes/presentation.cjs'), 'generated policy');
  await fs.writeFile(path.join(source, 'electron/runtime.cjs'), 'same-user reporting adapter');
  await fs.writeFile(path.join(source, 'dist/index.html'), 'renderer');
  const { stagePopupAssets } = await import('../../scripts/popup-entries.mjs');
  for (const unsafe of [source, dir, path.join(source, 'nested/output')]) {
    await assert.rejects(stagePopupAssets(source, unsafe), /overlap/);
    assert.equal(await fs.readFile(path.join(source, 'dist/index.html'), 'utf8'), 'renderer');
  }
  const alias = path.join(dir, 'source-alias');
  await fs.symlink(source, alias);
  await assert.rejects(stagePopupAssets(source, path.join(alias, 'nested/output')), /overlap/);
  await fs.mkdir(path.join(out, 'runtime'), { recursive: true });
  await fs.writeFile(path.join(out, 'runtime/old-electron'), 'obsolete generated runtime');
  await stagePopupAssets(source, out);
  assert.equal(await fs.readFile(path.join(out, 'dist/index.html'), 'utf8'), 'renderer');
  assert.equal(await fs.readFile(path.join(out, 'electron/notes/main.cjs'), 'utf8'), 'notes');
  assert.equal(await fs.readFile(path.join(out, 'electron/notes/presentation.cjs'), 'utf8'), 'generated policy');
  assert.equal(await fs.readFile(path.join(out, 'electron/runtime.cjs'), 'utf8'), 'same-user reporting adapter');
  await assert.rejects(fs.stat(path.join(out, 'runtime')), { code: 'ENOENT' });
  const link = path.join(dir, 'link');
  await fs.symlink(source, link);
  await assert.rejects(stagePopupAssets(source, link), /Unsafe|overlap/);
  assert.equal(await fs.readFile(path.join(source, 'dist/index.html'), 'utf8'), 'renderer');
});
test('popup packaging requires notes and includes a present independent share entry', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apparent-popup-entries-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'source'), out = path.join(dir, 'package');
  const { stagePopupEntries } = await import('../../scripts/popup-entries.mjs');
  await assert.rejects(stagePopupEntries(root, out), { code: 'ENOENT' });
  await fs.mkdir(path.join(root, 'electron/notes'), { recursive: true });
  await fs.writeFile(path.join(root, 'electron/notes/main.cjs'), 'notes entry');
  await fs.writeFile(path.join(root, 'electron/runtime.cjs'), 'same-user reporting adapter');
  await assert.rejects(stagePopupEntries(root, out), { code: 'ENOENT' });
  await fs.writeFile(path.join(root, 'electron/notes/presentation.cjs'), 'generated policy');
  await stagePopupEntries(root, out);
  assert.equal(await fs.readFile(path.join(out, 'electron/notes/main.cjs'), 'utf8'), 'notes entry');
  await fs.mkdir(path.join(root, 'electron/share'));
  await assert.rejects(stagePopupEntries(root, out), { code: 'ENOENT' });
  await fs.writeFile(path.join(root, 'electron/share/main.cjs'), 'share entry');
  await fs.writeFile(path.join(root, 'electron/share/preload.cjs'), 'separate protocol');
  await stagePopupEntries(root, out);
  assert.equal(await fs.readFile(path.join(out, 'electron/share/main.cjs'), 'utf8'), 'share entry');
  assert.equal(await fs.readFile(path.join(out, 'electron/share/preload.cjs'), 'utf8'), 'separate protocol');
  await assert.rejects(fs.stat(path.join(out, 'runtime')), { code: 'ENOENT' });
});

test('production staging ships the generated TypeScript policy actually loaded by notes main', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apparent-notes-policy-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.resolve(__dirname, '../..');
  const { stagePopupEntries } = await import('../../scripts/popup-entries.mjs');
  await stagePopupEntries(root, dir);
  const policyPath = path.join(dir, 'electron/notes/presentation.cjs');
  assert.deepEqual(await fs.readFile(policyPath), await fs.readFile(path.join(root, 'electron/notes/presentation.cjs')));
  const main = await fs.readFile(path.join(dir, 'electron/notes/main.cjs'), 'utf8');
  assert.match(main, /require\('\.\/presentation\.cjs'\)/);
  assert.match(main, /projectSnapshot\(presentation, state\)/);
  const { initialPresentation, projectSnapshot } = require(policyPath);
  const state = projectSnapshot(initialPresentation([20, 30]), {
    events: [{ kind: 'embedded', value: true }, { kind: 'badge', rect: [100, 40, 584, 56] }, { kind: 'list' }],
    notes: [], drafts: [], error: null,
  });
  assert.equal(state.mode, 'list');
  assert.deepEqual(state.position, [684, 96]);
  assert.equal(state.embedded, true);
});
