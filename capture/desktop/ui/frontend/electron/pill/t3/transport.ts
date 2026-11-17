import {randomUUID} from 'node:crypto';
export type Connection={origin:string;token:string;expiresAt:number;projectId?:string};
export function connection(value:unknown):Connection|null{
 if(!value||typeof value!=='object')return null;const c=value as Connection;
 try{const u=new URL(c.origin);if(u.origin!==c.origin||u.username||u.password||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))||typeof c.token!=='string'||!c.token||c.token.length>8192||(!Number.isFinite(c.expiresAt)||c.expiresAt<=Date.now()))return null;return c;}catch{return null;}
}
// The first connection retains the legacy shape; additional computers are keyed
// by their origin, never by a renderer-provided address or a thread ID alone.
export function connections(value:unknown):Connection[]{
 if(!value||typeof value!=='object')return [];
 const root=value as Record<string,unknown>,extra=Array.isArray(root.connections)?root.connections:[];
 const unique=new Map<string,Connection>();for(const item of [value,...extra.slice(0,31)]){const c=connection(item);if(c)unique.set(c.origin,c);}return [...unique.values()];
}
export class Transport{
 readonly config:Connection;
 constructor(config:Connection){this.config=config;}
 async get(route:string){const r=await fetch(new URL(route,this.config.origin),{redirect:'error',headers:{'x-t3-orchestration-protocol':'2',authorization:`Bearer ${this.config.token}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('T3 unavailable');return r.json();}
 async rpc(tag:string,payload:object):Promise<unknown>{
  const r=await fetch(new URL('/api/auth/websocket-ticket',this.config.origin),{method:'POST',redirect:'error',headers:{authorization:`Bearer ${this.config.token}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('T3 session unavailable');
  const ticket=await r.json() as {ticket?:string};if(typeof ticket.ticket!=='string')throw Error('T3 ticket unavailable');
  const url=new URL('/ws',this.config.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('orchestrationProtocol','2');url.searchParams.set('wsTicket',ticket.ticket);
  return new Promise((resolve,reject)=>{const socket=new WebSocket(url),id=randomUUID();let done=false;
   const finish=(error:Error|null,value?:unknown)=>{if(done)return;done=true;clearTimeout(timer);socket.close();error?reject(error):resolve(value)};
   const timer=setTimeout(()=>finish(Error('T3 acknowledgement unavailable')),15000);
   socket.addEventListener('open',()=>socket.send(JSON.stringify({_tag:'Request',id,tag,payload,headers:[]})));
   socket.addEventListener('message',event=>{try{const v=JSON.parse(String(event.data));if(v._tag==='Ping'){socket.send(JSON.stringify({_tag:'Pong'}));return;}if(v._tag==='Exit'&&v.requestId===id){if(v.exit?._tag==='Success')finish(null,v.exit.value);else finish(Error('T3 rejected the request'));}}catch{finish(Error('Invalid T3 acknowledgement'));}});
   socket.addEventListener('error',()=>finish(Error('T3 connection unavailable')));socket.addEventListener('close',()=>{if(!done)finish(Error('T3 acknowledgement unavailable'));});
  });
 }
}
