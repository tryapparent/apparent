/** Build-time authenticated staging. Never called by the recipient runtime. */
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, chmodSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validate, type Pin } from './validate.ts';
import { targets } from './seal.ts';
export interface StagePin extends Pin { version: string; manifest: { schema: number; protocol: number; repository: string; workflow: string; executable: string } }
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
    const asset = `${pin.version}-${target}.tar.gz`;
    execute('gh', ['release', 'download', pin.version, '--repo', 'tryapparent/apparent', '--pattern', asset, '--dir', temporary]);
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
    renameSync(temporary, output);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 5) throw Error('Usage: node --experimental-strip-types stage.ts PIN.json TARGET DESTINATION');
    stage(process.argv[2], process.argv[3], process.argv[4]);
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
