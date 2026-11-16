// Publish only the exact archive admitted by the clean build and native matrix.
import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const directory = resolve(process.argv[2] || '/tmp/apparent-dev-hermes-publish');
const files = readdirSync(directory);
const archives = files.filter(name => name.endsWith('.tar.gz'));
const checksums = files.filter(name => name.endsWith('.sha256'));
if (archives.length !== 1 || checksums.length !== 1) throw Error('Expected exactly one archive and checksum');
const archive = archives[0];
const version = /^apparent-hermes-(\d+\.\d+\.\d+)\.tar\.gz$/.exec(archive)?.[1];
if (!version || checksums[0] !== archive + '.sha256') throw Error('Unexpected release filenames');
const digest = createHash('sha256').update(readFileSync(resolve(directory, archive))).digest('hex');
if (readFileSync(resolve(directory, checksums[0]), 'utf8').trim() !== `${digest}  ${archive}`) throw Error('Release checksum mismatch');
if (process.argv[3] !== '--check') {
  const sha = process.env.SHA;
  if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw Error('Missing immutable candidate SHA');
  execFileSync('gh', ['release', 'create', `hermes-v${version}-${sha}`, '--target', sha,
    '--title', `Hermes ${version} (${sha})`, '--prerelease', '--notes',
    'Complete Hermes Agent and Desktop plugin. Verify the checksum, extract, and run node install.cjs --profile /absolute/Hermes/profile. Requires a compatible installed Apparent native app for recording; see bundled compatibility.json. This release is not catalog admission.',
    archive, checksums[0]], {cwd: directory, stdio: 'inherit'});
}
