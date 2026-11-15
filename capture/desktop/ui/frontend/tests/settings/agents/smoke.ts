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
import {skillCommand} from '../../../src/agents/policy.ts';
import {provider} from './testing/provider.ts';

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
  let t3Saved:boolean|null=null;
  let autoPasteSaved:boolean|null=null;
  let failWrite = false;
  let holdWrite = false;
  let holdRead = true;
  let held: Record<string, unknown> | undefined;
  const reply = (action: Record<string, unknown>) => {
    if ('enabled' in action && !failWrite) {
      if(action.setting==='t3')t3Saved=action.enabled as boolean;else if(action.setting==='autoPaste')autoPasteSaved=action.enabled as boolean;else saved=action.enabled as boolean;
    }
    application.stdin.write(JSON.stringify({type: 'agents-result', request: action.request,
      facts: failWrite && 'enabled' in action ? {error: 'config_write_failed'} : {saved,t3Saved,t3Configured:false,autoPasteSaved,autoPasteSupported:process.platform==='linux'}}) + '\n');
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
    const toggle = page.getByRole('switch', {name: 'Ask for video proof'});
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('aria-busy', 'true');
    await expect.poll(() => Boolean(held)).toBe(true);
    if (process.env.APPARENT_AGENTS_PROOF) {
      await fs.mkdir(process.env.APPARENT_AGENTS_PROOF, {recursive: true});
      await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, 'agents-loading.png')});
    }
    reply(held!); held = undefined; holdRead = false;
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const autoToggle=page.getByRole('switch',{name:'Auto paste',exact:true});
    await expect(autoToggle).toHaveAttribute('aria-checked','false');
    if(process.platform==='linux') {
      failWrite=true; await autoToggle.click();
      await expect(page.getByRole('alertdialog')).toContainText('Unable to save');
      await expect(autoToggle).toBeDisabled(); failWrite=false;
      await page.getByRole('button',{name:'Refresh preference'}).click();
      await expect(autoToggle).toBeEnabled();
      await autoToggle.focus(); await page.keyboard.press('Space');
      await expect(autoToggle).toHaveAttribute('aria-checked','true');
      assert.equal(actions.at(-1)?.setting,'autoPaste'); assert.equal(saved,null);
      if(process.env.APPARENT_AGENTS_PROOF) await page.screenshot({path:path.join(process.env.APPARENT_AGENTS_PROOF,'auto-paste-on.png')});
      await autoToggle.click(); await expect(autoToggle).toHaveAttribute('aria-checked','false');
    } else await expect(autoToggle).toBeDisabled();
    const t3Toggle=page.getByRole('switch',{name:'Send recordings to T3'});
    await expect(t3Toggle).toHaveAttribute('aria-checked','false');
    await t3Toggle.click();await expect(t3Toggle).toHaveAttribute('aria-checked','true');
    assert.equal(saved,null);assert.equal(actions.at(-1)?.setting,'t3');
    await expect(page.getByRole('button',{name:'Connect T3',exact:true})).toBeVisible();
    await expect(page.getByText('apparent t3 pair',{exact:false})).toHaveCount(0);
    await t3Toggle.click();await expect(t3Toggle).toHaveAttribute('aria-checked','false');
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
    assert.equal(await page.locator('.settings-content').evaluate(el=>getComputedStyle(el).overflowY),'auto');
    await page.getByRole('heading',{name:'Labs',exact:true}).scrollIntoViewIfNeeded();
    await expect(page.getByRole('heading',{name:'Labs',exact:true})).toBeInViewport();
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
        await page.getByRole('heading', {name:'Labs', exact:true}).scrollIntoViewIfNeeded();
        if (process.env.APPARENT_AGENTS_PROOF) {
          await fs.mkdir(process.env.APPARENT_AGENTS_PROOF, {recursive: true});
          await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, `agents-${width}-${colorScheme}.png`)});
          await page.locator('.settings-content').evaluate(element=>element.scrollTop=0);
          await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, `agents-${width}-${colorScheme}-top.png`)});
        }
      }
      await session.detach();
    }
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

