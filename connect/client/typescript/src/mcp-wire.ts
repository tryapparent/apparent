/** The relay wraps existing read authorization; it never decrypts capture content. */
export const RELAY_BYTES = 16 * 1024;
export const RELAY_TTL_MS = 10 * 60 * 1000;
export const REQUEST_TYPE = 'apparent-mcp-request+jwe';
export const RESPONSE_TYPE = 'apparent-mcp-response+jwe';
export const CAPTURE_FORMAT = 'apparent-encrypted-v1';
export type PublicKey = {version: 1; recipient: string; signing: string};
export type RelayOperation =
  | {operation: 'start'; encryptionKey: PublicKey}
  | {operation: 'poll'; deviceCode: string}
  | {operation: 'refresh'; refreshToken: string}
  | {operation: 'revoke'; accessToken: string; refreshToken: string}
  | {operation: 'peers'; accessToken: string}
  | {operation: 'manifest'; accessToken: string; captureId: string}
  | {operation: 'part'; accessToken: string; captureId: string; path: string; offset: number};
export type RelayRequest = RelayOperation & {id: string};
export type RelayResponse = {id: string; status: number; body: unknown};
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function captureId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}
export function transportKey(value:unknown): value is {kty:'EC';crv:'P-256';x:string;y:string} {
  return record(value) && Object.keys(value).sort().join(',')==='crv,kty,x,y' &&
    value.kty==='EC' && value.crv==='P-256' &&
    [value.x,value.y].every(v=>typeof v==='string' && /^[A-Za-z0-9_-]{43}$/.test(v));
}
export function transportPath(value: unknown): value is string {
  return typeof value === 'string' && /^(?:(?:evidence|media)\/)?(envelope\.json|sealed\/part-[0-9]{6}\.age)$/.test(value);
}
