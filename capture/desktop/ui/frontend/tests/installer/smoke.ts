// Shared renderer proof only. Native copy/signature behavior is exercised by InstallerTests.swift on Mac.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const {_electron: electron, expect} = require('@playwright/test');
for (const replace of [false, true]) test(`installer ${replace ? 'confirms replacement' : 'drag installs'} with rendered frog completion`, {timeout: 30000}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'apparent-installer-renderer-'));
  let application: any;
  t.after(async () => {try {await application?.close();} finally {await fs.rm(root, {recursive:true,force:true});}});
  const preload = path.join(root,'preload.cjs'), host = path.join(root,'host.cjs');
  await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('apparentInstaller',{action:(action,replace)=>ipcRenderer.invoke('fixture:action',{action,replace})});`);
  await fs.writeFile(host, `
const {app,BrowserWindow,ipcMain}=require('electron');
app.setPath('userData',${JSON.stringify(root)});let calls=[];global.fixtureCalls=calls;
ipcMain.handle('fixture:action',(_event,request)=>{calls.push(request);if(request.action==='status')return {version:'0.1.1',needsReplacement:${replace}};if(request.action==='install')return {installed:true,destination:'/Applications/Apparent Preview.app'};return {opened:true};});
app.whenReady().then(()=>{const window=new BrowserWindow({width:720,height:600,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,sandbox:true,nodeIntegration:false}});window.loadFile(${JSON.stringify(path.resolve(import.meta.dirname,'../../dist/src/installer/index.html'))});});
app.on('window-all-closed',()=>app.quit());`);
  application = await electron.launch({args:[host,...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,APPARENT_UI_PROFILE:root}});
  const page = await application.firstWindow();
  await expect(page.getByRole('heading',{name:'A little hop to Applications.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Install apparent',exact:true})).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  const before = await page.locator('.installer-frog img').boundingBox();
  if(replace) await page.getByRole('button',{name:'Install apparent in Applications',exact:true}).click();
  else await page.locator('.installer-app').dragTo(page.locator('.installer-applications'));
  if(replace) {
    await expect(page.getByRole('alertdialog',{name:'Replace existing apparent'})).toBeVisible();
    assert.equal((await application.evaluate(()=> (globalThis as any).fixtureCalls)).filter((x:any)=>x.action==='install').length,0);
    await page.getByRole('button',{name:'Replace app',exact:true}).click();
  }
  await expect(page.locator('.installer-journey')).toHaveAttribute('data-hopping','true');
  const min = await page.locator('.installer-frog img').evaluate((img:HTMLElement)=>new Promise<number>(resolve=>{
    const started=performance.now();let top=img.getBoundingClientRect().top;
    function frame(){top=Math.min(top,img.getBoundingClientRect().top);if(performance.now()-started<800)requestAnimationFrame(frame);else resolve(top);}requestAnimationFrame(frame);
  }));
  assert.ok(min<before.y-24,'the frog must rise visibly before the real install request');
  await expect(page.getByRole('button',{name:'Open apparent',exact:true})).toBeVisible();
  const installs = (await application.evaluate(()=> (globalThis as any).fixtureCalls)).filter((x:any)=>x.action==='install');
  assert.equal(installs.length,1);assert.equal(installs[0].replace,replace);
});
