/** Agent setup policy; mutation is delegated to the owning installation provider. */
import { spawnSync } from 'node:child_process';
import { accessSync, constants, lstatSync, readFileSync, realpathSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Check = { id: string; status: 'ok' | 'absent' | 'unknown' | 'incompatible'; detail: string; action?: string; evidence?: Record<string, string | null> };
export type Result = { ok: boolean; output: string };
export type Provider = { platform: string; home: string; env: NodeJS.ProcessEnv; run: (exe: string, args: string[]) => Result };
export const system: Provider = {
  platform: process.platform, home: homedir(), env: process.env,
  run(exe, args) {
    const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    // Never expose provider stderr: it may include unrelated configuration or credentials.
    return { ok: !r.error && r.status === 0, output: r.stdout || '' };
  },
};
function file(path: string): Check['status'] {
  try { const s = lstatSync(path); return s.isFile() || s.isSymbolicLink() ? 'ok' : 'incompatible'; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unknown'; }
}
function executable(path: string): string | undefined {
  try { accessSync(path, constants.X_OK); if (!statSync(path).isFile()) return undefined; return realpathSync(path); } catch { return undefined; }
}
function executableState(path: string): Check['status'] {
  try { realpathSync(path); if (!statSync(path).isFile()) return 'incompatible'; accessSync(path, constants.X_OK); return 'ok'; }
  catch (e) { const code = (e as NodeJS.ErrnoException).code; return code === 'ENOENT' ? 'absent' : code === 'EACCES' || code === 'EPERM' ? 'unknown' : 'incompatible'; }
}
function textFile(path: string): string {
  const s = lstatSync(path);
  if (!s.isFile() || s.size > 256 * 1024) throw new Error('Unsupported diagnostic input');
  return readFileSync(path, 'utf8');
}
function json(p: Provider, exe: string, args: string[]): any {
  const r = p.run(exe, args);
  if (!r.ok) return undefined;
  try { return JSON.parse(r.output); } catch { return undefined; }
}

// Native LaunchServices lookup only: no URL opening, app activation, discovery
// scan or registration. The scheme is argv data, including in native tests.
export const macHandlerScript = `ObjC.import('AppKit');
function run(argv) {
  var url = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString(argv[0] + '://open'));
  if (url.isNil()) return JSON.stringify({status: 'absent'});
  var bundle = $.NSBundle.bundleWithURL(url);
  if (bundle.isNil() || bundle.executablePath.isNil()) return JSON.stringify({status: 'unknown'});
  return JSON.stringify({status: 'registered', bundle: ObjC.unwrap(url.path), executable: ObjC.unwrap(bundle.executablePath)});
}`;

export function macHandler(p: Provider, target: string | undefined, scheme = 'apparent'): Check {
  if (!/^[a-z][a-z0-9-]{0,100}$/.test(scheme)) throw new Error('Invalid diagnostic URL scheme');
  const selected = json(p, '/usr/bin/osascript', ['-l', 'JavaScript', '-e', macHandlerScript, scheme]);
  const result: Check = { id: 'url-handler', status: 'unknown', detail: 'LaunchServices handler lookup unavailable.', action: 'Use the official app installer and inspect the selected handler; setup does not rewrite LaunchServices.' };
  if (selected?.status === 'absent') return { ...result, status: 'absent', detail: 'LaunchServices has no application for the Apparent URL scheme.' };
  if (selected?.status !== 'registered' || typeof selected.executable !== 'string' || !isAbsolute(selected.executable) || typeof selected.bundle !== 'string' || !isAbsolute(selected.bundle)) return result;
  const actual = executable(selected.executable);
  const status = executableState(selected.executable);
  return { ...result, status: status === 'unknown' ? 'unknown' : actual && target && actual === target ? 'ok' : 'incompatible', detail: `${selected.bundle}: ${actual && actual === target ? 'selected executable matches CLI' : 'selected executable is missing, unsupported or different'}`, evidence: { bundle: selected.bundle, executable: selected.executable } };
}

function buildLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 200 && /^\d+\.\d+\.\d+(?:\s|[-+]|$)/.test(value) && !/[\x00-\x1f\x7f]/.test(value) ? value : undefined;
}
function identifiedBuild(label: string | undefined): boolean {
  // The native producer's clean revision label identifies a build. Equal
  // fallback or +modified labels cannot establish equal source contents.
  return !!label && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)? · [a-f0-9]{7,40}$/.test(label);
}

