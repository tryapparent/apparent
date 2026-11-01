import type {Env, OAuthStateRow, DeviceRow} from './types.ts';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {DAY,random,hash,json,fail,stmt,body,cookie,setCookie,session,csrf,usage,slots,rate,envelope,bearer} from './common.ts';
const jwks=new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const provider=(env: Env)=>({issuer:env.OAUTH_ISSUER||'https://accounts.google.com',authorize:env.OAUTH_AUTHORIZATION_URL||'https://accounts.google.com/o/oauth2/v2/auth',token:env.OAUTH_TOKEN_URL||'https://oauth2.googleapis.com/token',jwks:env.OAUTH_JWKS_URL||'https://www.googleapis.com/oauth2/v3/certs'});
function returnTo(value: string | null) {
 // Validate the raw fixed path, not URL-normalized input (no URLs/dot segments).
 const match=/^\/(?:connect|hosted)(\/device)?\/?(?:\?([^#]*))?$/.exec(value??'/connect');
 if(!match)fail('invalid_request');
 const query=new URLSearchParams(match[2]);
 if([...query.keys()].some(key=>key!=='code')||query.getAll('code').length>1)fail('invalid_request');
 const code=query.get('code');
 return '/connect'+(match[1]||'')+(code!==null?'?'+new URLSearchParams({code}).toString():'');
}
export async function authRoutes(request: Request,env: Env,url: URL) {
 const p=url.pathname,m=request.method;
 if(p==='/auth/google/start'&&m==='GET') {
  await rate(env,'oauth:'+request.headers.get('CF-Connecting-IP'));
  const state=random(),nonce=random(),verifier=random(),dest=returnTo(url.searchParams.get('returnTo'));
  await stmt(env,'INSERT INTO oauth_states VALUES(?,?,?,?,?)',await hash(state),nonce,verifier,dest,Date.now()+600000).run();
  const auth=new URL(provider(env).authorize);
  const bytes=Uint8Array.from((await hash(verifier)).match(/../g)!,x=>parseInt(x,16));
  const challenge=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  for(const [k,v] of Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:env.API_ORIGIN+'/auth/google/callback',response_type:'code',scope:'openid email',state,nonce,code_challenge:challenge,code_challenge_method:'S256'}))auth.searchParams.set(k,v);
  return new Response(null,{status:302,headers:{Location:auth.href,'Set-Cookie':setCookie('__Host-apparent_oauth',state,600)}});
 }
 if(p==='/auth/google/callback'&&m==='GET') {
  try {
   const state=url.searchParams.get('state');if(!state||state!==cookie(request,'__Host-apparent_oauth')||!url.searchParams.get('code'))throw new Error();
   const stored=await stmt(env,'DELETE FROM oauth_states WHERE hash=? AND expires_at>? RETURNING *',await hash(state),Date.now()).first<OAuthStateRow>();if(!stored)throw new Error();
   const dest=returnTo(stored.return_to);
   const config=provider(env);
   const response=await fetch(config.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code')!,redirect_uri:env.API_ORIGIN+'/auth/google/callback',client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code_verifier:stored.verifier}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error();const token=await body(response,32768);if(typeof token.id_token!=='string')throw new Error();
   if(!jwks.has(config.jwks))jwks.set(config.jwks,createRemoteJWKSet(new URL(config.jwks)));
   const {payload}=await jwtVerify(token.id_token,jwks.get(config.jwks)!,{issuer:env.OAUTH_ISSUER?config.issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce','email','email_verified'],maxTokenAge:'10m'});
   if(payload.nonce!==stored.nonce||payload.email_verified!==true||typeof payload.email!=='string'||payload.email.length>254||typeof payload.sub!=='string'||payload.sub.length>255||(payload.azp&&payload.azp!==env.GOOGLE_CLIENT_ID))throw new Error();
   const account=await hash(config.issuer+'/'+payload.sub);
   await stmt(env,"INSERT INTO accounts(id,email,beta,created_at) SELECT ?,?,CASE WHEN (SELECT count(*) FROM accounts WHERE beta='active')<20 THEN 'active' ELSE 'waitlist' END,? ON CONFLICT(id) DO UPDATE SET email=excluded.email",account,payload.email,Date.now()).run();
   const sessionToken=random(),csrfToken=random();
   await stmt(env,'INSERT INTO sessions VALUES(?,?,?,?)',await hash(sessionToken),account,csrfToken,Date.now()+7*DAY).run();
   const headers=new Headers({Location:env.SITE_ORIGIN+dest});headers.append('Set-Cookie',setCookie('__Host-apparent_session',sessionToken,7*86400));headers.append('Set-Cookie',setCookie('__Host-apparent_oauth','',0));
   return new Response(null,{status:302,headers});
  } catch {fail('oauth_failed',401);}
 }
 if(p==='/v1/session'&&m==='GET') {
  const s=await session(request,env,false);
  return json({authenticated:!!s,csrfToken:s?.csrf||null,account:s?{email:s.email,beta:s.beta,quotaBytes:500000000,usedBytes:await usage(env,s.account_id),waitlist:{interestedAtFiveDollars:!!s.interest}}:null,slots:await slots(env)});
 }
 if(p==='/auth/logout'&&m==='POST') {
  const s=await session(request,env);csrf(request,env,s);await stmt(env,'DELETE FROM sessions WHERE hash=?',s.hash).run();
  return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Set-Cookie':setCookie('__Host-apparent_session','',0)}});
 }
 if(p==='/v1/waitlist'&&m==='POST') {
  const s=await session(request,env);csrf(request,env,s);const b=await body(request);if(typeof b.interestedAtFiveDollars!=='boolean')fail('invalid_request');
  await stmt(env,'UPDATE accounts SET interest=? WHERE id=?',b.interestedAtFiveDollars?1:0,s.account_id).run();return json({ok:true});
 }
 if(p==='/v1/device/start'&&m==='POST') {
  await rate(env,'device:'+request.headers.get('CF-Connecting-IP'));
  const b=await body(request);if(b.scope!=='upload'&&b.scope!=='read')fail('invalid_request');
  const deviceCode=random(),userCode=random(6).toUpperCase();
  await stmt(env,'INSERT INTO devices(hash,user_code,scope,expires_at) VALUES(?,?,?,?)',await hash(deviceCode),userCode,b.scope,Date.now()+600000).run();
  return json({deviceCode,userCode,verificationUri:env.SITE_ORIGIN+'/connect/device?code='+userCode,expiresIn:600,interval:5});
 }
 if(p==='/v1/device/poll'&&m==='POST') {
  const {deviceCode}=await body(request);if(typeof deviceCode!=='string'||! /^[a-f0-9]{64}$/.test(deviceCode))fail('invalid_request');
  const h=await hash(deviceCode),now=Date.now();
  const d=await stmt(env,'SELECT * FROM devices WHERE hash=?',h).first<DeviceRow>();if(!d||d.expires_at<=now)return json({status:'expired'});
  const changed=await stmt(env,'UPDATE devices SET last_poll=? WHERE hash=? AND last_poll<=?',now,h,now-5000).run();if(!changed.meta.changes)fail('slow_down',429);
  if(d.status==='approved') {
   const token=await stmt(env,'SELECT hash FROM tokens WHERE hash=? AND expires_at>?',d.token_hash,now).first();if(!token)return json({status:'rejected'});
   return json({status:'approved',accessToken:await envelope(env,d.envelope!,true),scope:d.scope});
  }
  return json({status:d.status});
 }
 if(p==='/v1/device'&&m==='GET') {
  const s=await session(request,env);await rate(env,'preview:'+s.account_id,120);
  const code=url.searchParams.get('userCode');if(!code||! /^[A-F0-9]{12}$/.test(code))fail('invalid_request');
  const d=await stmt(env,'SELECT scope,status,expires_at FROM devices WHERE user_code=?',code).first<Pick<DeviceRow,'scope'|'status'|'expires_at'>>();if(!d)fail('device_unavailable',404);
  return json({scope:d.scope,status:d.expires_at<=Date.now()?'expired':d.status,expiresAt:new Date(d.expires_at).toISOString()});
 }
 if(['/v1/device/approve','/v1/device/reject'].includes(p)&&m==='POST') {
  const s=await session(request,env);csrf(request,env,s);await rate(env,'approve:'+s.account_id);
  const {userCode}=await body(request);if(typeof userCode!=='string'||! /^[A-F0-9]{12}$/.test(userCode))fail('invalid_request');
  const d=await stmt(env,'SELECT * FROM devices WHERE user_code=?',userCode).first<DeviceRow>();if(!d||d.expires_at<=Date.now())fail('device_unavailable',404);
  if(d.status!=='pending'){if(d.account_id===s.account_id&&d.status===(p.endsWith('approve')?'approved':'rejected'))return json({ok:true});fail('device_unavailable',409);}
  if(p.endsWith('reject')) {
   const r=await stmt(env,"UPDATE devices SET status='rejected',account_id=? WHERE hash=? AND status='pending' AND expires_at>?",s.account_id,d.hash,Date.now()).run();if(!r.meta.changes)fail('device_unavailable',409);
  }else {
   if(s.beta!=='active')fail('beta_required',403);
   const token=random(),h=await hash(token),encrypted=await envelope(env,token);
   const result=await env.DB.batch([
    stmt(env,"UPDATE devices SET status='approved',account_id=?,token_hash=?,envelope=? WHERE hash=? AND status='pending' AND expires_at>?",s.account_id,h,encrypted,d.hash,Date.now()),
    stmt(env,"INSERT INTO tokens(hash,account_id,scope,expires_at) SELECT ?,account_id,scope,? FROM devices WHERE hash=? AND token_hash=? AND status='approved'",h,Date.now()+30*DAY,d.hash,h)
   ]);
   if(!result[0].meta.changes)fail('device_unavailable',409);
  }
  return json({ok:true});
 }
 if(p==='/v1/token/revoke'&&m==='POST'){const a=await bearer(request,env);await stmt(env,'DELETE FROM tokens WHERE hash=?',a.hash).run();return json({ok:true});}
 return null;
}
