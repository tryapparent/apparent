import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';
import type {Env} from '../types.ts';
import {bounded, fail} from '../common.ts';
import {openRelay,relay} from './relay.ts';

export async function mcpRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/mcp') return null;
  if (url.origin !== env.API_ORIGIN || url.search) fail('invalid_request');
  const origin = request.headers.get('Origin');
  if (origin && ![env.API_ORIGIN,env.SITE_ORIGIN,'https://claude.ai'].includes(origin)) fail('forbidden',403);
  if (request.method !== 'POST') return new Response(null,{status:405,headers:{Allow:'POST'}});
  const raw = await bounded(request,131072);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const server = new McpServer({name:'apparent-connect',version:'1.0.0'}, {instructions:
    'End-to-end encrypted recording relay. Use the local Connect MCP endpoint CLI to create opaque tool arguments and consume sealed replies. Never provide private keys or tokens as tool arguments. Approve read access at the printed browser URL. This server cannot inspect images or decrypt recordings. Full bundles require multiple bounded transfers; do not treat a transcript alone as visual evidence.'});
  const content = (value: unknown) => ({content:[{type:'text' as const,text:JSON.stringify(value)}]});
  server.registerTool('connect_relay_open',{
    description:'Open a short-lived encrypted channel to an endpoint CLI. Supply only the public recipient and nonce printed by that CLI. This grants no recording access.',
    inputSchema:{recipient:z.object({kty:z.literal('EC'),crv:z.literal('P-256'),x:z.string().length(43),y:z.string().length(43)}).strict(),nonce:z.string().regex(/^[a-f0-9]{32}$/)},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  },async ({recipient,nonce}) => content(await openRelay(env,recipient,nonce,ip)));
  server.registerTool('connect_relay',{
    description:'Execute the opaque request printed by the endpoint CLI and save the entire sealed result for its next step. Read approval, polling, renewal, revocation and encrypted recording transfer only. No plaintext recording or credentials are returned.',
    inputSchema:{ticket:z.string().min(20).max(8192),sealed:z.string().min(20).max(32768)},
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async ({ticket,sealed}) => content(await relay(env,ticket,sealed,ip)));
  const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);
  try { return await transport.handleRequest(new Request(request.url,{method:'POST',headers:request.headers,body:raw})); }
  finally { await server.close(); }
}
