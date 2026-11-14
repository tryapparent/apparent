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
  if (origin && ![env.API_ORIGIN,env.SITE_ORIGIN,'https://claude.ai','https://chatgpt.com'].includes(origin)) fail('forbidden',403);
  if (request.method !== 'POST') return new Response(null,{status:405,headers:{Allow:'POST'}});
  const raw = await bounded(request,131072);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const server = new McpServer({name:'apparent-connect',version:'1.1.0'}, {instructions:
    'End-to-end encrypted recording relay. Use the updated local apparent-connect-mcp reader: prefer inspect for images, fetch only when the full movie is needed. The run JSON-lines interface lets a host tool loop exchange complete replies without putting ciphertext in model context. Never transcribe opaque replies or send private keys/tokens. Approve read access at the printed browser URL. Transfers negotiate up to 1 MiB per call; old readers keep 16 KiB. This server cannot decrypt images. Open verified output before interpreting it.'});
  const content = (value: unknown) => ({content:[{type:'text' as const,text:JSON.stringify(value)}]});
  server.registerTool('connect_relay_open',{
    description:'Open a short-lived encrypted channel to an endpoint CLI. Supply only the public recipient and nonce printed by that CLI. This grants no recording access.',
    inputSchema:{recipient:z.object({kty:z.literal('EC'),crv:z.literal('P-256'),x:z.string().length(43),y:z.string().length(43)}).strict(),nonce:z.string().regex(/^[a-f0-9]{32}$/)},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  },async ({recipient,nonce}) => content(await openRelay(env,recipient,nonce,ip)));
  server.registerTool('connect_relay',{
    description:'Execute the opaque request printed by the updated offline reader. Feed the entire result to its run stdin or step reply file without transcription. Prefer its inspect mode to retrieve authenticated images without grouped media; fetch retrieves a full recording. New readers negotiate up to 1 MiB of ciphertext per call. Read approval, polling, renewal and revocation remain required. No plaintext recording or credentials are returned.',
    inputSchema:{ticket:z.string().min(20).max(8192),sealed:z.string().min(20).max(32768)},
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async ({ticket,sealed}) => content(await relay(env,ticket,sealed,ip)));
  const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);
  try { return await transport.handleRequest(new Request(request.url,{method:'POST',headers:request.headers,body:raw})); }
  finally { await server.close(); }
}
