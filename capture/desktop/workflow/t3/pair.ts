import {URL,URLSearchParams} from 'node:url';
// One-time bootstrap exchange shared by Settings and the optional CLI.
// Codes need an explicit server; full links carry their own. The native caller
// owns the sole config transaction. Never log code/link/token data.
function secureOrigin(url:URL) {
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('T3 requires HTTPS or a loopback connection.');
 return url.origin;
}
function serverOrigin(server?:string,acceptMcpUrl=false) {
 if(typeof server!=='string'||!server.trim()||server.length>2048)throw Error('Paste a T3 MCP URL or enter a server address to use a pairing code.');
 let url:URL;try{url=new URL(server.trim());}catch{throw Error('Enter a valid T3 server address.');}
 const mcpPath=acceptMcpUrl&&(url.pathname==='/mcp'||url.pathname==='/mcp/');
 if(url.username||url.password||url.hash||url.search||(url.pathname!=='/'&&!mcpPath))throw Error('Paste a T3 MCP URL or server address without sign-in details.');
 return secureOrigin(url);
}
export function parsePairingLink(link:string,server?:string):{origin:string;token:string} {
 if(typeof link!=='string'||link.length>16384)throw Error('Copy a T3 pairing code or full link.');
 const input=link.trim();
 if(/^[A-Za-z0-9_-]{1,8192}$/.test(input))return {origin:serverOrigin(server,true),token:input};
 let url:URL;try{url=new URL(input);}catch{throw Error('Copy a T3 pairing code or full link.');}
 if(url.username||url.password)throw Error('Copy a T3 pairing link.');
 if(['t3code:','t3code-dev:','t3code-preview:'].includes(url.protocol)&&url.hostname==='pair'&&url.pathname===''){
  const nested=url.searchParams.get('pairingUrl');if(!nested||nested.length>8192)throw Error('Copy a T3 pairing link.');
  let target:URL;try{target=new URL(nested);}catch{throw Error('Copy a T3 pairing link.');}
  if(!['http:','https:'].includes(target.protocol))throw Error('Copy a T3 pairing link.');
  return parsePairingLink(nested,server);
 }
 if(url.username||url.password||url.pathname!=='/pair')throw Error('Copy a T3 pairing code or full link.');
 const appLink=['t3code:','t3code-dev:','t3code-preview:'].includes(url.protocol)&&url.hostname==='app';
 const directOrigin=url.searchParams.has('host')?serverOrigin(url.searchParams.get('host')!):appLink?serverOrigin(server,true):secureOrigin(url),fragment=new URLSearchParams(url.hash.slice(1)),fragmentToken=fragment.get('token')?.trim();
 if(url.hash&&!fragment.has('token'))throw Error('Copy a T3 pairing code or full link.');
 // T3 puts new tokens in the fragment; retain its legacy query fallback and
 // resolve hosted app links to their embedded backend before confirmation.
 const token=fragmentToken||url.searchParams.get('token')?.trim();
 if(!token||token.length>8192)throw Error('Copy a T3 pairing code or full link.');
 return {origin:directOrigin,token};
}
export async function pair(link:string,signal?:AbortSignal,server?:string){
 const {origin,token}=parsePairingLink(link,server);
 const response=await fetch(new URL('/oauth/token',origin),{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:token,subject_token_type:'urn:t3:params:oauth:token-type:environment-bootstrap',requested_token_type:'urn:ietf:params:oauth:token-type:access_token',scope:'orchestration:read orchestration:operate',client_label:'Apparent',client_device_type:'bot'})});
 if(!response.ok)throw Error('T3 refused pairing. Create a fresh link and try again.');
 const reader=response.body?.getReader();if(!reader)throw Error('T3 did not return a usable session.');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768)throw Error('T3 did not return a usable session.');chunks.push(value);}}
 finally{await reader.cancel();}
 let value:Record<string,unknown>;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('T3 did not return a usable session.');}
 if(!value||typeof value.access_token!=='string'||!value.access_token||value.access_token.length>8192||typeof value.expires_in!=='number'||!Number.isFinite(value.expires_in)||value.expires_in<=0||value.token_type!=='Bearer')throw Error('T3 did not return a usable session.');
 const expiresAt=Date.now()+value.expires_in*1000;if(!Number.isSafeInteger(expiresAt)||expiresAt>8640000000000000)throw Error('T3 did not return a usable session.');
 return {origin,token:value.access_token,expiresAt};
}
