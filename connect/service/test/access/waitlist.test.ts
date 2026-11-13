import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../helpers.mjs';

test('only a verified waitlisted session can report eligibility; polling issues no credentials',async()=>{
 const f=await fixture();try{
  const a=await f.identity('waitlisted-onboarding');
  await f.db.prepare("UPDATE accounts SET beta='waitlist' WHERE id=?").bind(a.id).run();
  const d=await(await f.call('/v1/device/start',{method:'POST',body:{scope:'upload'}})).json();
  const report=(options={})=>f.call('/v1/device/waitlist',{...a,method:'POST',body:{userCode:d.userCode},...options});
  assert.equal((await report({csrf:'wrong'})).status,403);
  assert.equal((await report()).status,200);
  const poll=await(await f.call('/v1/device/poll',{method:'POST',body:{deviceCode:d.deviceCode}})).json();
  assert.deepEqual(poll,{status:'waitlisted'});
  assert.equal((await f.call('/v1/device/approve',{...a,method:'POST',body:{userCode:d.userCode}})).status,403);
  const grant=await f.db.prepare('SELECT * FROM auth_grants WHERE user_code=?').bind(d.userCode).first();
  assert.equal(grant.approved_at,null);assert.equal(grant.response,null);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM oauthAccessToken WHERE clientId=?').bind(grant.client_id).first()).n,0);
  const b=await f.identity('other-waitlist');
  await f.db.prepare("UPDATE accounts SET beta='waitlist' WHERE id=?").bind(b.id).run();
  assert.equal((await report(b)).status,409);
 }finally{await f.close();}
});

test('active, expired and revoked requests cannot be reported as waitlisted',async()=>{
 const f=await fixture();try{
  const a=await f.identity('waitlist-refusals');
  const start=async()=>await(await f.call('/v1/device/start',{method:'POST',body:{scope:'upload'}})).json();
  const d=await start(),report=(userCode:string)=>f.call('/v1/device/waitlist',{...a,method:'POST',body:{userCode}});
  assert.equal((await report(d.userCode)).status,409);
  await f.db.prepare("UPDATE accounts SET beta='waitlist' WHERE id=?").bind(a.id).run();
  await f.db.prepare('UPDATE auth_grants SET expires_at=0 WHERE user_code=?').bind(d.userCode).run();
  assert.equal((await report(d.userCode)).status,404);
  const r=await start();await f.db.prepare('UPDATE auth_grants SET revoked_at=1 WHERE user_code=?').bind(r.userCode).run();
  assert.equal((await report(r.userCode)).status,409);
 }finally{await f.close();}
});
