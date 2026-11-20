import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expect,_electron as electron} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {provider} from './agents/testing/provider.ts';
import type {T3Connection} from '../../electron/settings/t3.ts';

test('Agents pairs multiple computers without exposing credentials, changing sending consent, or requiring an address for full links',{timeout:60000},async t=>{
 const a=await provider(t),b=await provider(t),home=await fs.mkdtemp(path.join(os.tmpdir(),'t3-agents-'));
 const proof=process.env.APPARENT_T3_SETTINGS_PROOF;
 if(proof)await fs.mkdir(proof,{recursive:true});
 const app=await electron.launch({args:[path.resolve(import.meta.dirname,'agents/parent.cjs'),'--settings-storage','--settings-agents','--settings-parent','--no-sandbox','--ozone-platform=x11'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')},...(proof?{recordVideo:{dir:proof,size:{width:920,height:600}}}:{})});
 t.after(async()=>{await app.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 let computers:T3Connection[]=[],buffer='',sending=false;
 app.process().stdout!.on('data',chunk=>{buffer+=String(chunk);let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{
  const action=JSON.parse(line);
  if(action.action==='labs-preference')void app.evaluate((_e,value)=>process.stdin.emit('data',JSON.stringify(value)+'\n'),{type:'labs-result',request:action.request,facts:{saved:false,sharingSaved:false,autoPasteSaved:false,autoPasteSupported:true,wisprSaved:false,wisprSupported:process.platform==='darwin'}});
  if(action.action==='agents-connection'){
   if(action.connection){computers=computers.filter(c=>c.origin!==action.connection.origin);computers.push(action.connection);}
   else computers=computers.filter(c=>c.origin!==action.disconnect);
  }
  if(action.action==='agents-preference'&&action.setting==='t3'&&typeof action.enabled==='boolean')sending=action.enabled;
  if(['agents-preference','agents-connection'].includes(action.action))void app.evaluate((_electron,value)=>process.stdin.emit('data',JSON.stringify(value)+'\n'),{type:'agents-result',request:action.request,facts:{saved:null,t3Saved:sending,t3Configured:computers.length>0,...computers[0]?{t3Origin:computers[0].origin}:{},t3Connections:computers.map(({origin,expiresAt})=>({origin,expiresAt})),autoPasteSupported:true}});
 }catch{}}});
 const page=await app.firstWindow(),session=await page.context().newCDPSession(page);
 const resize=async(width:number)=>{await session.send('Emulation.setDeviceMetricsOverride',{width,height:600,deviceScaleFactor:1,mobile:false});await page.evaluate(()=>document.fonts.ready);};
 const shot=async(name:string)=>{if(proof)await page.screenshot({path:path.join(proof,name+'.png')});};
 const toggle=page.getByRole('switch',{name:'Send recordings to T3 Code'});
 await expect(toggle).toBeEnabled();await expect(page.getByRole('heading',{name:'Agents',exact:true})).toBeVisible();
 await expect(page.getByRole('switch',{name:'Ask for video proof'})).toHaveCount(1);
 await expect(page.getByRole('heading',{name:'Computers'})).toHaveCount(0);
 await toggle.press('Space');
 await expect(toggle).toBeChecked();
 await expect(page.getByText('No computers paired.')).toBeVisible();
 await page.getByRole('button',{name:'Copy setup prompt'}).click();
 await expect(page.getByRole('button',{name:'Copied',exact:true})).toBeVisible();
 assert.match(await app.evaluate(({clipboard})=>clipboard.readText()),/apparent t3 pair.*stdin/);
 for(const p of [a,b]){
  await page.getByRole('button',{name:'Pair with a link',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Authorized clients');
  const address=dialog.getByRole('textbox',{name:'MCP URL or server address'});
  await expect(address).not.toBeVisible();
  await app.evaluate(({clipboard})=>clipboard.writeText('not a pairing link'));
  await dialog.getByRole('button',{name:'Paste link or code',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await shot('invalid-link');
  if(p===b){
   await dialog.getByText('Use a code instead',{exact:true}).click();
   await expect(address).toHaveValue('');
   await address.fill(p.origin+'/mcp');
   await shot('copied-mcp-url');
  }
  await app.evaluate(({clipboard},value)=>clipboard.writeText(value),p===b?p.code:p.link);
  await dialog.getByRole('button',{name:'Paste link or code',exact:true}).click();
  await expect(dialog.locator('.settings-t3-preview')).toContainText(p.origin);assert.equal(p.exchanged,0);
  assert.equal(await page.evaluate(code=>document.body.innerText.includes(code),p.code),false);
  for(const width of [920,640,320])for(const colorScheme of ['light','dark'] as const){
   await resize(width);await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
   await dialog.getByRole('button',{name:'Connect',exact:true}).scrollIntoViewIfNeeded();
   assert.equal(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
   await shot(`preview-${computers.length}-${width}-${colorScheme}`);
  }
  await resize(920);await page.emulateMedia({colorScheme:'light'});
  await dialog.getByRole('button',{name:'Connect',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);assert.equal(p.exchanged,1);
  await expect(toggle).toHaveAttribute('aria-checked','true');
 }
 assert.equal(computers.length,2);
 const rows=await page.locator('.settings-t3-computer').all();assert.ok((await rows[1].boundingBox())!.y>(await rows[0].boundingBox())!.y,'Computers remain distinct rows');
 await page.reload();await expect(page.locator('.settings-t3-computer')).toHaveCount(2);
 for(const width of [920,640,320])for(const colorScheme of ['light','dark'] as const){await resize(width);await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await toggle.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot(`computers-${width}-${colorScheme}`);}
 await resize(920);await page.getByRole('button',{name:`Manage ${new URL(a.origin).host}`,exact:true}).click();await page.getByRole('button',{name:`Disconnect ${new URL(a.origin).host}`,exact:true}).click();await expect(page.locator('.settings-t3-computer')).toHaveCount(1);assert.equal(computers[0].origin,b.origin);
 assert.equal(await page.evaluate(()=>document.body.innerText.includes('private-fixture-token')),false);
 await page.getByRole('button',{name:'Pair with a link',exact:true}).click();await page.getByRole('dialog').getByText('Use a code instead',{exact:true}).click();
 await expect(page.getByRole('textbox',{name:'MCP URL or server address'})).toBeVisible();await expect(page.getByRole('textbox',{name:'MCP URL or server address'})).toHaveValue('');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Pair with a link',exact:true})).toBeFocused();
 await toggle.press('Space');
 await expect(toggle).not.toBeChecked();
 await expect(page.getByRole('heading',{name:'Computers'})).toHaveCount(0);
 await shot('sending-off');
 await session.detach();
});

test('switching panes cancels a queued T3 connection before the private native write and Agents recovers',{timeout:30000},async t=>{
 const p=await provider(t),home=await fs.mkdtemp(path.join(os.tmpdir(),'t3-route-'));
 const app=await electron.launch({args:[path.resolve(import.meta.dirname,'agents/parent.cjs'),'--settings-storage','--settings-agents','--settings-parent','--no-sandbox'],env:{...process.env,HOME:home}});
 t.after(async()=>{await app.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 let buffer='',hold=true,held:number|undefined,writes=0,preferenceWrites=0;
 const send=(value:object)=>app.evaluate((_e,value)=>process.stdin.emit('data',JSON.stringify(value)+'\n'),value);
 const reply=(request:number)=>send({type:'agents-result',request,facts:{saved:null,t3Saved:true,t3Configured:writes>0,autoPasteSupported:true}});
 app.process().stdout!.on('data',chunk=>{buffer+=String(chunk);let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{
  const action=JSON.parse(line);
  if(action.action==='agents-preference'){if(typeof action.enabled==='boolean')preferenceWrites++;if(hold)held=action.request;else void reply(action.request);}
  if(action.action==='agents-connection'){writes++;void reply(action.request);}
 }catch{}}});
 const page=await app.firstWindow();await expect.poll(()=>Boolean(held)).toBe(true);
 await app.evaluate((_e,file)=>{
  const {PreferenceQueue}=process.mainModule!.require(file),run=PreferenceQueue.prototype.run;
  Reflect.set(globalThis,'t3ConnectionQueued',false);
  PreferenceQueue.prototype.run=function(operation:()=>Promise<unknown>,active:()=>boolean,signal?:AbortSignal){if(signal)Reflect.set(globalThis,'t3ConnectionQueued',true);return run.call(this,operation,active,signal);};
 },path.resolve(import.meta.dirname,'../../electron/settings/agents.cjs'));
 await app.evaluate(({clipboard},link)=>clipboard.writeText(link),p.link);
 const preview=await app.evaluate(async({ipcMain,BrowserWindow})=>{
  const sender=BrowserWindow.getAllWindows()[0].webContents;
  return ipcMain._invokeHandlers.get('apparent:agents-t3-preview')!({sender,senderFrame:sender.mainFrame},'http://127.0.0.1:3773');
 });
 const queuedPreference=app.evaluate(async({ipcMain,BrowserWindow})=>{
  const sender=BrowserWindow.getAllWindows()[0].webContents;
  return ipcMain._invokeHandlers.get('apparent:agents-t3-preference')!({sender,senderFrame:sender.mainFrame},true).then(()=>false,()=>true);
 });
 const connecting=app.evaluate(async({ipcMain,BrowserWindow},id)=>{
  const sender=BrowserWindow.getAllWindows()[0].webContents;
  return ipcMain._invokeHandlers.get('apparent:agents-t3-connect')!({sender,senderFrame:sender.mainFrame},id);
 },preview.preview.id);
 await expect.poll(()=>app.evaluate(()=>Reflect.get(globalThis,'t3ConnectionQueued'))).toBe(true);assert.equal(p.exchanged,1);
 hold=false;await send({type:'show',pane:'labs'});
 await expect(page).toHaveTitle('Apparent Settings — Labs');assert.deepEqual(await connecting,{reason:'cancelled'});assert.equal(writes,0);assert.equal(await queuedPreference,true);assert.equal(preferenceWrites,0);
 await reply(held!);await expect(page.getByRole('switch',{name:'Send recordings to T3 Code'})).toHaveCount(0);
 await send({type:'show',pane:'agents'});await expect(page).toHaveTitle('Apparent Settings — Agents');
 await expect(page.getByRole('switch',{name:'Send recordings to T3 Code'})).toBeEnabled();await expect(page.getByRole('alertdialog')).toHaveCount(0);
 p.renew();await page.getByRole('button',{name:'Pair with a link',exact:true}).click();
 await app.evaluate(({clipboard},link)=>clipboard.writeText(link),p.link);
 await page.getByRole('dialog').getByRole('button',{name:'Paste link or code',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Connect',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);assert.equal(writes,1);
});

test('T3 pairing permits loopback and rejects insecure remote addresses', async t => {
 const {fixture}=await import('../pill/t3/testing/server.ts');
 const {pair}=await import('../../../../workflow/t3/pair.ts');
 const f=await fixture(t);
 assert.equal((await pair(f.origin+'/pair?token=one-time')).origin,f.origin);
 await assert.rejects(pair('http://remote.example/pair?token=one-time'),/HTTPS/);
});
