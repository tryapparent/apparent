export interface Destination {
  session: string;
  storedSession: string;
  connectionId: string;
  profile: string;
  targetProfile: string;
  mode: string;
  local: boolean;
}
// Preflight only: native Start still owns atomic capture admission.
export function captureCanStart(phase: unknown): boolean { return phase === 'idle' || phase === 'completed'; }
export interface LocalRoute { connectionId: string; profile: string; targetProfile: string }
export interface Pending {
  version: 3;
  token: string;
  port: number;
  destination: Destination;
  localRoute: LocalRoute;
  created: number;
  source?: string;
  /** A true SDK dispatch has no durable receipt, so never automatically replay it. */
  sending?: boolean;
  /** A definitive false dispatch is also left for an explicit manual recovery. */
  manual?: boolean;
}
export const validToken = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export function validSource(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value)
    && (validToken(value) || (value.startsWith('/') && value.endsWith('.apparent')));
}
export function recordCommand(token: string, port: number) {
  if (!validToken(token) || !Number.isInteger(port) || port < 32768 || port > 60999) throw new Error('Invalid recording request');
  return `apparent hermes record '${token}/${port}'`;
}
export function keyCommand(token: string) {
  if (!validToken(token)) throw new Error('Invalid recording request');
  return `case "$(uname -s)" in Darwin) apparent_bridge_dir="$(getconf DARWIN_USER_TEMP_DIR)";; Linux) apparent_bridge_dir="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}";; *) exit 64;; esac\ncat "$apparent_bridge_dir/apparent-hermes/${token}.key"`;
}
export function submission(destination: Pick<Destination, 'local'>, token: string, source: string) {
  if (!validToken(token) || !validSource(source) || (!destination.local && !validToken(source))) throw new Error('Invalid recording delivery');
  return `Apparent recording (.apparent): ${source}\nUse apparent_inspect with this exact source, then follow the make-it-apparent workflow. Inspect the complete recording, carry out my spoken instructions, and reply with a playable video of your work embedded or linked here. If you cannot provide one, say what blocked it and what you verified.`;
}
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
export async function mailboxId(token: string) {
  if (!validToken(token)) throw new Error('Invalid mailbox capability');
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
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
