import {CompactEncrypt, compactDecrypt, exportJWK, generateKeyPair, importJWK, type JWK} from 'jose';
import {ApiError, bearer, body, bounded, envelope, fail, hash, isRecord, json, rate, stmt} from '../common.ts';
import {authRoutes} from '../auth.ts';
import {captureForAccount} from '../captures.ts';
import {getObject} from '../storage.ts';
import type {Env, FileRow} from '../types.ts';
import {CAPTURE_FORMAT, RELAY_BYTES, RELAY_TTL_MS, REQUEST_TYPE, RESPONSE_TYPE, captureId, transportPath, transportKey} from '../../../client/typescript/src/mcp-wire.ts';

export async function publicKey(value: unknown): Promise<JWK> {
  if (!transportKey(value)) fail('invalid_request');
  await importJWK(value as JWK, 'ECDH-ES');
  return value as JWK;
}

export async function openRelay(env: Env, recipient: unknown, nonce: string, ip: string) {
  await rate(env, 'mcp-open:'+ip, 120);
  const responseKey = await publicKey(recipient);
  const {privateKey, publicKey: key} = await generateKeyPair('ECDH-ES', {crv:'P-256', extractable:true});
  const expiresAt = Date.now()+RELAY_TTL_MS;
  // This key protects transport credentials, not recordings. The sealed ticket is
  // stateless, expires promptly and uses the existing service secret envelope.
  const ticket = await envelope(env, JSON.stringify({purpose:'mcp-relay-v1', origin:env.API_ORIGIN,
    expiresAt, responseKey, key:await exportJWK(privateKey)}));
  return {version:1, origin:env.API_ORIGIN, nonce, expiresAt, key:await exportJWK(key), ticket};
}

async function dispatch(env: Env, value: unknown, ip: string): Promise<Response> {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id)) fail('invalid_request');
  const operation = value.operation;
  if (operation === 'start') {
    if (!isRecord(value.encryptionKey)) fail('invalid_request');
    return native(env, '/v1/device/start', {scope:'read', encryptionKey:value.encryptionKey}, undefined, ip);
  }
  if (operation === 'poll' || operation === 'refresh') {
    const secret = operation === 'poll' ? value.deviceCode : value.refreshToken;
    if (typeof secret !== 'string' || secret.length < 20 || secret.length > 2048) fail('invalid_request');
    const row = operation === 'poll'
      ? await stmt(env, 'SELECT scope FROM auth_grants WHERE device_hash=?', await hash(secret)).first<{scope:string}>()
      : await stmt(env, 'SELECT g.scope FROM auth_grants g JOIN oauthRefreshToken t ON t.clientId=g.client_id AND t.userId=g.user_id WHERE t.token=?', await hash(secret)).first<{scope:string}>();
    if (!row || row.scope !== 'read') fail('unauthorized',401);
    return native(env, operation === 'poll' ? '/v1/device/poll' : '/v1/token/refresh',
      operation === 'poll' ? {deviceCode:secret} : {refreshToken:secret});
  }
  if (typeof value.accessToken !== 'string' || value.accessToken.length > 2048) fail('unauthorized',401);
  const request = new Request(env.API_ORIGIN, {headers:{Authorization:'Bearer '+value.accessToken}});
  const account = await bearer(request,env);
  if (account.scope !== 'read') fail('forbidden',403);
  if (operation === 'revoke') {
    if (typeof value.refreshToken !== 'string' || value.refreshToken.length > 2048) fail('invalid_request');
    return native(env,'/v1/token/revoke',{refreshToken:value.refreshToken},value.accessToken);
  }
  if (operation === 'peers') return native(env,'/v1/encryption/peers',undefined,value.accessToken);
  if (!captureId(value.captureId) || !['manifest','part'].includes(String(operation))) fail('invalid_request');
  const capture = await captureForAccount(env,value.captureId,account.account_id);
  if (capture.format !== CAPTURE_FORMAT) fail('encrypted_capture_required',409);
  if (operation === 'manifest') return json({id:capture.id,status:capture.status,format:capture.format,
    files:JSON.parse(capture.manifest),expiresAt:new Date(capture.expires_at).toISOString()});
  if (capture.status !== 'ready') fail('not_ready',409);
  if (!transportPath(value.path) || !Number.isSafeInteger(value.offset) || (value.offset as number) < 0) fail('invalid_request');
  const file = await stmt(env,'SELECT * FROM files WHERE capture_id=? AND path=?',capture.id,value.path).first<FileRow>();
  if (!file?.object_key || (value.offset as number) >= file.size) fail('not_found',404);
  const offset = value.offset as number, length = Math.min(RELAY_BYTES,file.size-offset);
  const object = await getObject(env,file.object_key,{range:{offset,length}});
  if (!object) fail('not_found',404);
  const bytes = await bounded(new Response(object.body),length);
  if (bytes.length !== length) fail('size_mismatch',409);
  await bearer(request,env);
  await captureForAccount(env,capture.id,account.account_id);
  return json({path:file.path,offset,total:file.size,data:btoa(String.fromCharCode(...bytes))});
}

async function native(env: Env, path: string, data?: Record<string,unknown>, token?: string, ip?: string) {
  const url = new URL(path,env.API_ORIGIN);
  const request = new Request(url,{method:data?'POST':'GET',headers:{
    ...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(ip?{'CF-Connecting-IP':ip}:{})},
    ...(data?{body:JSON.stringify(data)}:{})});
  return await authRoutes(request,env,url) ?? fail('invalid_request');
}

export async function relay(env: Env, ticket: string, sealed: string, ip: string) {
  await rate(env,'mcp-relay:'+ip,20000);
  let session: Record<string,unknown>;
  let plaintext: Uint8Array;
  try {
    session = JSON.parse(await envelope(env,ticket,true));
    if (!isRecord(session) || session.purpose !== 'mcp-relay-v1' || session.origin !== env.API_ORIGIN ||
        !Number.isSafeInteger(session.expiresAt) || (session.expiresAt as number) <= Date.now() ||
        (session.expiresAt as number) > Date.now()+RELAY_TTL_MS) fail('relay_expired',401);
    const result = await compactDecrypt(sealed,await importJWK(session.key as JWK,'ECDH-ES'),{
      keyManagementAlgorithms:['ECDH-ES'],contentEncryptionAlgorithms:['A256GCM']});
    if (result.protectedHeader.typ !== REQUEST_TYPE) fail('invalid_request');
    plaintext = result.plaintext;
  } catch { fail('relay_unavailable',401); }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext)); } catch { fail('invalid_request'); }
  const id = isRecord(value) && typeof value.id === 'string' ? value.id : '';
  let response: Response;
  try { response = await dispatch(env,value,ip); }
  catch (error) { response = Response.json({error:{code:error instanceof ApiError?error.code:'internal_error'}},{status:error instanceof ApiError?error.status:500}); }
  const result = {id,status:response.status,body:await body(response)};
  return {sealed:await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(result)))
    .setProtectedHeader({alg:'ECDH-ES',enc:'A256GCM',typ:RESPONSE_TYPE})
    .encrypt(await importJWK(await publicKey(session.responseKey),'ECDH-ES'))};
}
