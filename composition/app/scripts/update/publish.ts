/** Single serialized writer for immutable Main images and the channel pointer. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { feed, SHA, RELEASE_PREFIX, type MainFeed } from '../../src/update/contract.ts';

const repository = 'tryapparent/apparent';
const tagPrefix = 'app-shell-main-';
const pointer = 'app-shell-main-feed';
const run = (command: string, args: string[]) => execFileSync(command, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }).trim();
const gh = (...args: string[]) => run('gh', args);
const git = (...args: string[]) => run('git', args);
export function advances(source: string, ancestors: string[], previous?: unknown) {
  if (!SHA.test(source) || !ancestors.includes(source) || ancestors.some(s => !SHA.test(s))) throw new Error('Invalid publication ancestry');
  if (!previous) return true;
  const old = previous as MainFeed;
  feed(old, old.sourceSha);
  if (old.sourceSha === source) return false;
  if (!ancestors.includes(old.sourceSha)) throw new Error('Main channel already contains a newer or divergent build');
  return true;
}
export function publish(directory: string, sourceSha: string) {
  if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_EVENT_NAME !== 'workflow_run' || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Publication requires the canonical Main delivery workflow');
  if (!SHA.test(sourceSha) || git('merge-base', '--is-ancestor', sourceSha, 'origin/main')) throw new Error('Candidate is not on main');
  if (process.env.GITHUB_WORKFLOW !== 'App Shell Main' || process.env.GITHUB_JOB !== 'publish') throw new Error('Unexpected publisher workflow/job');
  // CI caps the only workload jobs at ten minutes plus this two-minute writer,
  // leaving three minutes inside the existing fifteen-minute workflow budget.
  if (process.env.WORKFLOW_BUDGET_RESERVE_SECONDS !== '120') throw new Error('Main publication requires its bounded two-minute reservation');
  const ancestors = git('rev-list', sourceSha).split('\n');
  const work = mkdtempSync(join(tmpdir(), 'app-shell-publish-'));
  try {
    let previous: unknown;
    // Distinguish an absent first channel from an API/auth/network failure.
    const releases = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`)).flat();
    const oldPointer = releases.find((r: any) => r.tag_name === pointer);
    if (oldPointer) {
      gh('release', 'download', pointer, '--repo', repository, '--pattern', 'main.json', '--dir', work);
      previous = JSON.parse(readFileSync(join(work, 'main.json'), 'utf8'));
    }
    if (!advances(sourceSha, ancestors, previous)) return;
    const name = `Apparent-Foundation-main-${sourceSha}-linux-x64.AppImage`;
    const bytes = readFileSync(join(directory, name));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (readFileSync(join(directory, name + '.sha256'), 'utf8') !== `${sha256}  ${name}\n`) throw new Error('Local image/checksum mismatch');
    const tag = tagPrefix + sourceSha;
    const existing = releases.find((r: any) => r.tag_name === tag);
    if (!existing) {
      gh('release', 'create', tag, '--repo', repository, '--target', sourceSha, '--draft', '--prerelease', '--latest=false',
        '--title', `Apparent Foundation Main ${sourceSha.slice(0, 12)}`, '--notes', 'Linux x64 Platform App Shell. Development build; automatically follows verified Main builds.');
    }
    if (!existing || existing.draft) {
      gh('release', 'upload', tag, '--repo', repository, join(directory, name), join(directory, name + '.sha256'), '--clobber');
    }
    const check = () => {
      const remote = JSON.parse(gh('api', `repos/${repository}/releases/tags/${tag}`));
      const asset = remote.assets.find((a: any) => a.name === name);
      const sum = remote.assets.find((a: any) => a.name === name + '.sha256');
      const sumHash = createHash('sha256').update(`${sha256}  ${name}\n`).digest('hex');
      if (!remote.prerelease || remote.target_commitish !== sourceSha || remote.assets.length !== 2
        || asset?.digest !== `sha256:${sha256}` || asset.size !== bytes.length || sum?.digest !== `sha256:${sumHash}`) throw new Error('Remote immutable release identity differs');
      return remote;
    };
    check();
    if (!existing || existing.draft) gh('release', 'edit', tag, '--repo', repository, '--draft=false', '--prerelease', '--latest=false');
    const remote = check();
    if (remote.draft || !remote.published_at) throw new Error('Release is not public');
    const next = feed({ schema: 1, channel: 'main', target: 'linux-x64', sourceSha, ancestors,
      image: { url: `${RELEASE_PREFIX}${sourceSha}/${name}`, sha256, size: bytes.length } }, sourceSha);
    writeFileSync(join(work, 'next.json'), JSON.stringify(next) + '\n');
    if (!oldPointer) gh('release', 'create', pointer, '--repo', repository, '--target', sourceSha, '--prerelease', '--latest=false', '--title', 'App Shell Main channel', '--notes', 'Metadata for the Linux x64 App Shell updater.');
    // gh release upload uses the basename as the asset name.
    writeFileSync(join(work, 'main.json'), readFileSync(join(work, 'next.json')));
    gh('release', 'upload', pointer, '--repo', repository, join(work, 'main.json'), '--clobber');
    const readback = join(work, 'readback');
    gh('release', 'download', pointer, '--repo', repository, '--pattern', 'main.json', '--dir', readback);
    if (readFileSync(join(readback, 'main.json'), 'utf8') !== readFileSync(join(work, 'main.json'), 'utf8')) throw new Error('Main channel readback differs');
    console.log(`Published ${tag}; Main feed readback verified.`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) publish(resolve(process.argv[2]), process.argv[3]);
