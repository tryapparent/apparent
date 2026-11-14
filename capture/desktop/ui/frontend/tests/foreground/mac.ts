/** Actual installed macOS foreground capture/share; disposable hosted CI only. */
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {chmod, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn, execFileSync, type ChildProcess} from 'node:child_process';
import {constants} from 'node:fs';
import {prepareForegroundScene, type LaunchObservation, type LaunchWindow} from './startup.ts';
import {savedForeground} from './saved.ts';
import {auditedControl, type ControlOperation, type ControlReceipt} from './control.ts';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hostEnv = {...process.env};
const until = Date.now() + 240_000;
let finishing = false, root = '', output = '', app = '', binary = '', repo = '', rustPid = 0, sequence = 0;
let appEnv: NodeJS.ProcessEnv = {}, captureId: string | undefined;
let service: ChildProcess | undefined, scene: ChildProcess | undefined, supervisor: ChildProcess | undefined;
let origin = '', primary: unknown;
const cleanupErrors: string[] = [];
const ended = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;
function budget(cap = 8000) { const left = finishing ? cap : Math.min(cap, until - Date.now()); assert.ok(left > 0, 'Foreground acceptance deadline exceeded'); return left; }
const redact = (value: unknown) => String(value).replace(/https?:\/\/[^\s"']+/g, '[redacted-url]').replace(/\b[a-f0-9]{64}\b/g, '[redacted-capability]');
async function command(executable: string, args: string[], options: {env?: NodeJS.ProcessEnv; timeout?: number; input?: string} = {}) {
  const child = spawn(executable, args, {env: options.env ?? appEnv, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '', stderr = '', failure: Error | undefined;
  let expire: () => void = () => {};
  const timer = setTimeout(() => { failure = Error(`${path.basename(executable)} exceeded command deadline`); child.kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); expire(); }, budget(options.timeout ?? 8000));
  child.stdout.on('data', b => { stdout += b; if (stdout.length + stderr.length > 1_000_000) { failure = Error('Command output exceeded bound'); child.kill('SIGKILL'); } });
  child.stderr.on('data', b => { stderr += b; if (stdout.length + stderr.length > 1_000_000) { failure = Error('Command output exceeded bound'); child.kill('SIGKILL'); } });
  child.stdin.end(options.input ?? '');
  await new Promise<void>((resolve, reject) => { expire = () => reject(failure); child.once('error', reject); child.once('close', () => resolve()); }).finally(() => clearTimeout(timer));
  if (failure) throw failure;
  assert.equal(child.exitCode, 0, `${path.basename(executable)} failed: ${redact(stderr.slice(-1200))}`);
  return stdout;
}
async function cli(args: string[], timeout = 8000) { return command(binary, args, {timeout}); }
async function startOwnedCapture(id: string) {
  const deadline = Date.now() + 20_000;
  try { return await captureControl('start', id, ['capture', 'start', '--request-id', id, '--wait', '--timeout', '20'], 26_000); }
  catch (error) {
    // A missing admission reply is not evidence that Start had no effect.
    // Reconcile only this documented uncertain response, never resend Start.
    const match = /GUI capture control: (\{[^\r\n]+\})/.exec(String(error));
    let receipt;
    try { receipt = match ? JSON.parse(match[1]!) : undefined; } catch { throw error; }
    if (receipt?.error !== 'app_unresponsive' || receipt.capture_id !== id) throw error;
    await evidence('start-admission-uncertain', {captureId: id, error: receipt.error});
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      assert.ok(remaining > 0, 'Original capture start deadline exceeded');
      const state = await captureControl('inspect', id, ['capture', 'inspect', id], Math.min(8000, remaining));
      assert.equal(state.capture_id, id, 'Admission reconciliation returned another capture');
      assert.ok(Date.now() < deadline, 'Original capture start deadline exceeded');
      if (state.status === 'recording') return state;
      assert.equal(state.status, 'starting', 'Uncertain capture ended before a real frame');
      await sleep(Math.min(100, deadline - Date.now()));
    }
    throw Error('Original capture start deadline exceeded');
  }
}
async function evidence(name: string, value: unknown) { await writeFile(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'}); }
let controlSequence = 0;
let lastControlEvent: Pick<ControlReceipt, 'operation' | 'captureId' | 'phase' | 'startedAt' | 'finishedAt'> | undefined;
async function controlEvidence(entry: ControlReceipt) {
  const {operation, captureId, phase, startedAt, finishedAt} = entry;
  lastControlEvent = {operation, captureId, phase, startedAt, finishedAt};
  await evidence(`capture-control-${String(++controlSequence).padStart(3, '0')}-${entry.operation}-${entry.phase}`, entry);
}
async function captureControl(operation: ControlOperation, id: string, args: string[], timeout: number) {
  return auditedControl({operation, captureId: id, invoke: async () => JSON.parse(await cli(args, timeout)), record: controlEvidence,
    describeError: error => redact(error), reportEvidenceFailure: async error => { cleanupErrors.push(`control evidence write failed: ${redact(error)}`); }});
}
async function poll<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, cap = 12_000) {
  const end = Date.now() + budget(cap); let last = '';
  while (Date.now() < end) { try { const value = await read(); if (accept(value)) return value; } catch (e) { last = redact(e); } await sleep(100); }
  throw Error(`${label} not observed: ${last.slice(-1000)}`);
}
async function native(operation: 'snapshot' | 'prepare' | 'click' | 'startup' | 'close-settings', label?: string, settings?: LaunchWindow, preparedPid?: number) {
  const stem = `${++sequence}-${operation}`;
  const request = path.join(output, stem + '.request.json');
  await writeFile(request, JSON.stringify({operation, app, rootPid: rustPid, output: path.join(output, stem + '.png'), ...(label ? {label} : {}),
    ...(preparedPid ? {preparedPid} : {}),
    ...(settings ? {settingsPid: settings.pid, settingsWindowId: settings.windowId} : {})}), {mode: 0o600, flag: 'wx'});
  const startedAt = Date.now(), started = performance.now();
  try {
    const result = JSON.parse(await command(hostEnv.APPARENT_FOREGROUND_NATIVE_INPUT!, [request], {env: hostEnv}));
    await evidence(stem, result); return result as LaunchObservation & {pid: number; windowId: number; words: Array<{text: string}>; prepared?: boolean};
  } finally { await evidence(stem + '-timing', {startedAt, elapsedMs: performance.now() - started}); }
}
const text = (snapshot: {words: Array<{text: string}>}) => snapshot.words.map(word => word.text).join(' ').toLowerCase();
async function ui(label: string, predicate: (value: string) => boolean, scenePid: number, cap = 12_000) {
  return poll(() => native('snapshot'), frame => { assert.equal(frame.frontPid, scenePid, 'Synthetic scene lost foreground'); return predicate(text(frame)); }, label, cap);
}
async function status() {
  const response = await fetch(origin + '/__fixture/status', {signal: AbortSignal.timeout(budget(3000))});
  assert.equal(response.status, 200); return response.json() as Promise<any>;
}
const footprint = (s: any) => ({reserve: s.calls['POST /v1/captures/:id'] ?? 0,
  put: s.calls['PUT /v1/captures/:id/files/:path'] ?? 0, complete: s.calls['POST /v1/captures/:id/complete'] ?? 0,
  manifest: s.calls['GET /v1/captures/:id'] ?? 0, share: s.shareCalls, bytes: s.uploadedBytes,
  putAttempts: s.putAttempts, cancelledPuts: s.cancelledPuts});
async function jobs() { try { return (await readdir(path.join(appEnv.HOME!, '.config/apparent/hosted'))).filter(name => name.endsWith('.job')); } catch (e: any) { if (e.code === 'ENOENT') return []; throw e; } }
// Read only the owned synthetic capture's diagnostic, after its writers stop.
// Failed finalization has no saved bundle to copy through the success path.
async function retainCaptureDiagnostics(captures: string, destination: string) {
  const entries = await readdir(captures, {withFileTypes: true});
  assert.ok(entries.length <= 4, 'Unexpected synthetic capture inventory');
  const retained: Array<{name: string; originalBytes: number; retainedBytes: number; truncated: boolean}> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = path.join(captures, entry.name);
    assert.equal(path.dirname(await realpath(directory)), captures);
    const source = path.join(directory, 'notes-ui.log');
    let info;
    try { info = await lstat(source); } catch (e: any) { if (e.code === 'ENOENT') continue; throw e; }
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid!(), 'Refuse foreign capture diagnostic');
    const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      assert.ok(opened.isFile() && opened.uid === process.getuid!() && opened.dev === info.dev && opened.ino === info.ino, 'Capture diagnostic identity changed');
      const limit = 1024 * 1024, buffer = Buffer.alloc(Math.min(info.size, limit));
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, Math.max(0, info.size - limit));
      const name = `capture-${retained.length}-notes-ui.log`;
      await writeFile(path.join(destination, name), buffer.subarray(0, bytesRead), {mode: 0o600, flag: 'wx'});
      retained.push({name, originalBytes: info.size, retainedBytes: bytesRead, truncated: info.size > limit});
    } finally { await handle.close(); }
  }
  return retained;
}
function groupAlive(pid: number) { try { process.kill(-pid, 0); return true; } catch (e: any) { if (e.code === 'ESRCH') return false; throw e; } }
async function stop(child: ChildProcess | undefined, name: string, group = false) {
  if (!child?.pid) return;
  if (group && !ended(child)) {
    const observed = Number((await command('/bin/ps', ['-p', String(child.pid), '-o', 'pgid='], {env: hostEnv})).trim());
    assert.equal(observed, child.pid, 'Refuse to signal an unowned process group');
    process.kill(-child.pid, 'SIGTERM');
  } else if (!ended(child)) child.kill('SIGTERM');
  const gone = () => ended(child) && (!group || !groupAlive(child.pid!));
  let end = Date.now() + 2000; while (!gone() && Date.now() < end) await sleep(50);
  if (!gone()) { if (group) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
  end = Date.now() + 2000; while (!gone() && Date.now() < end) await sleep(50);
  assert.ok(gone(), `${name} failed owned cleanup`);
}
async function readyChild(child: ChildProcess, name: string) {
  let lines = '', error = '';
  child.stderr?.on('data', bytes => { error = (error + bytes).slice(-2000); });
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`${name} readiness timeout: ${redact(error)}`)), budget(8000));
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', () => { clearTimeout(timer); reject(Error(`${name} exited before readiness: ${redact(error)}`)); });
    child.stdout?.on('data', bytes => {
      lines += bytes; if (lines.length > 100_000) { clearTimeout(timer); reject(Error(`${name} excessive readiness output`)); return; }
      for (const line of lines.split('\n')) { try { const value = JSON.parse(line); if (value.ready === true) { clearTimeout(timer); resolve(value); return; } } catch {} }
    });
  });
}
const supervisorScript = String.raw`
set +e
set +m
trap ':' TERM
pid_file=$1
shift
if [ "$pid_file" != "$TMPDIR/rust.pid" ] || [ ! -f "$pid_file" ] || [ -L "$pid_file" ] || [ ! -O "$pid_file" ]; then exit 64; fi
"$@" &
printf '%s\n' "$!" > "$pid_file"
while :; do
  IFS= read -r line
  status=$?
  if [ "$status" -eq 1 ]; then
    kill -TERM -- -$$ 2>/dev/null || true
    sleep 0.2
    kill -KILL -- -$$
  fi
done
`;
async function main() {
  try {
    // Refuse before any file, process, clipboard, permission or pixel effects.
    assert.equal(process.platform, 'darwin', 'Actual foreground acceptance requires macOS');
    for (const [key, value] of Object.entries({CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'macOS'})) assert.equal(hostEnv[key], value);
    repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), hostEnv.GITHUB_SHA);
    assert.equal(execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim(), '');
    const runner = await realpath(hostEnv.RUNNER_TEMP!);
    output = await realpath(hostEnv.APPARENT_FOREGROUND_NATIVE_OUTPUT!);
    assert.equal(path.dirname(output), runner);
    const owner = await lstat(output); assert.ok(owner.isDirectory() && owner.uid === process.getuid!() && (owner.mode & 0o077) === 0);
    for (const key of ['APPARENT_FOREGROUND_NATIVE_INPUT', 'APPARENT_FOREGROUND_SCENE']) {
      const helper = await realpath(hostEnv[key]!); assert.equal(path.dirname(helper), output);
      assert.ok((await stat(helper)).mode & 0o111);
    }
    assert.match(hostEnv.GITHUB_RUN_ID!, /^\d+$/); assert.match(hostEnv.GITHUB_RUN_ATTEMPT!, /^\d+$/);
    app = path.join(hostEnv.HOME!, 'Applications', `Apparent-Storage-${hostEnv.GITHUB_RUN_ID}-${hostEnv.GITHUB_RUN_ATTEMPT}.app`);
    binary = path.join(app, 'Contents/MacOS/apparent'); assert.ok((await stat(binary)).isFile());
    root = await realpath(await mkdtemp('/tmp/apparent-dev-fg-')); await chmod(root, 0o700);
    const home = path.join(root, 'h'), temporary = path.join(root, 't'), configFile = path.join(home, '.config/apparent/config.json');
    for (const directory of [path.dirname(configFile), temporary, path.join(root, 'captures')]) await mkdir(directory, {recursive: true, mode: 0o700});
    assert.ok(Buffer.byteLength(path.join(home, '.config/apparent/agent-control/capture.sock')) <= 103);
    appEnv = {...hostEnv, HOME: home, CFFIXED_USER_HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'),
      APPARENT_CONFIG: configFile, APPARENT_CAPTURES_DIR: path.join(root, 'captures'), APPARENT_START_TIMINGS: '1', TMPDIR: temporary, TMP: temporary, TEMP: temporary};
    delete appEnv.ELECTRON_RUN_AS_NODE;
    for (const key of Object.keys(appEnv)) if (/^(OPENCODE|CODEX|CLAUDE)_.*SESSION/.test(key)) delete appEnv[key];
    // Login registration is outside this fixture. Omission leaves OS state alone
    // and avoids unrelated synchronous ServiceManagement reconciliation on the GUI thread.
    await writeFile(configFile, JSON.stringify({onboarding: {seen: true}, autoPasteDraft: false, microphoneEnabled: false,
      experiments: {hostedSharing: true, connectForegroundUpload: true, hostedEncryption: false}}), {mode: 0o600, flag: 'wx'});
    const grant = (await cli(['screen-permission-status'])).trim();
    await evidence('permission', {passiveInstalledBinaryGrant: grant});
    assert.equal(grant, 'true', 'Installed candidate lacks Screen Recording grant; no TCC changes permitted');
    service = spawn(process.execPath, ['--experimental-strip-types', path.join(repo, 'connect/client/typescript/test/foreground-fixture.ts'), 'serve', '--port', '0', '--delay-first-put-ms', '30000', '--root', root], {env: appEnv, stdio: ['ignore', 'pipe', 'pipe']});
    origin = (await readyChild(service, 'synthetic loopback service')).origin;
    const serviceURL = new URL(origin); assert.equal(serviceURL.hostname, '127.0.0.1'); assert.equal(serviceURL.protocol, 'http:');
    await cli(['connect', 'login', '--server', origin, '--scope', 'upload', '--consent-upload', '--no-browser'], 20_000);
    const savedConfig = JSON.parse(await readFile(configFile, 'utf8'));
    assert.ok(savedConfig.cloud.enabled && savedConfig.cloud.uploadConsent && savedConfig.experiments.connectForegroundUpload);
    assert.equal(savedConfig.microphoneEnabled, false); assert.equal(savedConfig.experiments.hostedEncryption, false);
    const pidFile = path.join(temporary, 'rust.pid'); await writeFile(pidFile, '', {mode: 0o600, flag: 'wx'});
    const appLog = await open(path.join(output, 'app.log'), 'wx', 0o600);
    supervisor = spawn('/bin/bash', ['-c', supervisorScript, 'foreground-supervisor', pidFile, binary, 'app'], {env: appEnv, detached: true, stdio: ['pipe', appLog.fd, appLog.fd]});
    await appLog.close();
    rustPid = await poll(async () => Number((await readFile(pidFile, 'utf8')).trim()), value => Number.isSafeInteger(value) && value > 1, 'actual app PID');
    const state = await poll(async () => JSON.parse(await cli(['capture', 'state'])), value => value.state?.phase === 'idle', 'actual app idle');
    assert.ok(typeof state.app?.build === 'string' && state.app.build.includes(hostEnv.GITHUB_SHA!.slice(0, 7)), 'Running app source identity differs');
    await evidence('app-identity', {source: hostEnv.GITHUB_SHA, supervisorPid: supervisor.pid, rustPid, app: state.app});
    const generated = await prepareForegroundScene({
      readySettings: () => poll(() => native('startup'), value => value.settings.length === 1, 'owned launch Settings'),
      closeSettings: async window => { await native('close-settings', undefined, window); },
      startScene: async () => {
        scene = spawn(hostEnv.APPARENT_FOREGROUND_SCENE!, [], {env: appEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
        const generated = await readyChild(scene, 'synthetic scene'); assert.equal(generated.pid, scene.pid);
        return generated as {pid: number};
      },
      observe: () => native('startup'),
    });
    captureId = randomBytes(16).toString('hex');
    await evidence('owned-request', {captureId});
    const start = await startOwnedCapture(captureId);
    assert.equal(start.capture_id, captureId); assert.equal(start.status, 'recording', 'A real captured frame is required');
    await sleep(2000);
    await savedForeground({
      prepareRecording: async () => {
        // Read-only: never Finish through this input adapter. Enable the real
        // Electron AX tree while Recording has no saved-dismissal deadline.
        const prepared = await native('prepare', 'Finish');
        assert.equal(prepared.prepared, true, 'Native accessibility bootstrap did not acknowledge an actual button');
        assert.ok(Number.isSafeInteger(prepared.pid) && prepared.pid > 1, 'Prepared accessibility lacks an exact pill PID');
        assert.equal(prepared.frontPid, generated.pid, 'Accessibility bootstrap changed the foreground');
        return prepared;
      },
      stop: async () => {
        const saved = await captureControl('stop', captureId!, ['capture', 'stop', captureId!, '--wait', '--timeout', '45'], 51_000);
        assert.equal(saved.capture_id, captureId); assert.equal(saved.status, 'saved');
        return saved;
      },
      interact: async (_saved, prepared) => {
        await ui('saved foreground pill', value => value.includes('copy link'), generated.pid);
        const before = await status(); assert.equal(before.captures.length, 0); assert.equal(before.uploadedBytes, 0); assert.deepEqual(await jobs(), []);
        await native('click', 'Copy link', undefined, prepared.pid);
        await ui('upload progress', value => value.includes('uploading') && value.includes('cancel upload'), generated.pid);
        const during = await poll(status, value => value.putCount > 0, 'actual PUT body receipt', 5000);
        await native('click', 'Cancel upload');
        await ui('cancelled local recording', value => value.includes('cancelled') && value.includes('retry upload'), generated.pid);
        const cancelled = await poll(status, value => value.cancelledPuts === 1, 'cancelled PUT connection', 5000);
        assert.equal(cancelled.uploadedBytes, 0, 'Cancelled transfer committed bytes');
        await native('click', 'Retry upload');
        await ui('link copied', value => value.includes('link copied') && value.includes('copy link'), generated.pid, 30_000);
        const completed = await status();
        assert.equal(completed.syntheticOnly, true); assert.equal(completed.shareCalls, 1);
        assert.ok(completed.putAttempts > cancelled.putAttempts, 'Retry did not start a fresh transfer');
        assert.ok(completed.captures.some((capture: any) => capture.ready && capture.format === 'plaintext-v1' && capture.received && capture.files >= 3));
        const copied = await command('/usr/bin/pbpaste', [], {env: hostEnv});
        assert.ok(copied.includes('Anyone with this link'), 'Existing public-access disclosure must be preserved');
        const matches = copied.match(new RegExp(String.raw`http://127\.0\.0\.1:\d+/s/[a-f0-9]{64}`, 'g')) ?? [];
        assert.equal(matches.length, 1, 'Expected one synthetic destination');
        const destination = new URL(matches[0]!); assert.equal(destination.origin, origin);
        const expected = 'I recorded some feedback in Apparent. Open this link for the recording, transcript and original image evidence: ' + matches[0] + '. Anyone with this link can view this capture; shared captures are not end-to-end encrypted.';
        assert.ok(copied === expected, 'Complete public handoff/disclosure differs');
        const sentinel = 'synthetic-recopy-' + randomBytes(8).toString('hex');
        await command('/usr/bin/pbcopy', [], {env: hostEnv, input: sentinel});
        assert.ok((await command('/usr/bin/pbpaste', [], {env: hostEnv})) === sentinel, 'Clipboard sentinel did not settle');
        await ui('fresh recopy target', value => value.includes('link copied') && value.includes('copy link'), generated.pid);
        await native('click', 'Copy link');
        await poll(() => command('/usr/bin/pbpaste', [], {env: hostEnv}), value => value === copied, 'native clipboard restoration', 3000);
        const recopied = await status(); assert.deepEqual(footprint(recopied), footprint(completed)); assert.deepEqual(await jobs(), []);
        await evidence('foreground-result', {passed: true, scope: 'Native installed Mac pill; explicit synthetic plaintext share; encrypted CLI proof separate',
          automaticBefore: footprint(before), duringPut: footprint(during), cancelled: footprint(cancelled), completed: footprint(completed), recopied: footprint(recopied), clipboardSha256: digest(copied)});
      },
      retain: async saved => {
        const startedAt = Date.now(), started = performance.now();
        try {
          const bundle = await realpath(saved.bundle_path); assert.equal(path.dirname(bundle), appEnv.APPARENT_CAPTURES_DIR);
          for (const name of ['apparent.json', 'summary.md', 'contact-sheet.png']) assert.ok((await stat(path.join(bundle, name))).size > 0);
          const metadata = JSON.parse(await readFile(path.join(bundle, 'apparent.json'), 'utf8'));
          assert.equal(metadata.context?.microphoneCapture, 'off');
          assert.ok(typeof metadata.video === 'string' && metadata.video.length > 0, 'Saved recording must include a movie');
          const movie = await realpath(path.join(bundle, metadata.video));
          assert.ok(movie.startsWith(bundle + path.sep) && (await stat(movie)).size > 0);
          if (metadata.audio) assert.ok((await stat(path.join(bundle, metadata.audio))).size <= 44, 'Microphone-off capture contains audio bytes');
          assert.equal(JSON.parse(await readFile(configFile, 'utf8')).microphoneEnabled, false);
        } finally {
          // Retain private bundle evidence even if a media assertion failed.
          const bundle = await realpath(saved.bundle_path);
          assert.equal(path.dirname(bundle), appEnv.APPARENT_CAPTURES_DIR);
          try { await cp(bundle, path.join(output, 'synthetic.apparent'), {recursive: true, errorOnExist: true, force: false}); }
          finally { await evidence('bundle-proof-timing', {startedAt, elapsedMs: performance.now() - started}); }
        }
      },
      reportRetentionFailure: error => { cleanupErrors.push('saved bundle proof: ' + redact(error)); },
    });
  } catch (error) { primary = error; }
  finally {
    finishing = true;
    if (captureId && supervisor && !ended(supervisor)) {
      try {
        const {state} = JSON.parse(await cli(['capture', 'state']));
        if (state.capture_id === captureId && ['starting', 'recording'].includes(state.phase)) await cli(['capture', 'cancel', captureId]);
      }
      catch (error) { cleanupErrors.push('owned request: ' + redact(error)); }
    }
    for (const [child, label, group] of [[supervisor, 'installed app', true], [scene, 'synthetic scene', true], [service, 'synthetic service', false]] as const) {
      try { await stop(child, label, group); } catch (error) { cleanupErrors.push(redact(error)); }
    }
    if (root) {
      try {
        if (primary) await evidence('capture-diagnostics', await retainCaptureDiagnostics(appEnv.APPARENT_CAPTURES_DIR!, output));
        const report = path.join(root, 'fixture-report.json'); if (service) await cp(report, path.join(output, 'fixture-report.json'));
        if (!primary && !cleanupErrors.length) await rm(root, {recursive: true});
      } catch (error) { cleanupErrors.push(redact(error)); }
    }
    const report = {passed: !primary && cleanupErrors.length === 0, error: primary ? redact(primary) : undefined, cleanupErrors, lastControlEvent,
      source: hostEnv.GITHUB_SHA, nativeAcceptance: 'Only passed=true plus inspected artifacts establishes this scoped case'};
    if (output) await evidence('report', report);
    if (primary || cleanupErrors.length) { console.error(JSON.stringify(report)); process.exitCode = 1; } else console.log(JSON.stringify(report));
  }
}
void main().catch(error => { console.error(redact(error)); process.exitCode = 1; });
