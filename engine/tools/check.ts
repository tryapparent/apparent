/** Supported Engine producer check. All generated output goes to a private job root. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const positional = process.argv.slice(2).filter(arg => arg !== '--sdk-only');
if (positional.length > 1) throw Error('Use check.ts [private output directory] [--sdk-only]');
const output = positional[0] ?? mkdtempSync('/tmp/apparent-dev-engine-');
if (!isAbsolute(output)) throw Error('Engine output must be an absolute private job directory');
mkdirSync(output, {recursive: true, mode: 0o700});
const run = (program: string, args: string[], cwd = root, extra: Record<string, string> = {}) =>
  execFileSync(program, args, {cwd, stdio: 'inherit', env: {...process.env, ...extra}});
const sdk = join(root, 'engine/sdk');
run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], sdk);
run('npm', ['test'], sdk);
run('npm', ['run', 'typecheck'], sdk);
const stage = mkdtempSync(join(output, 'sdk-'));
const source = JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8'));
const {scripts, devDependencies, ...metadata} = source;
const sdkArchive = `apparent-engine-sdk-${source.version}.tgz`;
writeFileSync(join(stage, 'package.json'), JSON.stringify(metadata, null, 2));
cpSync(join(sdk, 'README.md'), join(stage, 'README.md'));
cpSync(join(sdk, 'LICENSE'), join(stage, 'LICENSE'));
run(process.execPath, [join(sdk, 'node_modules/typescript/bin/tsc'), '-p', join(sdk, 'tsconfig.json'), '--outDir', join(stage, 'dist')]);
const artifacts = join(output, 'artifacts');
// An existing artifact directory must never mix a prior candidate into this run.
mkdirSync(artifacts);
run('npm', ['pack', stage, '--ignore-scripts', '--pack-destination', artifacts]);
const consumer = mkdtempSync(join(output, 'consumer-'));
writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(artifacts, sdkArchive)], consumer);
run(process.execPath, ['--input-type=module', '-e', `
  import {parseMovieInfo, decodeMovieFrames} from '@apparent/engine-sdk';
  import assert from 'node:assert/strict';
  assert.deepEqual(parseMovieInfo('{"format":{},"streams":[]}'), {durationMs:null,video:null,audio:[]});
  assert.equal(typeof decodeMovieFrames, 'function');
`], consumer);
if (process.argv.includes('--sdk-only')) {
  console.log(`Rust-free SDK qualified: ${artifacts}`);
  process.exit(0);
}
// Producer compilation is explicit and isolated; the SDK never invokes Cargo.
const target = join(output, 'cargo');
const native = join(root, 'engine/native'), nativeSource = mkdtempSync(join(output, 'native-source-'));
cpSync(native, nativeSource, {recursive: true, filter: path => path !== join(native, 'target')});
// Cargo discovers ancestor configuration from cwd. Build the copied owner
// outside the repo so root .cargo settings cannot silently enter this closure.
run('cargo', ['build', '--release', '--locked', '--features', 'frames', '-j', process.env.T3_BUILD_JOBS ?? '3', '--target-dir', target], nativeSource);
const name = `engine-media-${process.platform}-${process.arch}`;
const runtime = join(output, name);
mkdirSync(runtime, {recursive: true, mode: 0o700});
const files = ['apparent-engine-media', 'apparent-engine-frames'];
if (process.platform === 'darwin') files.push('apparent-engine-probe', 'apparent-engine-frames-native');
for (const file of files) { cpSync(join(target, 'release', file), join(runtime, file)); chmodSync(join(runtime, file), 0o755); }
cpSync(join(sdk, 'LICENSE'), join(runtime, 'LICENSE'));
const nativeVersion = execFileSync(join(runtime, files[0]), ['--version'], {encoding: 'utf8'}).trim();
if (!/^apparent-engine-media \d+\.\d+\.\d+$/.test(nativeVersion)) throw Error('Invalid native version');
if (execFileSync(join(runtime, 'apparent-engine-frames'), ['--version'], {encoding: 'utf8'}).trim() !==
    'apparent-engine-frames ' + nativeVersion.split(' ')[1]) throw Error('Mismatched frame provider');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const sourceDirty = !!execFileSync('git', ['status', '--porcelain', '--', 'engine'], {cwd: root, encoding: 'utf8'}).trim();
const manifest = {schema: 1, capability: 'movie-probe/1', version: nativeVersion.split(' ')[1], sdkVersion: source.version, sourceCommit,
  capabilities: ['movie-probe/1', 'movie-frames/1'],
  sourceDirty,
  platform: process.platform, arch: process.arch,
  prerequisites: process.platform === 'linux' ? ['ffprobe on PATH (FFmpeg)', 'glibc',
    'GStreamer 1.24+ core/app/video, base/good/libav runtime plugins for frames'] : ['macOS 15 or later'],
  files: [...files, 'LICENSE'].map(path => ({path, sha256: createHash('sha256').update(readFileSync(join(runtime, path))).digest('hex'), mode: path === 'LICENSE' ? 0o644 : 0o755}))};
writeFileSync(join(runtime, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
run('tar', ['-czf', join(artifacts, name + '.tar.gz'), '-C', output, name]);
const installed = join(output, 'installed');
mkdirSync(installed, {recursive: true});
run('tar', ['-xzf', join(artifacts, name + '.tar.gz'), '-C', installed]);
const executable = join(installed, name, files[0]);
for (const file of files) run(process.platform === 'darwin' ? 'otool' : 'ldd',
  process.platform === 'darwin' ? ['-L', join(installed, name, file)] : [join(installed, name, file)]);
if (process.platform === 'linux') {
  const metadataLinks = execFileSync('ldd', [executable], {encoding: 'utf8'});
  if (/gstreamer|transcribe|gpui|gtk/i.test(metadataLinks)) throw Error('Metadata reader acquired unrelated native dependencies');
}
// Run the native check through the public package export in the clean consumer.
cpSync(join(root, 'engine/tools/qualify.ts'), join(consumer, 'qualify.ts'));
cpSync(join(root, 'engine/tools/qualify-frames.ts'), join(consumer, 'qualify-frames.ts'));
run(process.execPath, ['--experimental-strip-types', join(consumer, 'qualify.ts'), executable, output], consumer);
for (const file of [name + '.tar.gz', sdkArchive]) {
  writeFileSync(join(artifacts, file + '.sha256'), createHash('sha256').update(readFileSync(join(artifacts, file))).digest('hex') + '  ' + file + '\n');
}
console.log(`Engine artifacts: ${artifacts}`);
