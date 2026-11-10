export interface Destination { session: string; connectionId: string; profile: string; targetProfile: string; mode: string; local: boolean }
// Preflight only: native Start still owns atomic capture admission.
// Completed presents saved-recording Paste controls and can start another take.
export function captureCanStart(phase: unknown): boolean {
  return phase === 'idle' || phase === 'completed';
}
export const validToken = (s: unknown): boolean => typeof s === 'string' && /^[a-f0-9]{32}$/.test(s);
/** Quote one argument for the POSIX shell used by Hermes shell.exec. */
export function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

/** Resolve the CLI without assuming an account-specific install path. */
function cliPrefix() {
  return `case "$(uname -s)" in Darwin|Linux) ;; *) exit 64;; esac\n` +
    `apparent_bin="$(command -v apparent 2>/dev/null || true)"\n` +
    `if [ -z "$apparent_bin" ] && [ "$(uname -s)" = Darwin ] && command -v mdfind >/dev/null 2>&1; then ` +
    `app_path="$(mdfind 'kMDItemFSName == \"Apparent.app\"' | head -n 1)"; ` +
    `[ -n "$app_path" ] && apparent_bin="$app_path/Contents/MacOS/apparent"; fi\n` +
    `[ -n "$apparent_bin" ] && [ -x "$apparent_bin" ] || { echo 'Install Apparent CLI on this computer' >&2; exit 127; }\n`;
}
function cliCommand(subcommand: 'hermes record' | 'capture inspect' | 'capture handoff', args: string[]) { return `${cliPrefix()}"$apparent_bin" ${subcommand} ${args.map(shellQuote).join(' ')}`; }
/** Launch the direct Hermes recording worker using its public request capability. */
export function recordCommand(token: string, port: number) {
  if (!validToken(token) || !Number.isInteger(port) || port < 32768 || port > 60999) throw new Error('Invalid recording request');
  return cliCommand('hermes record', [`${token}/${port}`]);
}
export function captureInspectCommand(token: string) {
  if (!validToken(token)) throw new Error('Invalid capture identity');
  return cliCommand('capture inspect', [token]);
}
export function captureHandoffCommand(token: string) {
  if (!validToken(token)) throw new Error('Invalid capture identity');
  return cliCommand('capture handoff', [token]);
}
export function keyCommand(token: string) {
  if (!validToken(token)) throw new Error('Invalid recording request');
  return `case "$(uname -s)" in Darwin) apparent_bridge_dir="$(getconf DARWIN_USER_TEMP_DIR)";; Linux) apparent_bridge_dir="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}";; *) exit 64;; esac\ncat "$apparent_bridge_dir/apparent-hermes/${token}.key"`;
}
export function validSource(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 4096 && !/[\x00-\x1f\x7f]/.test(s) &&
    (validToken(s) || (s.startsWith('/') && s.endsWith('.apparent')));
}
export function submission(destination: Destination, token: string, source: string) {
  if (!destination.connectionId || !destination.profile || !validToken(token) || !validSource(source)) throw new Error('Invalid recording delivery');
  if (!destination.local && !validToken(source)) throw new Error('This recording is local. Enable Connect uploads in Apparent before recording for a remote Hermes backend. Nothing was sent.');
  return { session_id: destination.session, input_id: token,
    text: `Apparent recording (.apparent): ${source}\nUse apparent_inspect with this exact source to read my spoken instructions and the recording’s images, then act on them. Use the make-it-apparent skill for your reply, and include the playable video it produces in this conversation.` };
}
export interface Pending { version: 3; token: string; port: number; destination: Destination; runtime: Runtime; localRoute: { connectionId: string; profile: string; targetProfile: string }; localRuntime: Runtime; helper: string; draftKey?: string; retrySource?: boolean; paused?: boolean; created: number; source?: string; sending?: boolean }
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export async function mailboxId(secret: string) {
  if (!validToken(secret)) throw new Error('Invalid mailbox capability');
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
}
export async function sign(secret: string, text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}
export async function authenticatedState(secret: string, packet: unknown) {
  const value = packet as { payload?: unknown; mac?: unknown };
  if (!value || typeof value.payload !== 'string' || value.payload.length > 24576 || typeof value.mac !== 'string' || !/^[a-f0-9]{64}$/.test(value.mac)) throw new Error('Unauthenticated Apparent result');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signature = Uint8Array.from(value.mac.match(/../g)!, pair => parseInt(pair, 16));
  if (!await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(value.payload))) throw new Error('Unauthenticated Apparent result');
  return JSON.parse(value.payload);
}
export interface Runtime { instance_id: string; profile_id: string; authority_epoch: number; capabilities: string[] }
export function runtime(value: Runtime): Runtime {
  if (!value || !value.instance_id || !value.profile_id || !Number.isInteger(value.authority_epoch) || !value.capabilities?.includes('durable-admission-v1')) throw new Error('Hermes gateway lacks the required identity/admission contract');
  return { instance_id: value.instance_id, profile_id: value.profile_id, authority_epoch: value.authority_epoch, capabilities: ['durable-admission-v1'] };
}
export function sameRuntime(a: Runtime, b: Runtime) { return a.instance_id === b.instance_id && a.profile_id === b.profile_id && a.authority_epoch === b.authority_epoch; }
