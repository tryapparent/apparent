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

test('ChatGPT and Claude MCP origins are exact; unrelated sites cannot call the relay',async()=>{
  const f=await fixture();try {
    for(const origin of ['https://chatgpt.com','https://claude.ai','https://chatgpt.com.evil.example','https://claude.ai/','null']) {
      const response=await f.call('/mcp',{method:'POST',origin,headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
        body:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'synthetic-host',version:'1'}}}});
      assert.equal(response.status,['https://chatgpt.com','https://claude.ai'].includes(origin)?200:403,origin);
      if(response.status===200)assert.equal((await response.json()).result.serverInfo.name,'apparent-connect');
      assert.equal(response.headers.get('Access-Control-Allow-Origin'),null,'MCP host admission does not widen browser API CORS');
    }
  } finally {await f.close();}
});
