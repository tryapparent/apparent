import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium, expect, _electron as electron} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {skillCommand} from '../../../src/settings/agents/policy.ts';

test('installed Agents uses acknowledged preferences, fixed clipboard text and bounded navigation', {timeout: 60000}, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-'));
  const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const application = spawn(createRequire(import.meta.url)('electron') as string,
    ['--no-sandbox', frontend, '--settings-storage', '--settings-agents', '--settings-parent', '--remote-debugging-port=0'],
    {env: {...process.env, ELECTRON_RUN_AS_NODE: '', HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache')}, stdio: 'pipe'});
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  const exited = new Promise<void>(resolve => application.once('exit', () => resolve()));
  const actions: Record<string, unknown>[] = [];
  let saved: boolean | null = null;
  let sharingSaved:boolean|null=null;
  let t3Saved:boolean|null=null;
  let autoPasteSaved:boolean|null=null;
  let failWrite = false;
  let holdWrite = false;
  let holdRead = true;
  let held: Record<string, unknown> | undefined;
  const reply = (action: Record<string, unknown>) => {
    if ('enabled' in action && !failWrite) {
      if(action.setting==='sharing')sharingSaved=action.enabled as boolean;else if(action.setting==='t3')t3Saved=action.enabled as boolean;else if(action.setting==='autoPaste')autoPasteSaved=action.enabled as boolean;else saved=action.enabled as boolean;
    }
    application.stdin.write(JSON.stringify({type: 'agents-result', request: action.request,
      facts: failWrite && 'enabled' in action ? {error: 'config_write_failed'} : {saved,sharingSaved,t3Saved,t3Configured:false,autoPasteSaved,autoPasteSupported:process.platform==='linux'}}) + '\n');
  };
  createInterface({input: application.stdout}).on('line', line => {
    try {
      const action = JSON.parse(line); actions.push(action);
      if (action.action === 'navigate' && ['agents','about'].includes(action.pane)) {
        application.stdin.write(JSON.stringify({type:'show',pane:action.pane})+'\n');
        if(action.pane==='about') application.stdin.write(JSON.stringify({type:'about-state',version:'test-build',updates:false,linux:true,mainUpdates:false,updateChannel:'stable',updateCheck:{checking:false,result:null}})+'\n');
      }
      if (action.action === 'agents-preference') {
        if (holdRead || holdWrite && 'enabled' in action) held = action;
        else reply(action);
      }
    } catch {}
  });
  try {
    const debuggerUrl = await new Promise<string>((resolve, reject) => {
      let stderr = '';
      application.stderr.on('data', chunk => {
        stderr += chunk.toString();
        const url = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
        if (url) resolve(url);
      });
      application.once('error', reject);
      application.once('exit', code => reject(Error(`Settings exited (${code}): ${stderr.slice(-1200)}`)));
    });
    browser = await chromium.connectOverCDP(debuggerUrl);
    const page = browser.contexts()[0].pages()[0];
    await expect(page).toHaveTitle('Apparent Settings — Agents');
    assert.equal(await page.evaluate(async()=>await window.apparentGeneral.read().then(()=>false,()=>true) && await window.apparentLabs.read().then(()=>false,()=>true) && await window.apparent!.readConnectSettings().then(()=>false,()=>true)),true);
    const toggle = page.locator('#agent-video-control');
    await expect(toggle).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-busy', 'true');
    await expect.poll(() => Boolean(held)).toBe(true);
    if (process.env.APPARENT_AGENTS_PROOF) {
      await fs.mkdir(process.env.APPARENT_AGENTS_PROOF, {recursive: true});
      await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, 'agents-loading.png')});
    }
    reply(held!); held = undefined; holdRead = false;
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch',{name:'Auto paste',exact:true})).toHaveCount(0);
    await expect(page.getByRole('switch',{name:'Public sharing links',exact:true})).toHaveCount(0);
    await expect(page.getByRole('switch',{name:'Send recordings to T3 Code'})).not.toBeChecked();
    await expect(page.getByRole('button', {name: 'Agents', exact: true})).toHaveAttribute('aria-current', 'page');
    holdWrite = true;
    await toggle.focus(); await page.keyboard.press('Space');
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(toggle).toHaveCSS('cursor','wait');
    await expect(toggle).toHaveCSS('pointer-events','auto');
    assert.equal(await toggle.evaluate(element=>{const r=element.getBoundingClientRect();const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return target===element||element.contains(target);}),true,'Busy switch owns the pointer hotspot');
    await expect.poll(() => Boolean(held)).toBe(true);
    reply(held!); holdWrite = false;
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toBeEnabled();
    const initialGeometry=await page.evaluate(()=>({
      width:innerWidth,height:innerHeight,documentHeight:document.documentElement.scrollHeight,
      shell:document.querySelector('.settings-shell')!.getBoundingClientRect().toJSON(),
      content:[document.querySelector('.settings-content')!.clientHeight,document.querySelector('.settings-content')!.scrollHeight],
      body:{margin:getComputedStyle(document.body).margin,padding:getComputedStyle(document.body).padding},
    }));
    if(process.env.APPARENT_AGENTS_PROOF)await fs.writeFile(path.join(process.env.APPARENT_AGENTS_PROOF,'geometry.json'),JSON.stringify(initialGeometry,null,2));
    assert(initialGeometry.documentHeight<=initialGeometry.height,JSON.stringify(initialGeometry));
    assert(initialGeometry.content[1]<=initialGeometry.content[0],JSON.stringify(initialGeometry));
    if (process.env.APPARENT_AGENTS_PROOF) await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, 'agents-off.png')});
    failWrite = true;
    await toggle.click();
    await expect(page.getByRole('alertdialog')).toContainText('Unable to save');
    await expect(toggle).toBeDisabled();
    const errorDialog=page.getByRole('alertdialog');
    const recover=errorDialog.getByRole('button',{name:'Refresh preference'});
    await expect(recover).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(errorDialog.getByRole('button',{name:'Close',exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(recover).toBeFocused();
    if(process.env.APPARENT_AGENTS_PROOF) await page.screenshot({path:path.join(process.env.APPARENT_AGENTS_PROOF,'agents-save-error.png')});
    failWrite = false;
    await page.getByRole('button', {name: 'Refresh preference'}).click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeFocused();
    // Out-of-band native readback follows external config edits.
    saved = true;
    application.stdin.write(JSON.stringify({type: 'agents-state', facts: {saved}}) + '\n');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', {name: 'Copy install command', exact: true}).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Copied',{exact:true})).toBeVisible();
    await page.evaluate(() => {
      const field = document.createElement('textarea'); field.setAttribute('aria-label', 'Clipboard verification');
      Object.assign(field.style,{position:'fixed',top:'0',left:'0',width:'1px',height:'1px'});
      document.body.append(field); field.focus();
    });
    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByRole('textbox', {name: 'Clipboard verification'})).toHaveValue(skillCommand);
    await page.getByRole('textbox', {name: 'Clipboard verification'}).evaluate(element => element.remove());
    assert.equal(await page.evaluate(async () => {
      for (const call of [() => window.apparentAgents.save('false' as unknown as boolean),
        () => window.apparentAbout.act({action: 'tour'}), () => window.apparent?.resetCaptureLocation()]) {
        try { await call(); return false; } catch {}
      }
      return true;
    }), true, 'Agents cannot send non-boolean preferences or invoke other panes');
    for (const width of [720, 640, 320]) {
      const session = await page.context().newCDPSession(page);
      await session.send('Emulation.setDeviceMetricsOverride',{width,height:530,deviceScaleFactor:1,mobile:false});
      for (const colorScheme of ['light', 'dark', 'light'] as const) {
        await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontSize),'48px');
        assert.equal(await page.locator('#agent-skill-label').evaluate(e=>getComputedStyle(e).fontSize),'24px');
        assert.equal(await page.locator('#agent-video-label').evaluate(e=>getComputedStyle(e).fontSize),'18px');
        assert.equal(await toggle.locator('.apparent-switch-thumb').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
        assert.equal(await toggle.locator('.apparent-switch-track').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(122, 88, 199)');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.locator('.settings-shell').evaluate(element=>element.getBoundingClientRect().top),0,'Settings shell stays fixed while pane scrolls');
        assert.equal(await page.locator('.settings-content').evaluate(element => element.scrollWidth <= element.clientWidth), true);
        assert.equal(await page.locator('.agent-command').evaluate(element => element.scrollWidth <= element.clientWidth), true);
        const contrasts = await page.evaluate(() => {
          const luminance = (color: Uint8ClampedArray) => {
            const channels = [...color].slice(0, 3).map(value => {
              const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
            });
            return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
          };
          return [...document.querySelectorAll('.settings-agents h2, .settings-agents h3, .settings-agents .settings-metadata, .agent-command, .settings-agents button')].filter(element => element.textContent?.trim()).map(element => {
            // Chromium resolves CSS color-mix/oklab and alpha compositing;
            // parsing their numeric components as 8-bit RGB is incorrect.
            const canvas = new OffscreenCanvas(1, 1);
            const context = canvas.getContext('2d')!;
            const ancestors: Element[] = [];
            for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
            for (const ancestor of ancestors) { context.fillStyle = getComputedStyle(ancestor).backgroundColor; context.fillRect(0, 0, 1, 1); }
            const b = luminance(context.getImageData(0, 0, 1, 1).data);
            context.fillStyle = getComputedStyle(element).color; context.fillRect(0, 0, 1, 1);
            const a = luminance(context.getImageData(0, 0, 1, 1).data);
            return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          });
        });
        assert.ok(contrasts.every(value => value >= 4.5), `Text contrast: ${contrasts.join(', ')}`);
        await page.getByRole('button', {name: 'Copy install command', exact: true}).scrollIntoViewIfNeeded();
        if (process.env.APPARENT_AGENTS_PROOF) {
          await fs.mkdir(process.env.APPARENT_AGENTS_PROOF, {recursive: true});
          await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, `agents-${width}-${colorScheme}.png`)});
          await page.locator('.settings-content').evaluate(element=>element.scrollTop=0);
          await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, `agents-${width}-${colorScheme}-top.png`)});
        }
      }
      await session.detach();
    }
    const enlarged = await page.context().newCDPSession(page);
    await enlarged.send('Emulation.setDeviceMetricsOverride',{width:640,height:530,deviceScaleFactor:1,mobile:false});
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    assert.equal(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontSize),'96px');
    assert.equal(await page.locator('.settings-content').evaluate(e=>e.scrollWidth <= e.clientWidth),true,'enlarged text reflows inside the pane');
    for(const colorScheme of ['light','dark'] as const){
      await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
    for (const control of [toggle,page.getByRole('button',{name:'Copy install command',exact:true})]) {
      await control.scrollIntoViewIfNeeded();
      await control.focus();
      await expect(control).toBeFocused();
      assert.equal(await control.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;}),true,'enlarged controls remain reachable');
    }
    if (process.env.APPARENT_AGENTS_PROOF) await page.screenshot({path:path.join(process.env.APPARENT_AGENTS_PROOF,`agents-640-enlarged-text-${colorScheme}.png`)});
    }
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
    await enlarged.detach();
    application.stdin.write(JSON.stringify({type: 'agents-state', facts: {error: 'config_read_failed'}}) + '\n');
    await expect(toggle).toBeDisabled();
    await expect(page.getByRole('alertdialog')).toContainText('Unable to read');
    if (process.env.APPARENT_AGENTS_PROOF) await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, 'agents-read-error.png')});
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    await page.evaluate(()=>{Object.assign(window,{navigationMarker:'same-document'});});
    const originalUrl=page.url();
    await page.getByRole('button', {name: 'About', exact: true}).click();
    await expect.poll(() => actions.some(action => action.action === 'navigate' && action.pane === 'about')).toBe(true);
    await expect(page).toHaveTitle('Apparent Settings — About');
    await expect(page.getByText('Version test-build')).toBeVisible();
    assert.equal(await page.evaluate(async()=>{try{await window.apparentAgents.read();return false;}catch{return true;}}),true,'About refuses Agents capability');
    await page.getByRole('button',{name:'Agents',exact:true}).click();
    await expect(page).toHaveTitle('Apparent Settings — Agents');
    await expect(toggle).toBeEnabled();
    assert.equal(page.url(),originalUrl);
    held=undefined;holdRead=true;
    await page.getByRole('button',{name:'About',exact:true}).click();
    await expect(page).toHaveTitle('Apparent Settings — About');
    await page.getByRole('button',{name:'Agents',exact:true}).click();
    await expect.poll(()=>Boolean(held)).toBe(true);
    await expect(toggle).toBeDisabled();
    const delayedRead=held!;
    await page.getByRole('button',{name:'About',exact:true}).click();
    await expect(page).toHaveTitle('Apparent Settings — About');
    holdRead=false;
    await page.getByRole('button',{name:'Agents',exact:true}).click();
    await expect(toggle).toBeEnabled();
    reply(delayedRead);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>Reflect.get(window,'navigationMarker')),'same-document','Navigation never reloads document');
    await page.getByRole('button',{name:'About',exact:true}).click();
    await expect(page).toHaveTitle('Apparent Settings — About');
    await page.reload();
    await expect(page).toHaveTitle('Apparent Settings — About');
    await expect(page.getByText('Version test-build')).toBeVisible();
    assert.equal(actions.some(action => action.action === 'set'), false);
  } finally {
    await browser?.close().catch(() => {});
    if (application.exitCode === null) { application.kill('SIGTERM'); await exited; }
    await fs.rm(home, {recursive: true, force: true});
  }
});

