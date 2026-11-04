import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(frontend, '../../../..');
const receiptDefault = path.join(process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '/tmp', '.cache'),
  'apparent', 'desktop-settings-native.json');
const testNameSuffix = '::storage_electron_rust_roundtrip';

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean } = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd || root, env: options.env || process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function sha256(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function nativeInputs(directory = root, relative = ''): Promise<Array<[string, string]>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found: Array<[string, string]> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'target' || entry.name === 'node_modules' || entry.name === '.t3') continue;
    const absolute = path.join(directory, entry.name);
    const rel = path.join(relative, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) {
      found.push(...await nativeInputs(absolute, rel));
    } else if (/\.(rs|c|h|m|mm|swift)$/.test(entry.name) ||
      entry.name === 'Cargo.toml' || entry.name === 'Cargo.lock' || entry.name === 'build.rs' ||
      entry.name === 'rust-toolchain' || entry.name === 'rust-toolchain.toml' ||
      (relative === '.cargo' && entry.name.startsWith('config'))) {
      found.push([rel, sha256(await readFile(absolute))]);
    }
  }
  return found;
}

async function nativeSourceHash() {
  const inputs = await nativeInputs();
  return { hash: sha256(JSON.stringify(inputs)), count: inputs.length };
}

async function locateHarness(output: string) {
  const executable = output.match(/(?:^|\n)\s*Executable\s+.+?\s+\(([^()\n]+)\)(?:\n|$)/m)?.[1];
  if (!executable) throw new Error('Cargo output did not identify the Rust test executable');
  const resolved = path.resolve(root, executable);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`Rust test executable is not a file: ${resolved}`);
  return resolved;
}

async function prepareNative() {
  if (process.platform !== 'linux') throw new Error('The real Rust/Electron Settings bridge lane requires Linux');
  const built = await run('cargo', ['test', '--offline', 'storage_electron_rust_roundtrip', '--no-run'], { capture: true });
  process.stdout.write(built.stdout);
  process.stderr.write(built.stderr);
  if (built.code !== 0) throw new Error(`Cargo preparation failed (${built.code})`);
  const backend = await locateHarness(`${built.stdout}\n${built.stderr}`);
  const listing = await run(backend, ['--list'], { capture: true });
  if (listing.code !== 0) throw new Error(`Prepared Rust harness could not list tests (${listing.code}): ${listing.stderr}`);
  const testName = listing.stdout.split(/\r?\n/).find(line => line.endsWith(`${testNameSuffix}: test`))?.split(': test')[0];
  if (!testName) throw new Error('Prepared Rust harness does not contain storage_electron_rust_roundtrip');
  const rustc = await run('rustc', ['-Vv'], { capture: true });
  if (rustc.code !== 0) throw new Error(`Could not record rustc version (${rustc.code})`);
  const inputs = await nativeSourceHash();
  const manifest = {
    schema: 1,
    createdAt: new Date().toISOString(),
    sourceCommit: (await run('git', ['rev-parse', 'HEAD'], { capture: true })).stdout.trim(),
    platform: process.platform,
    architecture: process.arch,
    rustc: rustc.stdout.trim(),
    nativeInputHash: inputs.hash,
    nativeInputCount: inputs.count,
    backend: path.relative(root, backend).split(path.sep).join('/'),
    backendSha256: sha256(await readFile(backend)),
    testName,
    buildCommand: 'cargo test --offline storage_electron_rust_roundtrip --no-run',
  };
  const output = process.argv[3] ? path.resolve(process.argv[3]) : receiptDefault;
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, output);
  await chmod(output, 0o600);
  console.log(`Prepared native Settings bridge backend: ${backend}`);
  console.log(`Private compatibility receipt: ${output}`);
  console.log(`Native inputs: ${inputs.count} files, sha256 ${inputs.hash}`);
}

async function readVerifiedReceipt() {
  const receipt = path.resolve(process.argv[3] || receiptDefault);
  const manifest = JSON.parse(await readFile(receipt, 'utf8'));
  if (manifest.schema !== 1) throw new Error('Unsupported native bridge receipt schema');
  if (manifest.platform !== process.platform || manifest.architecture !== process.arch)
    throw new Error('Native bridge receipt is for a different platform or architecture');
  if (process.platform !== 'linux') throw new Error('The real Rust/Electron Settings bridge lane requires Linux');
  if (typeof manifest.backend !== 'string' || !manifest.backend.startsWith('target/debug/deps/apparent-'))
    throw new Error('Receipt does not identify the expected in-checkout Rust test executable');
  const inputs = await nativeSourceHash();
  if (manifest.nativeInputHash !== inputs.hash)
    throw new Error('Native source/build inputs changed; prepare a new backend receipt and rerun native integration gates');
  if (manifest.nativeInputCount !== inputs.count)
    throw new Error('Native input set changed; prepare a new backend receipt');
  const backend = path.resolve(root, manifest.backend);
  if (!(await stat(backend)).isFile() || sha256(await readFile(backend)) !== manifest.backendSha256)
    throw new Error('Prepared Rust test backend is missing or changed; prepare a new backend receipt');
  return { manifest, backend, receipt };
}

async function runSettings() {
  const { manifest, backend, receipt } = await readVerifiedReceipt();
  console.log(`Using unchanged prebuilt Rust backend ${manifest.backend} (${manifest.backendSha256})`);
  console.log(`Verified native input hash ${manifest.nativeInputHash}; receipt ${receipt}`);
  const dist = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  if (!dist || !path.isAbsolute(dist) || path.resolve(dist).includes(`${path.sep}node_modules${path.sep}`))
    throw new Error('Set ELECTRON_OVERRIDE_DIST_PATH to an absolute preinstalled Electron dist outside node_modules; the check never downloads Electron');
  const expectedElectron = path.join(dist, 'electron');
  const expectedInfo = await stat(expectedElectron).catch(() => undefined);
  if (!expectedInfo?.isFile()) throw new Error(`Preinstalled Electron executable is missing: ${expectedElectron}`);
  const electron = await run('node', ['-p', "require('electron')"], { cwd: frontend, capture: true });
  if (electron.code !== 0) throw new Error(`Could not resolve installed Electron executable: ${electron.stderr}`);
  const electronPath = electron.stdout.trim();
  if (!path.isAbsolute(electronPath)) throw new Error(`Electron did not resolve to an absolute path: ${electronPath}`);
  if (path.resolve(electronPath) !== path.resolve(expectedElectron))
    throw new Error(`Electron resolved outside the required preinstalled distribution: ${electronPath}`);

  for (const [command, args, cwd] of [
    ['npm', ['run', 'build'], frontend],
    ['npm', ['test'], frontend],
    ['xvfb-run', ['-a', 'npm', 'run', 'test:electron'], frontend],
  ] as const) {
    const result = await run(command, [...args], { cwd });
    if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.code})`);
  }
  const bridge = await run(backend, [manifest.testName, '--ignored', '--exact', '--nocapture', '--test-threads=1'], {
    env: { ...process.env, APPARENT_STORAGE_TEST_ELECTRON: electronPath },
  });
  if (bridge.code !== 0) throw new Error(`Prebuilt Rust/Electron Storage bridge test failed (${bridge.code})`);
  console.log(`Settings checks passed using the prepared real Rust listener and Electron ${electronPath}`);
}

const action = process.argv[2];
try {
  if (action === 'prepare-native') await prepareNative();
  else if (action === 'test') await runSettings();
  else throw new Error('Usage: settings-check.ts <prepare-native [receipt-path] | test [receipt-path]>');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
