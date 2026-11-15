import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
export async function provider(context:{after(fn:()=>Promise<void>):void}) {
 let exchanged=0,refused=false;
 const server=createServer(async(request,response)=>{
  response.setHeader('content-type','application/json');
  if(request.url!=='/oauth/token'||request.method!=='POST'){response.writeHead(404);response.end('{}');return;}
  let body='';for await(const chunk of request)body+=chunk;
  const value=new URLSearchParams(body);assert.equal(value.get('grant_type'),'urn:ietf:params:oauth:grant-type:token-exchange');
  assert.equal(value.get('subject_token'),'one-time');assert.equal(value.get('scope'),'orchestration:read orchestration:operate');
  assert.equal(value.get('client_label'),'Apparent');exchanged++;
  if(refused){response.writeHead(403);response.end('{}');return;}
  response.end(JSON.stringify({access_token:'private-fixture-token',token_type:'Bearer',expires_in:3600}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 context.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 return {origin,link:origin+'/pair?token=one-time',get exchanged(){return exchanged;},refuse(){refused=true;}};
}
