/** Build-time authenticated staging. Never called by the recipient runtime. */
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, chmodSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validate, type Pin } from './validate.ts';
import { targets } from './seal.ts';
import { publishValidatedDirectory } from '../../../shared/packaging/transaction.ts';
export interface StagePin extends Pin { version: string; releaseVersion?: string; manifest: { schema: number; protocol: number; repository: string; workflow: string; executable: string } }
export type Runner = (command: string, args: string[]) => Buffer;
const run: Runner = (command, args) => execFileSync(command, args, { maxBuffer: 256 * 1024 * 1024 });
export function stage(pinFile: string, target: string, destination: string, execute: Runner = run) {
  const pin = JSON.parse(readFileSync(pinFile, 'utf8')) as StagePin;
  if (!pin || !targets.includes(target) || pin.target !== target ||
      !/^[a-f0-9]{40}$/.test(pin.sourceSha) || !/^[1-9][0-9]*$/.test(pin.run) ||
      !/^[1-9][0-9]*$/.test(pin.attempt) || !/^[a-f0-9]{64}$/.test(pin.sha256) ||
      pin.version !== `recipient-${pin.sourceSha}-${pin.run}-${pin.attempt}` ||
      !pin.manifest || Object.entries({ schema: 1, protocol: 1, repository: 'tryapparent/apparent', workflow: '.github/workflows/connect-delivery.yml', executable: 'apparent-connect-recipient' }).some(([key, value]) => (pin.manifest as unknown as Record<string, unknown>)[key] !== value)) throw Error('Invalid staging pin');
  const output = resolve(destination);
  // Release assembly can reuse successful jobs from an earlier run attempt.
  // The reviewed release tag locates bytes; the original pin authenticates them.
  const releaseVersion = pin.releaseVersion ?? pin.version;
  const release = /^recipient-([a-f0-9]{40})-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(releaseVersion);
  if (!release || release[1] !== pin.sourceSha || release[2] !== pin.run || BigInt(release[3]) < BigInt(pin.attempt)) throw Error('Invalid release version');
  // Publication can precede the final workflow budget audit. Attested bytes alone
  // do not establish that the trusted producer attempt was admitted successfully.
  const producer = JSON.parse(execute('gh', ['api', `repos/tryapparent/apparent/actions/runs/${pin.run}/attempts/${release[3]}`]).toString('utf8'));
  if (!Number.isSafeInteger(Number(pin.run)) || !Number.isSafeInteger(Number(release[3])) ||
      producer.id !== Number(pin.run) || producer.run_attempt !== Number(release[3]) ||
      producer.repository?.full_name !== 'tryapparent/apparent' || producer.head_repository?.full_name !== 'tryapparent/apparent' ||
      producer.head_branch !== 'main' || producer.head_sha !== pin.sourceSha ||
      producer.path !== '.github/workflows/connect-delivery.yml' || !['push','workflow_dispatch'].includes(producer.event) ||
      producer.status !== 'completed' || producer.conclusion !== 'success') throw Error('Recipient producer attempt is not admitted');
  // Reject symlink ancestors, including existing output. Never replace user data.
  for (let path = output;; path = dirname(path)) {
    try { if (lstatSync(path).isSymbolicLink()) throw Error('Symlink destination'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dirname(path) === path) break;
  }
  try { lstatSync(output); throw Error('Destination already exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  mkdirSync(dirname(output), { recursive: true });
  const temporary = mkdtempSync(join(dirname(output), '.recipient-stage-'));
  chmodSync(temporary, 0o700);
  try {
    const asset = `${releaseVersion}-${target}.tar.gz`;
    execute('gh', ['release', 'download', releaseVersion, '--repo', 'tryapparent/apparent', '--pattern', asset, '--dir', temporary]);
    const archive = join(temporary, asset);
    const members = execute('tar', ['-tzf', archive]).toString('utf8').trim().split('\n');
    if (members.length !== 2 || new Set(members).size !== 2 || !members.includes('manifest.json') || !members.includes('apparent-connect-recipient')) throw Error('Unexpected archive members');
    // Extract each member to stdout: archive links and paths never reach the filesystem.
    for (const name of members) {
      const bytes = execute('tar', ['-xOzf', archive, '--', name]);
      writeFileSync(join(temporary, name), bytes, { flag: 'wx', mode: 0o600 });
    }
    for (const name of members) execute('gh', ['attestation', 'verify', join(temporary, name), '--repo', 'tryapparent/apparent', '--signer-workflow', 'tryapparent/apparent/.github/workflows/connect-delivery.yml', '--source-ref', 'refs/heads/main', '--source-digest', pin.sourceSha]);
    validate(readFileSync(join(temporary, 'apparent-connect-recipient')), JSON.parse(readFileSync(join(temporary, 'manifest.json'), 'utf8')), { sourceSha: pin.sourceSha, run: pin.run, attempt: pin.attempt, target: pin.target, sha256: pin.sha256 });
    rmSync(archive);
    chmodSync(join(temporary, 'apparent-connect-recipient'), 0o755);
    chmodSync(join(temporary, 'manifest.json'), 0o644);
    publishValidatedDirectory(temporary, output);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 5) throw Error('Usage: node --experimental-strip-types stage.ts PIN.json TARGET DESTINATION');
    stage(process.argv[2], process.argv[3], process.argv[4]);
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
