// Qualify the shared input path in a fresh synthetic guest, using gui-vm.py for
// all allocation, expiry, retention and VM cleanup. No product is executed.
import {spawn, execFileSync, type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync, readFileSync, writeFileSync, openSync, closeSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Qmp, sendPlan, qualify} from './qmp.ts';
import {target} from './target.ts';

const values = new Map<string, string>();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (!['--template', '--ovmf-vars', '--ssh-key', '--ssh-user', '--results'].includes(args[i]) || !args[i + 1] || values.has(args[i]))
    throw Error('Expected --template <qcow2> --ovmf-vars <vars> --ssh-key <key> --ssh-user <user> --results <new private directory>');
  values.set(args[i], args[i + 1]);
}
for (const name of ['--template', '--ovmf-vars', '--ssh-key', '--ssh-user', '--results'])
  if (!values.has(name)) throw Error(`missing ${name}`);
const root = resolve(values.get('--results')!);
mkdirSync(root, {mode: 0o700}); // refuse reuse, including a prior failed take
const vm = root + '/vm';
const deadline = performance.now() + 240000;
let runner: ChildProcess | undefined;
let forward: ChildProcess | undefined;
let ws: WebSocket | undefined;
let prefix: string[] | undefined;
let output: string | undefined;
let failure: unknown;
const abort = new AbortController();
let cleaning = false;
process.on('SIGINT', () => abort.abort());
process.on('SIGTERM', () => abort.abort());
const receipt: any = {driver: 'unrun', product: 'unrun', cleanup: 'pending'};
const remaining = () => Math.max(1, Math.min(10000, deadline - performance.now() - (cleaning ? 0 : 25000)));
const ssh = (command: string) => execFileSync('ssh', [...prefix!, `${values.get('--ssh-user')}@127.0.0.1`, command],
  {encoding: 'utf8', timeout: remaining()});
