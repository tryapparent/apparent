/** Real executable/access proof; provenance transport is an isolated fixture, not a release attestation. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { assemble } from '../package.ts';
import { stage } from '../stage.ts';
import { targets } from '../seal.ts';
const executable = process.env.APPARENT_RECIPIENT_EXECUTABLE;
test('root-owned shipping recipient is traversable/executable by the intended different runtime user',
 { skip: !executable || process.platform !== 'linux' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'recipient-runtime-user-'));
  chmodSync(root, 0o755);
  const target = `${process.arch === 'x64' ? 'x86_64' : 'aarch64'}-unknown-linux-gnu`;
  const bytes = readFileSync(resolve(executable!));
  const identity = { schema: 1, protocol: 1, repository: 'tryapparent/apparent', workflow: '.github/workflows/connect-delivery.yml', executable: 'apparent-connect-recipient' };
  const pin = { target, sourceSha: 'a'.repeat(40), run: '123', attempt: '1', sha256: createHash('sha256').update(bytes).digest('hex'), version: `recipient-${'a'.repeat(40)}-123-1`, manifest: identity };
  const archive = join(root, 'fixture.tar.gz');
  const payload = join(root, 'payload'); mkdirSync(payload);
  writeFileSync(join(payload, 'apparent-connect-recipient'), bytes);
  writeFileSync(join(payload, 'manifest.json'), JSON.stringify({ ...identity, ...pin }));
  execFileSync('tar', ['-czf', archive, '-C', payload, 'manifest.json', 'apparent-connect-recipient']);
  const pins = join(root, 'pins.json');
  writeFileSync(pins, JSON.stringify({ schema: 1, adopted: true, pins: Object.fromEntries(targets.map(t => [t, { ...pin, target: t }])) }));
  const destination = join(root, 'bin'); mkdirSync(destination, { mode: 0o755 });
  const home = join(root, 'receiver'); mkdirSync(home, { mode: 0o700 });
  writeFileSync(join(home, 'config.json'), '{}');
  let changedOwner = false;
  try {
    const runner = (command: string, args: string[]) => {
      if (command === 'gh' && args[0] === 'api') return Buffer.from(JSON.stringify({ id: 123, run_attempt: 1, repository: { full_name: 'tryapparent/apparent' }, head_repository: { full_name: 'tryapparent/apparent' }, head_branch: 'main', head_sha: pin.sourceSha, path: '.github/workflows/connect-delivery.yml', event: 'push', status: 'completed', conclusion: 'success' }));
      if (command === 'gh' && args[0] === 'release') { copyFileSync(archive, join(args.at(-1)!, args[6])); return Buffer.alloc(0); }
      if (command === 'gh' && args[0] === 'attestation') return Buffer.alloc(0);
      return execFileSync(command, args, { maxBuffer: 256 * 1024 * 1024 });
    };
    assemble(pins, target, destination, [], { stage: (p,t,d) => stage(p,t,d,runner), run: execFileSync });
    const shipping = join(destination, 'recipient');
    assert.equal(statSync(shipping).mode & 0o777, 0o755);
    execFileSync('sudo', ['-n', 'chown', '-R', '0:0', root]); changedOwner = true;
    execFileSync('sudo', ['-n', 'chown', '-R', '65534:65534', home]);
    const result = spawnSync('sudo', ['-n', '-u', 'nobody', '--', 'env', `HOME=${home}`, `APPARENT_CONFIG=${join(home, 'config.json')}`, join(shipping, 'apparent-connect-recipient')], {
      cwd: root, input: JSON.stringify({ protocol: 1, operation: { kind: 'status', account: false } }), encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const response = JSON.parse(result.stdout.trim()); assert.equal(response.protocol, 1); assert(response.result);
    console.log('Actual recipient status succeeded as uid 65534 from a root-owned 0755 shipping directory');
  } finally {
    if (changedOwner) execFileSync('sudo', ['-n', 'chown', '-R', `${process.getuid!()}:${process.getgid!()}`, root]);
    rmSync(root, { recursive: true });
  }
});
