import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handoffPointer, alternatives, fetchFailure, mcpRecovery } from '../src/handoff.ts';

test('only pending and ready captures select Connect, never sign-in or terminal jobs', () => {
  const id = 'a'.repeat(32);
  for (const status of ['pending', 'ready']) {
    assert.equal(handoffPointer({ id, status }), `apparent inspect ${id}\n`);
  }
  for (const status of ['failed', 'expired', 'cancelled', 'awaiting_share', 'unknown', undefined]) {
    assert.equal(handoffPointer({ id, status }), null);
  }
  for (const value of [null, { authenticated: true }, { id: '../private', status: 'ready' }]) {
    assert.equal(handoffPointer(value), null);
  }
});

test('configuration and transport recovery discover the encrypted MCP route without claiming an egress diagnosis', () => {
  assert.match(fetchFailure('server_configuration')!, /confirmed-https-origin.*--scope read --no-browser/);
  assert.match(fetchFailure('server_configuration')!, /does not prove an egress block/);
  assert.match(fetchFailure('transport')!, /network restriction, timeout, response limit or unexpected HTTP response/);
  for (const text of [alternatives, fetchFailure('server_configuration')!, fetchFailure('transport')!]) {
    assert.ok(text.includes(mcpRecovery));
    assert.match(text, /https:\/\/app\.tryapparent\.com\/connect\/mcp/);
    assert.match(text, /https:\/\/chatgpt\.com\/plugins.*plus button.*Add custom MCP server/);
    assert.match(text, /Name: Apparent\. Server URL:/);
    assert.match(text, /Authentication: No authentication.*risk warning.*Create as a plugin/);
    assert.match(text, /Install Apparent, start a new Work conversation.*using @/);
    assert.match(text, /workspace policy.*administrator; do not bypass/);
    assert.match(text, /agent should handle reader setup.*read-approval link.*resume retrieval/);
    assert.match(text, /separate offline apparent-connect-mcp reader/);
    assert.match(text, /older native CLIs do not include this command/);
    assert.match(text, /newly approved reader cannot decrypt an older capture/);
  }
  for (const kind of ['unavailable', 'authorization', 'integrity', 'unknown']) {
    assert.ok(!fetchFailure(kind)?.includes(mcpRecovery), kind);
  }
});

test('recovery explains account admission, complete local transfer and consent', () => {
  assert.match(alternatives, /waitlisted accounts cannot approve devices/);
  assert.match(alternatives, /scp -r/);
  assert.match(alternatives, /apparent inspect \.\/capture.apparent/);
  assert.match(alternatives, /do not enable remote access/);
  assert.match(alternatives, /Previously pasted Connect IDs do not change/);
});

test('recipient failures preserve 404 ambiguity and approved-origin guidance', () => {
  assert.match(fetchFailure('unavailable')!, /Capture unavailable.*sender may still be uploading/);
  assert.match(fetchFailure('unavailable')!, /expired or been deleted.*account.*API origin/);
  assert.match(fetchFailure('unavailable')!, /fresh handoff.*--wait 120/);
  assert.match(fetchFailure('authorization')!, /authorization failed.*configured API origin/);
  assert.equal(fetchFailure('unknown'), null);
});
