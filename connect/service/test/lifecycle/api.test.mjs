import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../helpers.mjs';

test('real Worker device authorization starts pending with requested scope', async () => {
 const f = await fixture();
 try {
  const r = await f.call('/v1/device/start',{method:'POST',body:{scope:'read'}});
  assert.equal(r.status,200);
  const d = await r.json(); assert.match(d.deviceCode,/^[a-f0-9]{64}$/); assert.equal(d.interval,5);
  const p = await f.call('/v1/device/poll',{method:'POST',body:{deviceCode:d.deviceCode}});
  assert.deepEqual(await p.json(),{status:'pending'});
 } finally { await f.close(); }
});
