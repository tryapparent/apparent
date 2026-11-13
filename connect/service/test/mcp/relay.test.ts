import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from '../helpers.mjs';

test('remote MCP advertises an encrypted endpoint relay instead of server-side image inspection', async () => {
  const f = await fixture();
  try {
    const response = await f.call('/mcp', {method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    }, body: {jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}}});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.result.tools.map((tool: {name: string}) => tool.name).sort(),
      ['connect_relay', 'connect_relay_open']);
    assert.equal(body.result.tools.some((tool: {name: string}) => /frame|inspect/.test(tool.name)), false);
  } finally { await f.close(); }
});
