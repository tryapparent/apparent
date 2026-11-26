// Shared renderer proof only. Native copy/signature behavior is exercised by InstallerTests.swift on Mac.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const {_electron: electron, expect} = require('@playwright/test');
for (const route of ['frog', 'app', 'drag', 'replace', 'reduced', 'delayed-observer']) test(`installer ${route} uses one frog-and-app hop`, {timeout: 30000}, async t => {
  const replace = route === 'replace';
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'apparent-installer-renderer-'));
  let application: any;
  t.after(async () => {try {await application?.close();} finally {await fs.rm(root, {recursive:true,force:true});}});
  const preload = path.join(root,'preload.cjs'), host = path.join(root,'host.cjs');
  await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('apparentInstaller',{action:(action,replace)=>ipcRenderer.invoke('fixture:action',{action,replace})});`);
  await fs.writeFile(host, `
const {app,BrowserWindow,ipcMain}=require('electron');
app.setPath('userData',${JSON.stringify(root)});let calls=[];global.fixtureCalls=calls;
ipcMain.handle('fixture:action',(_event,request)=>{calls.push(request);if(request.action==='status')return {version:'0.1.1',needsReplacement:${replace}};if(request.action==='install')return {installed:true,destination:'/Applications/Apparent Preview.app'};return {opened:true};});
app.whenReady().then(()=>{const window=new BrowserWindow({width:${route==='reduced'?560:720},height:${route==='reduced'?520:560},webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,sandbox:true,nodeIntegration:false}});window.loadFile(${JSON.stringify(path.resolve(import.meta.dirname,'../../dist/src/installer/index.html'))});});
app.on('window-all-closed',()=>app.quit());`);
  application = await electron.launch({args:[host,...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,APPARENT_UI_PROFILE:root}});
  const page = await application.firstWindow();
  await expect(page.getByRole('heading',{name:'Install apparent'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Install apparent in Applications',exact:true})).toBeEnabled();
  assert.equal(await page.getByRole('button',{name:'Install apparent',exact:true}).count(),0,'no duplicate install button');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false,'initial installer fits its real window');
  if(route==='reduced') await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(() => document.fonts.ready);
  if(process.env.APPARENT_INSTALLER_PROOF_DIR) await page.screenshot({path:path.join(process.env.APPARENT_INSTALLER_PROOF_DIR,`${route}-ready.png`)});
  const before = await page.locator('.installer-frog').boundingBox();
  const beforeIcon = await page.locator('.installer-app-icon').boundingBox();
  assert.ok(before.y < beforeIcon.y && before.y+before.height <= beforeIcon.y+20,'frog sits on top of the app');
  assert.ok(Math.abs(before.x+before.width/2-beforeIcon.x-beforeIcon.width/2)<1,'frog is centered on app');
  const pauseStyle = route === 'reduced' ? undefined : await page.addStyleTag({
    content: '.installer-journey[data-hopping=true] .installer-app { animation-play-state: paused; }',
  });
  if(route==='drag') await page.locator('.installer-app').dragTo(page.locator('.installer-applications'));
  else await page.locator(route==='frog'?'.installer-frog':'.installer-app-icon').click();
  if(replace) {
    await expect(page.getByRole('alertdialog',{name:'Replace existing apparent'})).toBeVisible();
    assert.equal((await application.evaluate(()=> (globalThis as any).fixtureCalls)).filter((x:any)=>x.action==='install').length,0);
    await page.getByRole('button',{name:'Replace app',exact:true}).click();
  }
  if (pauseStyle) {
    await expect(page.locator('.installer-journey')).toHaveAttribute('data-hopping','true');
    if(route==='delayed-observer') await application.evaluate(()=>new Promise(resolve=>setTimeout(resolve,1400)));
    assert.equal((await application.evaluate(()=> (globalThis as any).fixtureCalls)).filter((x:any)=>x.action==='install').length,0,'copy waits for the hop');
    const positions = await page.locator('.installer-app').evaluate(async (app: HTMLElement) => {
      const animation = app.getAnimations().find(
        candidate => (candidate as CSSAnimation).animationName === 'installer-hop',
      );
      if (!animation?.effect) throw new Error('Installer did not start the hop animation');
      await animation.ready;
      const duration = Number(animation.effect.getComputedTiming().duration);
      const frogImage = app.querySelector('.installer-frog')!;
      const appImage = app.querySelector('.installer-app-icon')!;
      const checkpoints = [0, 0.25, 0.5, 0.75, 1].map(progress => {
        animation.currentTime = duration * progress;
        const frog = frogImage.getBoundingClientRect();
        const icon = appImage.getBoundingClientRect();
        return {
          frogTop: frog.top,
          iconTop: icon.top,
          aligned: Math.abs(frog.left + frog.width / 2 - icon.left - icon.width / 2) < 1 && frog.top < icon.top,
        };
      });
      animation.currentTime = 0;
      return checkpoints;
    });
    const [start] = positions;
    assert.ok(positions.some(({frogTop,iconTop})=>frogTop<start.frogTop-24 && iconTop<start.iconTop-24),'both frog and app rise in the hop');
    assert.ok(positions.every(({aligned})=>aligned),'frog stays centered above its app at each hop checkpoint');
    await pauseStyle.evaluate((style: HTMLElement) => style.remove());
  }
  await expect(page.getByText('apparent is open.',{exact:true})).toBeVisible();
  await expect(page.locator('.installer-app')).toBeHidden();
  const calls: {action: string; replace: boolean}[] = await application.evaluate(
    () => (globalThis as typeof globalThis & {fixtureCalls: unknown}).fixtureCalls,
  );
  assert.deepEqual(calls.map(call=>call.action),['status','install','open']);
  assert.equal(calls[1].replace,replace);
});