const stopped = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;
async function waitFor(test: () => boolean | Promise<boolean>, milliseconds: number) {
  const end = Math.min(deadline - (cleaning ? 0 : 25000), performance.now() + milliseconds);
  while (performance.now() < end) { if (!cleaning) abort.signal.throwIfAborted(); if (await test()) return; await delay(200); }
  throw Error('native input readiness timeout');
}
try {
  const scenario = root + '/scenario.sh';
  writeFileSync(scenario, `#!/bin/bash
set -euo pipefail
umask 077
cat > "$SCRAWL_GUI_OUTPUT/target.html" <<'APPARENT_HTML'
${target}
APPARENT_HTML
printf '%s\\n' "$DISPLAY" "$WAYLAND_DISPLAY" "$XDG_RUNTIME_DIR" "$TMPDIR" > "$SCRAWL_GUI_OUTPUT/environment.txt"
hyprctl getoption input:kb_options > "$SCRAWL_GUI_OUTPUT/keyboard-options.txt" 2>&1 || true
cat /etc/keyd/default.conf >> "$SCRAWL_GUI_OUTPUT/keyboard-options.txt" 2>/dev/null || true
chromium --no-first-run --disable-default-apps --disable-background-networking --password-store=basic --user-data-dir="$TMPDIR/browser" --remote-debugging-port=9222 --start-fullscreen "file://$SCRAWL_GUI_OUTPUT/target.html" > "$SCRAWL_GUI_OUTPUT/browser.log" 2>&1 &
browser=$!
trap 'kill "$browser" 2>/dev/null || true; wait "$browser" 2>/dev/null || true' EXIT
printf '%s\\n' "$SCRAWL_GUI_OUTPUT" > "$TMPDIR/output-path"
for ((n=0;n<100;n++)); do
  kill -0 "$browser" || exit 71
  if test -f "$SCRAWL_GUI_OUTPUT/done"; then exit "$(cat "$SCRAWL_GUI_OUTPUT/done")"; fi
  sleep 1
done
exit 70
`, {mode: 0o600, flag: 'wx'});
  const runnerPath = resolve(dirname(fileURLToPath(import.meta.url)), '../gui-vm.py');
  const fd = openSync(root + '/runner.log', 'wx', 0o600);
  try {
    runner = spawn('python3', [runnerPath, ...[...values].filter(([name]) => name !== '--results').flat(),
      '--binary', '/usr/bin/true', '--scenario', scenario, '--results', vm, '--input-profile', 'mouse',
      '--require-command', 'chromium', '--isolated-network',
      '--boot-timeout', '120', '--scenario-timeout', '120', '--job-timeout', '220'], {stdio: ['ignore', fd, fd]});
  } finally { closeSync(fd); }
  runner.on('error', error => { failure = error; });
  let status: any;
  await waitFor(() => {
    if (failure) throw failure;
    if (stopped(runner!)) throw Error('guest runner exited before readiness; inspect runner.log and vm/result.json');
    try { status = JSON.parse(readFileSync(vm + '/result.json', 'utf8')); } catch { return false; }
    return status.stage === 'scenario';
  }, 150000);
  prefix = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=3', '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${vm}/known_hosts`, '-i', resolve(values.get('--ssh-key')!), '-p', String(status.transport.ssh_port)];
  output = status.guest_readiness.tmpdir + '/output-path';
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as {port: number}).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  forward = spawn('ssh', [...prefix, '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${port}:127.0.0.1:9222`,
    '-N', `${values.get('--ssh-user')}@127.0.0.1`], {stdio: 'ignore'});
  let forwardError: Error | undefined;
  forward.on('error', error => { forwardError = error; });
  let tab: any;
  await waitFor(async () => {
    if (forwardError) throw forwardError;
    if (stopped(forward!)) throw Error('owned SSH forwarding failed');
    try {
      const tabs: any = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(2000)})).json();
      tab = tabs.find((t: any) => t.title === 'Apparent input qualification');
      return !!tab;
    } catch { return false; }
  }, 20000);
  const endpoint = new URL(tab.webSocketDebuggerUrl); endpoint.hostname = '127.0.0.1'; endpoint.port = String(port);
  ws = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('owned CDP connection timeout')), 5000);
    ws!.onopen = () => { clearTimeout(timer); resolve(); };
    ws!.onerror = () => { clearTimeout(timer); reject(Error('owned CDP connection failed')); };
  });
  let sequence = 0;
  const pending = new Map<number, (value: any) => void>();
  ws.onmessage = event => {
    const response = JSON.parse(String(event.data)); pending.get(response.id)?.(response); pending.delete(response.id);
  };
  const call = (method: string, params: any = {}) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP observation timeout')); }, remaining());
    pending.set(id, response => { clearTimeout(timer); response.error ? reject(Error(JSON.stringify(response.error))) : resolve(response.result); });
    ws!.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async (expression: string) => (await call('Runtime.evaluate', {expression, returnByValue: true})).result.value;
  const geometry = await evaluate('({width:innerWidth,height:innerHeight,focus:document.hasFocus(),title:document.title})');
  if (!geometry.focus || geometry.width < 600 || geometry.height < 400) throw Error('owned target lacks focus or usable geometry');
  await call('Page.enable');
  const screenshot = async (name: string) => writeFileSync(root + '/' + name,
    Buffer.from((await call('Page.captureScreenshot', {format: 'png'})).data, 'base64'), {mode: 0o600});
  await screenshot('before.png');
  await sendPlan(new Qmp(vm + '/qmp.sock'), {profile: 'mouse', actions: [
    {kind: 'relative', x: -100, y: -100}, {kind: 'wait', ms: 100}, {kind: 'button', down: true},
    {kind: 'relative', x: 30, y: 30}, {kind: 'relative', x: 30, y: -30}, {kind: 'relative', x: 30, y: 30},
    {kind: 'button', down: false}, {kind: 'key', code: 'shift', down: true},
    {kind: 'button', down: true}, {kind: 'button', down: false}, {kind: 'key', code: 'shift', down: false},
    {kind: 'relative', x: 10, y: 0}]}, 10000, abort.signal);
  await delay(200);
  const events = await evaluate('window.events');
  writeFileSync(root + '/observed-events.json', JSON.stringify(events, null, 2), {mode: 0o600});
  Object.assign(receipt, qualify(events), {geometry});
  if (!await evaluate('document.hasFocus()')) throw Error('owned target lost focus during qualification');
  await screenshot('after.png');
} catch (error) { failure = error; receipt.driver = 'failed'; receipt.failure = String(error); }
finally {
  cleaning = true;
  ws?.close();
  if (forward && !stopped(forward)) { forward.kill('SIGTERM'); await waitFor(() => stopped(forward!), 3000).catch(() => forward!.kill('SIGKILL')); }
  if (prefix && output) {
    try { ssh(`printf '${failure ? 1 : 0}' > "$(cat '${output}')/done"`); } catch (error) { receipt.finish_error = String(error); }
  }
  if (runner && !stopped(runner)) {
    await waitFor(() => stopped(runner!), 10000).catch(async () => {
      runner!.kill('SIGTERM'); await waitFor(() => stopped(runner!), 20000).catch(() => {});
    });
  }
  try {
    const status = JSON.parse(readFileSync(vm + '/result.json', 'utf8'));
    receipt.cleanup = status.cleanup;
    receipt.runner_exit = status.exit_code;
    if (status.exit_code !== 0 || status.cleanup.status !== 'complete') receipt.driver = 'failed';
  } catch (error) { receipt.cleanup = String(error); receipt.driver = 'failed'; }
  writeFileSync(root + '/input-qualification.json', JSON.stringify(receipt, null, 2), {mode: 0o600});
}
console.log(JSON.stringify(receipt));
if (receipt.driver !== 'passed') process.exitCode = 1;