test('Agents clipboard failures recover and bridge refuses foreign frames or arbitrary text', {timeout: 20000}, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-copy-'));
  const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const application = await electron.launch({args: [frontend, '--settings-storage', '--settings-agents'],
    env: {...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache')}});
  try {
    const page = await application.firstWindow();
    await page.getByRole('button', {name:'Close',exact:true}).click();
    await expect(page.getByRole('button', {name: 'Copy install command', exact: true})).toBeVisible();
    assert.equal(await application.evaluate(async ({ipcMain, BrowserWindow, clipboard}) => {
      const sender = BrowserWindow.getAllWindows()[0].webContents;
      const handler = ipcMain._invokeHandlers.get('apparent:agents-copy-skill');
      for (const [event, args] of [[{sender, senderFrame: {url: sender.getURL()}}, []],
        [{sender, senderFrame: sender.mainFrame}, ['arbitrary text']]] as const) {
        try { await handler(event, ...args); return false; } catch {}
      }
      clipboard.writeText = async () => { throw Error('Synthetic clipboard unavailable'); };
      return true;
    }), true);
    await page.getByRole('button', {name: 'Copy install command', exact: true}).click();
    await expect(page.getByRole('alertdialog').filter({hasText: 'Unable to copy'})).toBeVisible();
    await expect(page.getByText('Copied', {exact: true})).toHaveCount(0);
    await application.evaluate(({clipboard}) => { clipboard.writeText = () => {}; });
    await page.getByRole('button', {name: 'Try again', exact: true}).click();
    await expect(page.getByText('Copied', {exact: true})).toBeVisible();
    await expect(page.getByRole('alertdialog').filter({hasText: 'Unable to copy'})).toHaveCount(0);
  } finally { await application.close(); await fs.rm(home, {recursive: true, force: true}); }
});

test('T3 connection handlers refuse other panes, foreign frames, extra arguments and non-string pairing handles', {timeout:20000}, async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'agents-oauth-guards-'));
  const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  const application=await electron.launch({args:[frontend,'--settings-storage','--settings-about'],
    env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache')}});
  try{
    const page=await application.firstWindow();
    await expect(page.getByRole('heading',{name:'About',exact:true})).toBeVisible();
    assert.equal(await application.evaluate(async({ipcMain,BrowserWindow,shell})=>{
      let opened=0;shell.openExternal=async()=>{opened++;};
      const sender=BrowserWindow.getAllWindows()[0].webContents,event={sender,senderFrame:sender.mainFrame};
      for(const [name,args] of [
        ['apparent:agents-t3-preview',[]],['apparent:agents-t3-connect',['invalid-handle']],['apparent:agents-t3-connect',[true]],
        ['apparent:agents-t3-connect',['http://127.0.0.1:3773','extra']],['apparent:agents-t3-disconnect',[]],['apparent:agents-t3-cancel',[]],
      ] as const){try{await ipcMain._invokeHandlers.get(name)(event,...args);return false;}catch{}}
      try{await ipcMain._invokeHandlers.get('apparent:agents-t3-connect')({sender,senderFrame:{url:sender.getURL()}},'http://127.0.0.1:3773');return false;}catch{}
      return opened===0;
    }),true);
  }finally{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});}
});
