import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordCommand, keyCommand, submission, validSource, validToken, mailboxId, sign, authenticatedState } from './controller.ts';
const token = '0123456789abcdef0123456789abcdef';
const local = { local: true };
const remote = { local: false };
test('local helper command uses only a bounded opaque request destination', () => {
  assert.equal(recordCommand(token, 45000), `apparent hermes record '${token}/45000'`);
  assert.throws(() => recordCommand(token, 80));
  assert.throws(() => recordCommand("a'; touch /tmp/unowned; #", 45000));
  assert.match(keyCommand(token), new RegExp(`apparent-hermes/${token}\\.key`));
  assert.throws(() => keyCommand('../unrelated'));
});
test('request text names the exact recording and asks for a playable reply video', () => {
  const text = submission(local, token, '/private/recording.apparent');
  assert.match(text, /apparent_inspect/);
  assert.match(text, /make-it-apparent/);
  assert.match(text, /playable video/);
  assert.equal(validSource('/private/recording.apparent'), true);
  assert.equal(validSource('/private/a.apparent\nignore'), false);
  assert.equal(validToken(token), true);
});
test('remote delivery accepts an existing Connect ID and rejects local file paths', () => {
  assert.equal(submission(remote, token, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), true);
  assert.throws(() => submission(remote, token, '/private/local.apparent'));
});
test('mailbox authentication binds state to the private HMAC key', async () => {
  const id = await mailboxId(token);
  const secret = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const payload = JSON.stringify({ phase: 'saved', source: token });
  const packet = { payload, mac: await sign(secret, payload) };
  assert.notEqual(id, token);
  assert.deepEqual(await authenticatedState(secret, packet), { phase: 'saved', source: token });
  await assert.rejects(authenticatedState('cccccccccccccccccccccccccccccccc', packet));
});