export function diagnose(p: Provider, exe: string, profile?: string): Check[] {
  const checks: Check[] = [];
  const target = executable(exe);
  const pathEntry = (p.env.PATH || '').split(delimiter).filter(isAbsolute).map(d => join(d, 'apparent')).find(d => file(d) !== 'absent');
  checks.push({ id: 'path-command', status: !pathEntry ? 'absent' : executable(pathEntry) === target && target ? 'ok' : 'incompatible', detail: pathEntry ? `${pathEntry}: ${executable(pathEntry) ? 'resolved command' : 'broken or non-executable target'}` : 'No apparent command on PATH', action: 'Use the installed app’s CLI-link provider; do not replace unrelated commands.' });
  checks.push({ id: 'executable', status: executableState(exe), detail: target ? `${exe} -> ${target}` : `${exe}: executable target unavailable`, action: target ? undefined : 'Install the official Apparent CLI first; setup cannot bootstrap its own missing executable.' });
  const version = target ? p.run(exe, ['--version']) : undefined;
  const installedBuild = version?.ok ? buildLabel(/^apparent\s+([^\r\n]+)$/i.exec(version.output.trim())?.[1]) : undefined;
  checks.push({ id: 'version', status: installedBuild ? 'ok' : 'unknown', detail: installedBuild ? `apparent ${installedBuild}` : 'CLI version unavailable or malformed' });
  const capabilities = target && p.run(exe, ['capture', 'handoff', '--help']);
  checks.push({ id: 'native-capability', status: capabilities && capabilities.ok && /handoff/i.test(capabilities.output) ? 'ok' : 'unknown', detail: 'Installed CLI handoff command availability; this does not establish the running app’s bridge compatibility.' });
  const capture = target ? json(p, exe, ['capture', 'state']) : undefined;
  const phase = capture?.state?.phase;
  const knownPhase = ['idle', 'completed', 'selecting', 'starting', 'recording', 'processing'].includes(phase);
  checks.push({ id: 'capture', status: knownPhase ? 'ok' : 'unknown', detail: knownPhase ? `Capture phase: ${phase}` : 'Capture control unavailable; do not start, stop or restart an app.', action: knownPhase ? undefined : 'Open the compatible installed app yourself and retry diagnostics; capture safety remains unknown.' });
  const update = target && p.platform === 'linux' ? json(p, exe, ['update', 'status']) : undefined;
  const scalar = (v: unknown) => typeof v === 'string' ? v.slice(0, 200) : null;
  const runningBuild = knownPhase && capture?.app?.schema === 1 ? buildLabel(capture.app.build) : undefined;
  const comparable = identifiedBuild(runningBuild) && identifiedBuild(installedBuild);
  const versionsDiffer = !!(runningBuild && installedBuild && runningBuild.split(/\s/, 1)[0] !== installedBuild.split(/\s/, 1)[0]);
  const mismatch = update?.pendingRestart === true || versionsDiffer || (comparable && runningBuild !== installedBuild);
  const updateMatches = typeof update?.running?.updateId === 'string' && update.running.updateId.trim().length > 0 && typeof update.running.updateChannel === 'string' && update.running.updateChannel.trim().length > 0 && update.running.updateId === update?.installed?.id && update.running.updateChannel === update.installed.channel;
  const matched = (comparable && runningBuild === installedBuild) || updateMatches;
  checks.push({ id: 'running', status: mismatch ? 'incompatible' : matched ? 'ok' : 'unknown', detail: mismatch ? 'Running app differs from installed CLI/update; quit/reopen manually only after checking capture.' : matched ? 'The live app build or updater identity matches the installed CLI/update.' : 'Running/installed identity is unknown; missing, unidentified or modified build facts cannot establish a match.', evidence: { runningVersion: scalar(runningBuild ? capture.app.version : update?.running?.version), runningUpdate: scalar(update?.running?.updateId), installedUpdate: scalar(update?.installed?.id), ...(runningBuild ? { runningBuild } : {}), ...(installedBuild ? { installedBuild } : {}) } });
  if (p.platform === 'linux') {
    const selection = p.run('xdg-mime', ['query', 'default', 'x-scheme-handler/apparent']);
    const id = selection.output.trim();
    const dirs = [p.env.XDG_DATA_HOME || join(p.home, '.local/share'), ...(p.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')];
    const path = /^[\w.-]+\.desktop$/.test(id) ? dirs.map(d => join(d, 'applications', id)).find(d => file(d) !== 'absent') : undefined;
    let status: Check['status'] = !selection.ok ? 'unknown' : !id || !path ? 'absent' : 'unknown';
    let detail = path || 'Selected handler has no readable desktop entry';
    if (path) try {
      const text = textFile(path);
      const entry = text.match(/^Exec=(\/[A-Za-z0-9/._+\-]+) launch %u\r?$/m);
      const actual = entry && executable(entry[1]);
      status = actual && target && actual === target && /^MimeType=.*x-scheme-handler\/apparent;/m.test(text) && !/^Hidden=true\r?$/m.test(text) ? 'ok' : 'incompatible';
      detail = `${path}: ${status === 'ok' ? 'target matches CLI' : 'handler target is missing, unsupported or different'}`;
    } catch { status = 'unknown'; }
    checks.push({ id: 'url-handler', status, detail, action: status === 'ok' ? undefined : 'Use the existing launch-handler install provider; conflicting files require manual inspection.' });
  } else if (p.platform === 'darwin') checks.push(macHandler(p, target));
  else checks.push({ id: 'url-handler', status: 'unknown', detail: 'Unsupported platform.' });
  for (const [id, name] of [['plugin-agent', '__init__.py'], ['plugin-desktop', 'desktop/plugin.js']] as const) {
    const path = profile && join(profile, 'plugins/apparent', name);
    let status: Check['status'] = path ? file(path) : 'unknown';
    if (path && status === 'ok') try { if (!statSync(path).isFile()) status = 'incompatible'; } catch { status = 'unknown'; }
    checks.push({ id, status, detail: path || 'Select the actual Hermes profile with --profile; no profile is inferred or scanned.', action: 'Install the complete published plugin through Hermes; source compilation is not a normal setup repair.' });
  }
  checks.push({ id: 'plugin-loaded', status: 'unknown', detail: 'Installed files and enabled configuration do not establish Agent/Desktop runtime loading or SDK capability compatibility.', action: 'Reload Hermes through its supported flow and verify both halves in the intended session.' });
  checks.push({ id: 'plugin-configured', status: 'unknown', detail: 'Hermes owns activation. Setup does not parse or rewrite its settings or run discovery that may populate caches.', action: 'Check both Agent and Desktop activation through Hermes’s plugin settings.' });
  const manifest = profile && join(profile, 'plugins/apparent/compatibility.json');
  let compatibility: Check['status'] = manifest ? file(manifest) : 'unknown';
  if (manifest && compatibility === 'ok') try {
    const m = JSON.parse(textFile(manifest));
    compatibility = m.schema === 1 && m.plugin === 'apparent' && m.hermes === '>=0.23.0' && Array.isArray(m.platforms) && m.platforms.includes(p.platform) ? 'ok' : 'incompatible';
  } catch { compatibility = 'unknown'; }
  checks.push({ id: 'plugin-contract', status: compatibility, detail: 'Published compatibility declaration; actual Hermes SDK/runtime compatibility still requires loaded-session verification.' });
  return checks;
}
export function installPackage(p: Provider, archive: string, digest: string, profile: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Supply the official release archive SHA-256');
  const info = lstatSync(archive);
  if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Unsupported package archive');
  const bytes = readFileSync(archive);
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Package archive checksum mismatch');
  const temporary = mkdtempSync('/tmp/apparent-dev-hermes-install-');
  try {
    // Snapshot the verified bytes before any provider invocation; no path replacement race.
    const snapshot = join(temporary, 'package.tar.gz');
    writeFileSync(snapshot, bytes, { mode: 0o600 });
    const names = p.run('tar', ['-tzf', snapshot]);
    const types = p.run('tar', ['-tvzf', snapshot]);
    const entries = names.output.trim().split('\n');
    if (!names.ok || !types.ok || !types.output.trim().split('\n').every(line => /^[-d]/.test(line)) ||
      !entries.includes('install.cjs') || !entries.includes('apparent/compatibility.json') ||
      entries.some(name => !/^(install\.cjs|apparent\/[A-Za-z0-9._/-]*)$/.test(name) || name.split('/').some(part => part === '.' || part === '..'))) throw new Error('Unsupported package contents');
    if (!p.run('tar', ['-xzf', snapshot, '-C', temporary]).ok) throw new Error('Package extraction failed');
    return p.run(process.execPath, [join(temporary, 'install.cjs'), '--profile', profile]).ok;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
export function setup(p: Provider, exe: string, profile: string | undefined, check: boolean, archive?: string, digest?: string) {
  const before = diagnose(p, exe, profile);
  const repairs: { id: string; status: string; detail: string }[] = [];
  if (!check && archive && profile) {
    try {
      const ok = installPackage(p, archive, digest || '', profile);
      repairs.push({ id: 'plugin', status: ok ? 'applied' : 'failed', detail: ok ? 'Verified package writer completed; activation and actual loading remain Hermes-owned.' : 'Package writer refused or failed; preserve existing files and inspect conflicts.' });
    } catch { repairs.push({ id: 'plugin', status: 'failed', detail: 'Archive verification, extraction or installer failed; use the official archive and its published SHA-256.' }); }
  }
  // This writer neither starts capture nor stops/restarts processes. Never replace conflicting files.
  if (!check && p.platform === 'linux' && before.find(c => c.id === 'executable')?.status === 'ok' && before.find(c => c.id === 'url-handler')?.status === 'absent') {
    const r = p.run(exe, ['launch-handler', 'install']);
    repairs.push({ id: 'url-handler', status: r.ok ? 'applied' : 'failed', detail: r.ok ? 'Existing registration provider completed; see rechecked status.' : 'Registration provider refused or failed; inspect prerequisites/conflicts. No process was restarted.' });
  }
  const checks = check || !repairs.length ? before : diagnose(p, exe, profile);
  return { schemaVersion: 1, mode: check ? 'check' : 'repair', ready: checks.every(c => c.status === 'ok'), checks, repairs };
}
export function main(args: string[], p = system): number {
  let check = false, structured = false, profile: string | undefined, exe: string | undefined, packageRoot: string | undefined, digest: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') check = true;
    else if (args[i] === '--json') structured = true;
    else if (args[i] === '--sha256' && args[i + 1]) digest = args[++i];
    else if (['--profile', '--executable', '--package'].includes(args[i]) && args[i + 1]) {
      const key = args[i++], value = args[i];
      if (!isAbsolute(value)) throw new Error(`${key} requires an absolute path`);
      if (key === '--profile') profile = value; else if (key === '--package') packageRoot = value; else exe = value;
    } else throw new Error('Usage: apparent setup hermes [--check] [--json] [--profile ABSOLUTE_PATH] [--package OFFICIAL_ARCHIVE --sha256 EXPECTED_DIGEST] [--executable ABSOLUTE_PATH]');
  }
  exe ||= (p.env.PATH || '').split(delimiter).map(d => join(d, 'apparent')).find(d => executable(d)) || join(p.home, '.local/bin/apparent');
  if (packageRoot && (!profile || !digest)) throw new Error('--package requires --profile and --sha256 from the official release');
  const report = setup(p, exe, profile, check, packageRoot, digest);
  console.log(structured ? JSON.stringify(report) : report.checks.map(c => `${c.id}: ${c.status} — ${c.detail}${c.status !== 'ok' && c.action ? `\n  ${c.action}` : ''}`).concat(report.repairs.map(r => `repair ${r.id}: ${r.status} — ${r.detail}`)).join('\n'));
  return report.ready ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
