import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';
import {spawn} from 'node:child_process';

const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
async function inspect(url:string,expression:string):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  const socket=new WebSocket(url);
  const timer=setTimeout(()=>{socket.close();reject(Error('Inspector timeout'));},5000);
  socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
  socket.onerror=()=>{clearTimeout(timer);reject(Error('Inspector connection failed'));};
  socket.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.id===1){clearTimeout(timer);socket.close();if(message.result?.exceptionDetails)reject(Error('Inspector evaluation failed'));else resolve(message.result?.result?.value);}};
 });
}
// Production main, preload and renderer against an isolated synthetic socket.
// This is Electron contract evidence, not native capture or live Google proof.
for(const outcome of ['connected','waitlisted','opt-out'] as const)test(`onboarding fast Connect: ${outcome}`,{timeout:30000},async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'connect-onboarding-'));
 const dir=path.join(home,'.config/apparent/agent-control');
 await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.chmod(dir,0o700);
 let phase='disconnected',disableAttempts=0;
 const requests:string[]=[],sockets=new Set<net.Socket>();
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
  let buffer='';socket.on('data',bytes=>{
   buffer+=bytes;
   while(buffer.includes('\n')){
    const end=buffer.indexOf('\n'),request=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
    requests.push(request.command??request.connect);
    if(request.command==='connect')phase='consent';
    if(request.command==='allow')phase='approval';
    if(request.command==='disable'){disableAttempts++;phase=disableAttempts===1&&outcome==='opt-out'?'failed':'disconnected';}
    const buttons=phase==='consent'?[{command:'allow',title:'Allow',enabled:true}]:phase==='disconnected'||phase==='failed'?[{command:'connect',title:'Connect',enabled:true}]:[{command:'open-browser',title:'Open browser',enabled:true}];
    const verificationUri=phase==='approval'?'https://synthetic.example/connect/device?code=ABCDEF123456':null;
    socket.write(JSON.stringify({connect:{title:'apparent',status:'synthetic',detail:'Synthetic cancellation failure',note:'',phase,localReady:phase==='disconnected'||phase==='waitlisted',server:null,userCode:verificationUri?'ABCDEF123456':null,verificationUri,buttons},...(request.command==='open-browser'?{openUri:verificationUri}:{})})+'\n');
   }
  });
 });
 const socketPath=path.join(dir,'capture.sock');await new Promise<void>(r=>server.listen(socketPath,r));await fs.chmod(socketPath,0o600);
 // Onboarding's parent pipe is a real lifetime requirement. Playwright's
 // Electron launcher closes stdin; spawn with the same pipes as Rust instead.
 const child=spawn(require('electron'),['--inspect=0',root,'--onboarding','--remote-debugging-port=0',...(process.platform==='linux'?['--no-sandbox']:[])],{env:{...process.env,HOME:home,APPARENT_UI_PROFILE:path.join(home,'profile')},stdio:['pipe','pipe','pipe']});
 let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined;
 t.after(async()=>{
  if(child.exitCode===null){child.stdin.end('{"type":"close"}\n');const timer=setTimeout(()=>child.kill(),3000);await new Promise(r=>child.once('exit',r));clearTimeout(timer);}
  await browser?.close();for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));await fs.rm(home,{recursive:true,force:true});
 });
 const endpoints=await new Promise<{node:string;browser:string}>((resolve,reject)=>{
  let log='';const timer=setTimeout(()=>reject(Error('No inspector endpoints: '+log)),10000);
  child.on('error',reject);child.stderr.on('data',bytes=>{log+=bytes;const node=log.match(/Debugger listening on (ws:\/\/[^\s]+)/),web=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(node&&web){clearTimeout(timer);resolve({node:node[1],browser:web[1]});}});
 });
 await inspect(endpoints.node,"global.opened=[];process.mainModule.require('electron').shell.openExternal=async uri=>{global.opened.push(uri);};true");
 browser=await chromium.connectOverCDP(endpoints.browser);
 const page=browser.contexts()[0].pages()[0];
 let output='';child.stdout.on('data',bytes=>output+=bytes);
 child.stdin.write(JSON.stringify({type:'state',step:'welcome',rows:[],ready:true,index:0,count:5,platform:'linux',testInstance:true})+'\n');
 await page.getByRole('button',{name:'Up in the cloud',exact:true}).click();
 await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
 assert.equal(requests.includes('allow'),false);
 await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
 await expect.poll(()=>inspect(endpoints.node,'global.opened.length')).toBe(1);
 assert.deepEqual(requests.filter(r=>['connect','allow','open-browser'].includes(r)),['connect','allow','open-browser']);
 assert(!output.includes('"action":"continue"'));
 if(outcome==='opt-out'){
  await page.getByRole('button',{name:'Keep it local',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry cancellation',exact:true})).toBeVisible();
  assert(!output.includes('"action":"continue"'));
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).click();
  await expect.poll(()=>disableAttempts).toBe(2);
 }else if(outcome==='waitlisted'){
  phase='waitlisted';await expect(page.getByText(/You’re on the Connect waitlist/)).toBeVisible();
  assert(!output.includes('"action":"continue"'));
  await page.getByRole('button',{name:'Continue locally',exact:true}).click();
 }else phase='connected';
 await expect.poll(()=>output).toContain('"action":"continue"');
 assert.equal(requests.filter(r=>r==='allow').length,1);
 child.stdin.write(JSON.stringify({type:'state',step:'welcome',rows:[],ready:true,index:0,count:5,penPicker:true})+'\n');
 await expect(page.getByRole('heading',{name:'Pick your pen.',exact:true})).toBeVisible();
});
