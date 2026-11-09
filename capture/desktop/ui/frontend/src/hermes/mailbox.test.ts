import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availablePort } from './testing/port.ts';
import { mailbox } from './mailbox.ts';
import type { View } from './protocol.ts';
import { mailboxId, sign, authenticatedState } from '../../../../../../hermes/desktop/controller.ts';
const token = '0123456789abcdef0123456789abcdef';
test('mailbox signs only owned state and uses a separate authenticated acknowledgement', async () => {
  const port = await availablePort();
  let view: View = { phase: 'recording', source: '/private/not-saved.apparent' };
  let acks = 0;
  const server = await mailbox(token, port, () => view, () => { acks++; view = { phase: 'cancelled' }; });
  const id = await mailboxId(token);
  const ack = `ack/${await sign(token, `ack:${id}`)}`;
  try {
    const read = (suffix = 'state', origin = 'null', held = id) => fetch(`http://127.0.0.1:${port}/${held}/${suffix}`, { headers: { Origin: origin }, ...(suffix.startsWith('ack/') ? { method: 'POST' } : {}) });
    assert.deepEqual(await authenticatedState(token, await (await read()).json()), { phase: 'recording' });
    assert.deepEqual(await authenticatedState(token, await (await fetch(`http://127.0.0.1:${port}/${id}/state`)).json()), { phase: 'recording' });
    assert.equal((await read('state', 'https://evil.example')).status, 403);
    assert.equal((await read('state', 'null', token)).status, 404);
    assert.equal((await read(ack)).status, 404);
    view = { phase: 'saved', source: '/private/owned.apparent' };
    const packet = await (await read()).json();
    assert.equal((await authenticatedState(token, packet)).source, '/private/owned.apparent');
    assert.equal((await read('ack/' + packet.mac)).status, 404);
    assert.equal((await read(ack)).status, 200);
    assert.equal((await read(ack)).status, 404);
    assert.equal(acks, 1);
    await assert.rejects(mailbox(token, port, () => view, () => {}));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
