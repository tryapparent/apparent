/** Real AppImage inspection proof; no GUI, capture, network or provisioning. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const [imageArg, workArg] = process.argv.slice(2);
assert(process.platform === 'linux' && imageArg && workArg, 'Usage: linux-package-proof.ts IMAGE NEW_WORK');
const work = resolve(workArg); mkdirSync(work, { mode: 0o700 });
const image = join(work, 'Apparent.AppImage'); copyFileSync(resolve(imageArg), image);
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const cases: unknown[] = [];
const home = join(work, 'home'); mkdirSync(home);
const env = { ...process.env, HOME: home, XDG_DATA_HOME: join(home, '.local/share'), APPIMAGE_EXTRACT_AND_RUN: '1' };
delete env.APPARENT_CAPTURES_DIR;
function run(executable: string, args: string[], status = 0, extra = {}) {
  const r = spawnSync(executable, args, { cwd: home, env: { ...env, ...extra }, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  cases.push({ args, status: r.status, stderr: r.stderr });
  writeFileSync(join(work, 'proof.json'), JSON.stringify({ imageSha256: hash(image), cases }, null, 2));
  assert.equal(r.status, status, r.stderr); return r.stdout;
}
const fixtures = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
for (const name of ['legacy', 'current']) {
  const bundle = join(home, '.local/share/apparent/captures', name + '.apparent'); mkdirSync(bundle, { recursive: true });
  const manifest = join(bundle, 'apparent.json'); copyFileSync(join(fixtures, name + '.json'), manifest);
  const before = { hash: hash(manifest), mtime: statSync(manifest).mtimeMs };
  for (const [suffix, flags] of [['md', []], ['normalized.json', ['--json']], ...(name === 'current' ? [['agent.md', ['--experiment', 'agentContext']], ['marks.json', ['--marks', '--json']]] : [])] as [string, string[]][]) {
    assert.equal(run(image, ['inspect', bundle, ...flags]).replaceAll(realpathSync(bundle), '@BUNDLE@'), readFileSync(join(fixtures, `${name}.${suffix}`), 'utf8'));
  }
  assert.equal(hash(manifest), before.hash); assert.equal(statSync(manifest).mtimeMs, before.mtime);
}
assert.equal(JSON.parse(run(image, ['inspect', 'latest', '--json'])).id, 'current');
mkdirSync(join(home, '.config/apparent'), { recursive: true });
writeFileSync(join(home, '.config/apparent/config.json'), JSON.stringify({ capturesDir: join(home, '.local/share/apparent/captures') }));
assert.equal(JSON.parse(run(image, ['inspect', 'legacy', '--json'])).id, 'legacy');
run(image, ['inspect', join(home, 'absent.apparent')], 1);
run(image, ['inspect', '--unknown-option'], 2);
// Exercise the packaged root/component integrity boundary after real AppImage extraction.
const extracted = spawnSync(image, ['--appimage-extract'], { cwd: work, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
assert.equal(extracted.status, 0, extracted.stderr);
const bin = join(work, 'squashfs-root/usr/bin');
writeFileSync(join(bin, 'inspection/apparent-inspect'), 'tampered');
const r = spawnSync(join(bin, 'apparent'), ['inspect', join(home, '.local/share/apparent/captures/current.apparent')], {
  cwd: home, env: { ...env, LD_LIBRARY_PATH: join(work, 'squashfs-root/usr/lib') }, encoding: 'utf8' });
assert.equal(r.status, 1, r.stderr); assert.match(r.stderr, /digest mismatch/);
console.log(`Real AppImage: ${cases.length} dispatch/golden/lookup/error cases; tamper rejection; ${join(work, 'proof.json')}`);
