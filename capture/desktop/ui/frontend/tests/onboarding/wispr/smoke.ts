import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {_electron,expect} from '@playwright/test';

// Exact built onboarding renderer in Electron; synthetic native facts only.
// No app is terminated and no capture or real permission is requested.
test('Wispr onboarding confirms exit before the dunk, holds the landing, and preserves shortcut setup',{timeout:45000},async t=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  const dir=await mkdtemp(path.join(os.tmpdir(),'wispr-ui-'));
  const preload=path.join(dir,'preload.cjs'),main=path.join(dir,'main.cjs');
  await writeFile(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('nativeOnboarding',{readState:()=>ipcRenderer.invoke('state'),onState:fn=>{const h=(_e,v)=>fn(v);ipcRenderer.on('state',h);return()=>ipcRenderer.removeListener('state',h)},action:a=>ipcRenderer.invoke('action',a),wispr:a=>ipcRenderer.invoke('wispr',a)});`);
  await writeFile(main,`const {app,BrowserWindow,ipcMain}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))});global.state={type:'state',platform:'macos',step:'shortcut',wisprFlowEnabled:true,fix:false,rows:[],ready:true,index:2,count:5,shortcut:'Fn',shortcutChosen:false,shortcutTested:false,shortcutEditing:false,firstCaptureRequired:true,penPicker:false,penSelected:true,penRgb:[122,88,199],testInstance:true};global.outcome='closed';global.quits=0;global.actions=[];ipcMain.handle('state',()=>global.state);ipcMain.handle('action',(_e,a)=>{global.actions.push(a);return true});ipcMain.handle('wispr',(_e,op)=>{if(op==='read')return {status:'running'};global.quits++;return new Promise(r=>global.finish=()=>r({status:global.outcome}))});app.whenReady().then(()=>{global.win=new BrowserWindow({width:760,height:600,frame:false,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,sandbox:true}});global.win.loadURL(${JSON.stringify(pathToFileURL(path.join(root,'dist/onboarding.html')).href)})});`);
  const require=createRequire(import.meta.url);
  const app=await _electron.launch({executablePath:require('electron'),args:[main,...process.platform==='linux'?['--no-sandbox']:[]]});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const page=await app.firstWindow();await page.emulateMedia({colorScheme:'light'});
  const evidence=process.env.ANNOTATION_EVIDENCE;if(evidence)await mkdir(evidence,{recursive:true});
  const shot=async(name:string)=>{if(evidence)await page.screenshot({path:path.join(evidence,`wispr-${name}.png`)});};
  const update=async(fields:object)=>app.evaluate((_electron,values)=>{Object.assign((globalThis as any).state,values);(globalThis as any).win.webContents.send('state',(globalThis as any).state);},fields);
  await expect(page.getByRole('heading',{name:'Wispr, take five.'})).toBeVisible();await shot('ready-light');
  assert.deepEqual(await app.evaluate(()=>(globalThis as any).actions),[],'shortcut listening waits for the Wispr flow');
  await page.emulateMedia({colorScheme:'dark'});await shot('ready-dark');await page.emulateMedia({colorScheme:'light'});
  const quit=page.getByRole('button',{name:'Quit Wispr Flow',exact:true});
  const observeHold=()=>page.evaluate(()=>{const times={landed:0,next:0};(window as any).wisprTimes=times;const observer=new MutationObserver(()=>{if(document.querySelector('.native-wispr-actions button:last-child')?.textContent==='Continue'&&!times.landed)times.landed=performance.now();if(times.landed&&!document.querySelector('.native-wispr')&&!times.next){times.next=performance.now();observer.disconnect();}});observer.observe(document.getElementById('root')!,{subtree:true,childList:true,characterData:true});});
  const assertHold=async()=>{const times=await page.evaluate(()=>(window as any).wisprTimes);assert.ok(times.next-times.landed>=1100,'finished pose holds for 1.2 seconds');};
  await observeHold();
  await quit.focus();await page.keyboard.press('Enter');await expect(quit).toBeDisabled();
  await expect(page.getByText('Waiting for Wispr Flow to close.')).toBeVisible();
  assert.equal(await page.locator('.wispr-frog').getAttribute('data-pose'),'0');
  await page.waitForTimeout(100);assert.equal(await app.evaluate(()=> (globalThis as any).quits),1);
  await app.evaluate(()=> (globalThis as any).finish());
  await expect(page.getByRole('heading',{name:'All yours.'})).toBeVisible();
  await expect.poll(()=>page.locator('.wispr-frog').getAttribute('data-pose')).toBe('3');
  await shot('landing');
  assert.deepEqual(await app.evaluate(()=>(globalThis as any).actions),[],'confirmation hold precedes shortcut listening');
  await expect(page.getByRole('heading',{name:'Choose your shortcut.'})).toBeVisible();await assertHold();
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).actions)).toEqual(['change-shortcut']);
  // Re-enter the actual step, not a second presentation implementation.
  await update({step:'permissions'});await expect(page.getByRole('heading',{name:'We need three things.'})).toBeVisible();await update({step:'shortcut'});
  await expect(quit).toBeEnabled();await quit.click();
  await app.evaluate(()=>{(globalThis as any).outcome='refused';(globalThis as any).finish();});
  await expect(page.getByRole('heading',{name:'Wispr is still open.'})).toBeVisible();await shot('refused');
  assert.equal(await page.locator('.wispr-frog').getAttribute('data-pose'),'0');
  await page.getByRole('button',{name:'Continue anyway'}).click();
  await expect(page.getByRole('heading',{name:'Choose your shortcut.'})).toBeVisible();
  await update({step:'permissions'});await expect(page.getByRole('heading',{name:'We need three things.'})).toBeVisible();await update({step:'shortcut',wisprFlowEnabled:false});
  await expect(page.locator('.native-wispr')).toHaveCount(0);
  await update({wisprFlowEnabled:true});
  for(const theme of ['dark','light'] as const){
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(360,520));
    await expect(quit).toBeVisible();await shot(`narrow-${theme}`);
    assert.equal(await page.locator('.native-setup section').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  }
  await observeHold();await quit.click();await app.evaluate(()=>{(globalThis as any).outcome='closed';(globalThis as any).finish();});
  await expect.poll(()=>page.locator('.wispr-frog').getAttribute('data-pose')).toBe('3');
  await expect(page.getByRole('heading',{name:'Choose your shortcut.'})).toBeVisible();await assertHold();
});
