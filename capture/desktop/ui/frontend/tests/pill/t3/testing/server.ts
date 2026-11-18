import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
const require=createRequire(import.meta.url);
const {wsServer:WebSocketServer}=require(path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));
export async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const home=await mkdtemp(path.join(os.tmpdir(),'t3-picker-')),config=path.join(home,'config.json');
 let reads=0,loseReply=false,envMode='root',many=false,empty=false,projectName='Project',computerName:unknown=undefined;const calls:{tag:string;payload:Record<string,unknown>}[]=[],accepted=new Set<string>();
 const server=createServer((req,res)=>{
  if(req.url==='/oauth/token'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{assert.equal(new URLSearchParams(body).get('subject_token'),'one-time');res.setHeader('content-type','application/json');res.end(JSON.stringify({access_token:'private-test-token',token_type:'Bearer',expires_in:3600}));});return;}
  assert.equal(req.headers.authorization,'Bearer private-test-token');res.setHeader('content-type','application/json');
  if(req.url?.startsWith('/api/orchestration/shell')){reads++;assert.equal(req.headers['x-t3-orchestration-protocol'],'2');res.end(JSON.stringify({projects:[{id:'p',title:projectName,workspaceRoot:'/synthetic/project',defaultModelSelection:{instanceId:'fixture',model:'project-default'}}],threads:empty?[]:[{id:'thread',projectId:'p',title:'Chosen thread',createdAt:'2026-01-01',updatedAt:'2026-01-01',status:'running'},...(many?[{id:'review',projectId:'p',title:'Review recording handoff defaults',createdAt:'2025-12-01'},{id:'capture',projectId:'p',title:'Polish capture controls',createdAt:'2025-11-01'},{id:'snoozed',projectId:'p',title:'Tomorrow’s cleanup',createdAt:'2025-10-01',snoozedUntil:'2099-01-01'}]:[]),{id:'settled',projectId:'p',title:'Hidden',createdAt:'2026-01-01',updatedAt:'2026-01-01',settledOverride:'settled'}]}));}
  else if(req.url==='/api/auth/websocket-ticket')res.end(JSON.stringify({ticket:'one-use-ticket'}));else{res.statusCode=404;res.end('{}');}
 });
 const sockets=new WebSocketServer({server});sockets.on('connection',(socket:any,req:any)=>{assert.equal(new URL(req.url,'http://localhost').searchParams.get('orchestrationProtocol'),'2');socket.on('message',(bytes:Buffer)=>{const message=JSON.parse(bytes.toString());if(message._tag!=='Request')return;const {tag,payload}=message;let value:object={};
  if(tag==='server.getConfig')value={...computerName===undefined?{}:{environment:{environmentId:'fixture-environment',label:computerName,platform:'linux',serverVersion:'1.0.0',capabilities:{}}},settings:{defaultModelSelection:{instanceId:'fixture',model:'environment-default'},defaultRuntimeMode:'auto-accept-edits',defaultThreadEnvMode:envMode}};
  else if(tag==='vcs.listRefs')value={isRepo:true,hasPrimaryRemote:true,refs:[{name:'origin/main',isDefault:true,isRemote:true}]};
  else{calls.push({tag,payload});accepted.add(payload.commandId);if(loseReply){loseReply=false;socket.close();return;}value={threadId:payload.threadId};}
  socket.send(JSON.stringify({_tag:'Exit',requestId:message.id,exit:{_tag:'Success',value}}));
 });});
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const save=async(enabled?:boolean)=>writeFile(config,JSON.stringify({secret:'unrelated',t3:{origin,token:'private-test-token',expiresAt:Date.now()+3600000},...(enabled===undefined?{}:{experiments:{t3DestinationPicker:enabled}})}),{mode:0o600});await save(true);
 t.after(async()=>{sockets.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(home,{recursive:true,force:true});});
 return {config,home,origin,save,calls,accepted,get reads(){return reads;},lose:()=>loseReply=true,worktree:()=>envMode='worktree',many:()=>many=true,empty:()=>empty=true,label:(name:string)=>projectName=name,computer:(name:unknown)=>computerName=name};
}
