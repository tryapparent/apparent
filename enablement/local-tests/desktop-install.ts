// Local Desktop installs only. Build/test commands always execute, including hits.
import {execFileSync} from 'node:child_process';
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {release} from 'node:os';
import {digest, reuse} from './receipt.ts';
import {files, npmConfiguration} from './service.ts';
import type {FileDigests} from './service.ts';
import type {Admission} from './service.ts';
import type {Command} from './run.ts';

export const desktopPackage = 'capture/desktop/ui/frontend';
const install = ['npm', 'ci', '--no-audit', '--no-fund'];
const localPackages = ['shared/ui', 'record/storage'];
const installScripts = new Map([
  ['node_modules/esbuild', '0.28.2'], ['node_modules/fsevents', '2.3.3'], ['node_modules/electron', '45.2.1'],
]);
// npm ci's full package lifecycle, including the reifier's dependencies hook.
const lifecycle = ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare', 'dependencies'];
type InstallSnapshot = {key: string; stable: string; head: string;
  inputs: {key: string; stable: string}; installed: boolean};

export function installEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = {...env};
  // These values are removed from the install as well as its fingerprint.
  for (const name of Object.keys(result))
    if (/^(CODEX_|T3CODE_|INVOCATION_ID$|JOURNAL_STREAM$|SYSTEMD_EXEC_PID$)/.test(name)) delete result[name];
  return result;
}