test('guided pairing previews the clipboard destination, exchanges once and waits for native acknowledgement without enabling sending', {timeout:60000}, async context=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'agents-pair-'));
  const p=await provider(context),frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  const application=await electron.launch({args:[path.join(frontend,'tests/settings/agents/parent.cjs'),'--settings-storage','--settings-agents','--settings-parent'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache')}});
  let connection:{origin:string;token:string;expiresAt:number}|null=null,buffer='';
  const facts=()=>({saved:null,t3Saved:null,t3Configured:!!connection,...connection?{t3Origin:connection.origin,t3ExpiresAt:connection.expiresAt}:{}});
  const reply=(request:number)=>application.evaluate((_electron,value)=>process.stdin.emit('data',JSON.stringify(value)+'\n'),{type:'agents-result',request,facts:facts()});
  application.process().stdout!.on('data',chunk=>{buffer+=String(chunk);let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const action=JSON.parse(line);if(action.action==='agents-connection')connection=action.connection;if(action.action==='agents-preference'||action.action==='agents-connection')void reply(action.request);}catch{}}});
  try{
    const page=await application.firstWindow();await reply(1);
    const toggle=page.getByRole('switch',{name:'Send recordings to T3'});await expect(toggle).toBeEnabled();
    if(process.env.APPARENT_AGENTS_PROOF)for(const colorScheme of ['light','dark'] as const){
      await page.emulateMedia({colorScheme});await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(640,530));
      await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(640);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),530,'the content pane owns scrolling');
      await fs.writeFile(path.join(process.env.APPARENT_AGENTS_PROOF,'minimum-geometry.json'),JSON.stringify(await page.evaluate(()=>({width:innerWidth,height:innerHeight,all:[document.documentElement,document.body,document.getElementById('root'),...document.querySelectorAll('.settings-shell,.settings-content,.settings-sidebar')].map(el=>({name:el!.tagName+'.'+el!.className,scroll:el!.scrollHeight,client:el!.clientHeight,rect:el!.getBoundingClientRect().toJSON(),overflow:getComputedStyle(el!).overflow,height:getComputedStyle(el!).height}))})),null,2));
      await page.locator('.settings-content').evaluate(element=>element.scrollTop=0);
      await page.screenshot({path:path.join(process.env.APPARENT_AGENTS_PROOF,'agents-native-min-'+colorScheme+'.png')});
      await page.getByRole('button',{name:'Copy install command',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(process.env.APPARENT_AGENTS_PROOF,'agents-native-min-bottom-'+colorScheme+'.png')});
    }
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(920,600));
    await page.getByRole('button',{name:'Connect T3',exact:true}).click();
    const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Sharing & access');
    if(process.env.APPARENT_AGENTS_PROOF)for(const width of [920,640])for(const colorScheme of ['light','dark'] as const){
      await application.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,width===640?530:600),width);
      await page.emulateMedia({colorScheme});await dialog.evaluate(element=>element.scrollTop=0);
      await page.screenshot({path:path.join(process.env.APPARENT_AGENTS_PROOF,`pairing-guide-${width}-${colorScheme}.png`)});
    }
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(920,600));
    await page.getByRole('button',{name:'Paste pairing link',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Copy a full pairing link');
    await application.evaluate(({clipboard},value)=>clipboard.writeText(value),p.link);
    assert.equal(await application.evaluate(({clipboard})=>clipboard.readText()),p.link);
    await page.getByRole('button',{name:'Paste pairing link',exact:true}).click();await expect(dialog).toContainText(p.origin);assert.equal(p.exchanged,0);
    // A changed clipboard cannot change the previewed destination at confirmation.
    await application.evaluate(({clipboard})=>clipboard.writeText('https://unexpected.example/pair?token=secret'));
    assert.equal(await page.evaluate(()=>document.body.innerText.includes('one-time')),false);
    await dialog.getByRole('button',{name:'Connect',exact:true}).click();
    await expect(page.getByText(`Connected to ${new URL(p.origin).host}`,{exact:true})).toBeVisible();assert.equal(p.exchanged,1);assert.equal(connection!.token,'private-fixture-token');await expect(toggle).toHaveAttribute('aria-checked','false');
    assert.equal(await page.evaluate(()=>document.body.innerText.includes('private-fixture-token')),false);
    await page.reload();await expect(page.getByText(`Connected to ${new URL(p.origin).host}`,{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Disconnect',exact:true}).click();await expect(page.getByRole('button',{name:'Connect T3',exact:true})).toBeEnabled();assert.equal(connection,null);
    await page.getByRole('button',{name:'Connect T3',exact:true}).click();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);assert.equal(p.exchanged,1);
    // A trusted route change invalidates pending consent without recreating the window.
    await page.getByRole('button',{name:'Connect T3',exact:true}).click();
    await application.evaluate(({clipboard},value)=>clipboard.writeText(value),p.link);
    await page.getByRole('button',{name:'Paste pairing link',exact:true}).click();
    await expect(dialog).toContainText(p.origin);
    await page.evaluate(()=>Reflect.set(window,'pairingRouteMarker',true));
    const show=(pane:string)=>application.evaluate((_electron,pane)=>process.stdin.emit('data',JSON.stringify({type:'show',pane})+'\n'),pane);
    await show('about');await expect(page).toHaveTitle('Apparent Settings — About');
    await show('agents');await expect(page).toHaveTitle('Apparent Settings — Agents');
    await expect(toggle).toBeEnabled();await expect(dialog).toHaveCount(0);
    assert.equal(await page.evaluate(()=>Reflect.get(window,'pairingRouteMarker')),true);
    assert.equal(p.exchanged,1,'Leaving Agents never exchanges the unconfirmed preview');
  }finally{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});}
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
