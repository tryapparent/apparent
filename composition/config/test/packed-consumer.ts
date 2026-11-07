import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const owner = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = resolve(owner, '../../shared/contracts');
const root = process.env.APPARENT_CONFIG_PACKED_PROOF ?? await mkdtemp(join(tmpdir(), 'config-packed-'));
const packages = join(root, 'packages'), consumer = join(root, 'consumer'), denied = join(root, 'denied');
await Promise.all([packages, consumer, denied].map(p => mkdir(p, { recursive: true })));
function run(label: string, executable: string, args: string[], cwd: string, env = process.env) {
  const r = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 4_000_000 });
  const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  // Retain diagnostics even when the check fails.
  return writeFile(join(root, `${label}.log`), output).then(() => {
    if (r.error || r.status !== 0) throw new Error(`${label} failed: ${output.slice(-4000)}`);
    return output;
  });
}
const npm = process.env.npm_execpath!;
for (const [path, label] of [[contracts, 'contracts'], [owner, 'config']] as const) {
  await run(`pack-${label}`, process.execPath, [npm, 'pack', '--pack-destination', packages], path);
}
for (const name of ['cargo', 'rustc', 'tsc', 'esbuild']) await symlink('/bin/false', join(denied, name));
const env = { ...process.env, PATH: `${denied}:${process.env.PATH}`, npm_config_cache: join(root, 'npm-cache') };
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
const tars = ['apparent-app-contracts-0.1.0.tgz', 'apparent-config-host-0.1.0.tgz'];
await run('install', process.execPath, [npm, 'install', '--no-audit', '--no-fund', ...tars.map(p => join(packages, p))], consumer, env);
for (const name of ['react', 'react-dom', 'electron', '@types/react', '@apparent/ui']) {
  await assert.rejects(access(join(consumer, 'node_modules', name)), { code: 'ENOENT' });
}
assert.deepEqual((await readdir(join(consumer, 'node_modules/@apparent/config-host'))).sort(), ['README.md', 'dist', 'package.json']);
await writeFile(join(consumer, 'smoke.ts'), `import {createConnectCloudConfig,MAX_CONNECT_CLOUD_VALUE_BYTES,type ConnectCloudConfig} from '@apparent/config-host/cloud';
const config: Promise<ConnectCloudConfig & {close():Promise<void>}> = createConnectCloudConfig({executable:'/unavailable',executableSha256:'0'.repeat(64),configPath:'/unavailable'});
void config.catch(()=>{}); if(MAX_CONNECT_CLOUD_VALUE_BYTES!==16384) throw Error('limit');`);
await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, types: [], skipLibCheck: false }, files: ['smoke.ts'] }));
await run('strict-types', process.execPath, [join(owner, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer, env);
await writeFile(join(consumer, 'smoke.mjs'), `import assert from 'node:assert/strict'; import {createConnectCloudConfig,MAX_CONNECT_CLOUD_VALUE_BYTES} from '@apparent/config-host/cloud'; import {createConfigBackend} from '@apparent/config-host'; assert.equal(typeof createConfigBackend,'function'); assert.equal(MAX_CONNECT_CLOUD_VALUE_BYTES,16384); await assert.rejects(createConnectCloudConfig({executable:'relative',executableSha256:'0'.repeat(64),configPath:'/unused'}));`);
await run('plain-node', process.execPath, ['smoke.mjs'], consumer, env);
await mkdir(join(consumer, 'test'));
for (const name of ['peer.ts', 'client.test.ts', 'cloud.test.ts']) {
  const original = await readFile(join(owner, 'test', name), 'utf8');
  const updated = original.replaceAll("'../src/client.ts'", "'@apparent/config-host'").replaceAll("'../src/cloud.ts'", "'@apparent/config-host/cloud'");
  await writeFile(join(consumer, 'test', name), updated, { mode: name === 'peer.ts' ? 0o755 : 0o600 });
}
await run('packed-tests', process.execPath, ['--experimental-strip-types', '--test', 'test/client.test.ts', 'test/cloud.test.ts'], consumer, env);
const hashes = await Promise.all(tars.map(async name => ({ name, sha256: createHash('sha256').update(await readFile(join(packages, name))).digest('hex') })));
await writeFile(join(root, 'proof.json'), JSON.stringify({ node: process.version, scriptsEnabled: true, denied: ['cargo', 'rustc', 'tsc', 'esbuild'], packages: hashes, passed: true }, null, 2));
console.log(`Packed config consumer passed: ${root}`);