function git(cwd: string, env: NodeJS.ProcessEnv, args: string[]) {
  return execFileSync('git', args, {cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
}

export function desktopInstallSnapshot(cwd: string, env: NodeJS.ProcessEnv, admission: Admission, digests?: FileDigests): InstallSnapshot {
  const frontend = join(cwd, desktopPackage);
  if (git(cwd, env, ['rev-parse', 'HEAD']).trim() !== admission.head) throw Error('candidate changed');
  const npm = npmConfiguration(frontend, env);
  const manifest = JSON.parse(readFileSync(join(frontend, 'package.json'), 'utf8'));
  if (lifecycle.some(name => manifest.scripts?.[name]))
    throw Error('unreviewed package install lifecycle');
  const lock = JSON.parse(readFileSync(join(frontend, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages?.['']) throw Error('unknown lock format');
  const paths = [join(frontend, 'package.json'), join(frontend, 'package-lock.json')];
  for (const [name, entry] of Object.entries(lock.packages) as [string, any][]) {
    if (entry.hasInstallScript && installScripts.get(name) !== entry.version)
      throw Error('unreviewed dependency install lifecycle');
    if (entry.link) throw Error('unreviewed linked install');
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith('file:')) continue;
    const path = realpathSync(resolve(frontend, entry.resolved.slice(5)));
    if (!localPackages.includes(relative(cwd, path))) throw Error('unreviewed local dependency');
    const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    // Record's generated dist is rebuilt/staged by the fresh Desktop checks.
    if (pkg.files && JSON.stringify(pkg.files) !== JSON.stringify(['dist'])) throw Error('unreviewed local package files');
    if (lifecycle.some(key => pkg.scripts?.[key]))
      throw Error('unreviewed local install lifecycle');
    const source = git(cwd, env, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', relative(cwd, path)]);
    paths.push(...source.split('\0').filter(Boolean).map(file => resolve(cwd, file)));
  }
  const source = files(paths, [cwd], new Map(), digests);
  const command = (name: string) => realpathSync(execFileSync('/bin/sh', ['-c', `command -v ${name}`], {env, encoding: 'utf8'}).trim());
  if (command('node') !== realpathSync(process.execPath)) throw Error('different Node');
  const npmRoot = dirname(dirname(command('npm')));
  if (JSON.parse(readFileSync(join(npmRoot, 'package.json'), 'utf8')).name !== 'npm') throw Error('unknown npm launcher');
  const runtime = files([npmRoot, realpathSync(process.execPath)], ['/'], new Map(), digests);
  const inputs = {key: digest(JSON.stringify({source: source.key, runtime: runtime.key, npm: npm.key,
    environment: Object.entries(env).sort(([a], [b]) => a.localeCompare(b)), versions: process.versions,
    platform: process.platform, arch: process.arch, kernel: release(), umask: process.umask(), install})),
    stable: digest(JSON.stringify([source.stable, runtime.stable, npm.stable]))};
  const modules = join(frontend, 'node_modules');
  let output: ReturnType<typeof files> | undefined;
  try {
    if (!existsSync(join(modules, '.package-lock.json'))) throw Error('missing installed lock');
    output = files([modules], [modules, ...localPackages.map(path => join(cwd, path))], new Map(), digests);
  } catch { /* Missing, damaged or unqualified output requires a fresh install. */ }
  if (git(cwd, env, ['rev-parse', 'HEAD']).trim() !== admission.head) throw Error('candidate changed');
  return {key: digest(JSON.stringify(['desktop-install-v1', inputs.key, output?.key])),
    stable: digest(JSON.stringify([inputs.stable, output?.stable])), head: admission.head,
    inputs, installed: !!output};
}

// Recognize the runner's complete Desktop block; never change its public plan.
export function desktopDependencies(block: Command[], cwd: string, inherited: NodeJS.ProcessEnv,
  admission: Admission | undefined, run: (command: Command, environment?: NodeJS.ProcessEnv) => void): boolean {
  const expected = [install, ['npm', 'test'], [...(process.platform === 'linux' ? ['xvfb-run', '-a'] : []), 'npm', 'run', 'test:electron']];
  if (block.length !== 3 || block.some((c, i) => c.cwd !== desktopPackage || c.env || JSON.stringify(c.argv) !== JSON.stringify(expected[i]))) return false;
  const env = installEnvironment(inherited);
  // npm ci removes node_modules. Protect the complete block, even on hits and
  // unqualified/fresh fallbacks. This runtime mutex is per-worktree Git metadata,
  // separate from disposable receipts: cleanup must not admit a second writer.
  const lock = join(git(cwd, inherited, ['rev-parse', '--absolute-git-dir']).trim(), 'apparent-desktop-install.lock');
  try { mkdirSync(lock, {mode: 0o700}); }
  catch { throw Error(`Desktop dependency operation locked or unavailable: ${lock}. Retry after its owner finishes; interrupted locks require owner verification before removal.`); }
  const identity = lstatSync(lock);
  try {
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({pid: process.pid, started: new Date().toISOString()}), {flag: 'wx', mode: 0o600});
    const eligible = admission && ['linux', 'darwin'].includes(process.platform) && !env.CI && !env.GITHUB_ACTIONS
      && !Object.keys(env).some(name => /^(NODE_|LD_|DYLD_|ELECTRON_|ESBUILD_|VSCODE_INSPECTOR_OPTIONS)/.test(name));
    if (!eligible) { block.forEach(command => run(command)); return true; }
    const digests: FileDigests = new Map();
    let initial: InstallSnapshot | undefined;
    try { initial = desktopInstallSnapshot(cwd, env, admission!, digests); }
    catch { block.forEach(command => run(command)); return true; }
    const snapshot = () => {
      const value = initial; initial = undefined;
      return value ?? desktopInstallSnapshot(cwd, env, admission!, digests);
    };
    let checked = false;
    const checks = () => { run(block[1]); run(block[2]); checked = true; };
    reuse(join(cwd, desktopPackage), snapshot, () => {
      run(block[0], env);
      checks();
    }, console.error, {label: 'Desktop dependencies', refreshed: (before, after) => after.installed
      && before.head === after.head && JSON.stringify(before.inputs) === JSON.stringify(after.inputs)});
    if (!checked) checks();
  } finally {
    const current = lstatSync(lock, {throwIfNoEntry: false});
    if (current?.ino === identity.ino && current.dev === identity.dev) rmSync(lock, {recursive: true});
  }
  return true;
}
