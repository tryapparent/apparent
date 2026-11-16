import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expect,_electron as electron} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {provider} from './agents/testing/provider.ts';
import type {T3Connection} from '../../electron/settings/t3.ts';

test('Labs pairs multiple computers without exposing credentials, changing sending consent, or requiring an address for full links',{timeout:60000},async t=>{
 const a=await provider(t),b=await provider(t),home=await fs.mkdtemp(path.join(os.tmpdir(),'t3-labs-'));
 const proof=process.env.APPARENT_T3_SETTINGS_PROOF;
 if(proof)await fs.mkdir(proof,{recursive:true});
 const app=await electron.launch({args:[path.resolve(import.meta.dirname,'agents/parent.cjs'),'--settings-storage','--settings-labs','--settings-parent','--no-sandbox','--ozone-platform=x11'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')},...(proof?{recordVideo:{dir:proof,size:{width:920,height:600}}}:{})});
 t.after(async()=>{await app.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 let computers:T3Connection[]=[],buffer='',sending=false;
 app.process().stdout!.on('data',chunk=>{buffer+=String(chunk);let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{
  const action=JSON.parse(line);
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
 const toggle=page.getByRole('switch',{name:'Send recordings to T3'});
 await expect(toggle).toBeEnabled();await expect(page.getByRole('heading',{name:'Labs',exact:true})).toBeVisible();
 await expect(page.getByRole('switch',{name:'Ask for video proof'})).toHaveCount(0);
 for(const p of [a,b]){
  await page.getByRole('button',{name:computers.length?'Add computer':'Connect T3',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('all connected computers');
  await expect(dialog.getByRole('textbox',{name:'T3 server address'})).not.toBeVisible();
  await app.evaluate(({clipboard})=>clipboard.writeText('not a pairing link'));
  await dialog.getByRole('button',{name:'Paste T3 link',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await shot('invalid-link');
  await app.evaluate(({clipboard},link)=>clipboard.writeText(link),p.link);
  await dialog.getByRole('button',{name:'Paste T3 link',exact:true}).click();
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
  await expect(toggle).toHaveAttribute('aria-checked','false');
 }
 assert.equal(computers.length,2);
 const rows=await page.locator('.settings-t3-computer').all();assert.ok((await rows[1].boundingBox())!.y>(await rows[0].boundingBox())!.y,'Computers remain distinct rows');
 await page.reload();await expect(page.locator('.settings-t3-computer')).toHaveCount(2);
 for(const width of [920,640,320])for(const colorScheme of ['light','dark'] as const){await resize(width);await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await toggle.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot(`computers-${width}-${colorScheme}`);}
 await resize(920);await page.getByRole('button',{name:`Disconnect ${new URL(a.origin).host}`,exact:true}).click();await expect(page.locator('.settings-t3-computer')).toHaveCount(1);assert.equal(computers[0].origin,b.origin);
 assert.equal(await page.evaluate(()=>document.body.innerText.includes('private-fixture-token')),false);
 await page.getByRole('button',{name:'Add computer',exact:true}).click();await page.getByRole('dialog').getByText('Use a code instead',{exact:true}).click();
 await expect(page.getByRole('textbox',{name:'T3 server address'})).toBeVisible();await expect(page.getByRole('textbox',{name:'T3 server address'})).toHaveValue('http://127.0.0.1:3773');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Add computer',exact:true})).toBeFocused();
 await session.detach();
});
