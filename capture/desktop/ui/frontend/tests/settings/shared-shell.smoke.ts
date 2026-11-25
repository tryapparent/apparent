import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium, _electron as electron, expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function generalState(platform:'linux'|'macos',recording=false,label='F1',on=false,error:string|null=null){
  return {type:'general-state',platform,login:{on,available:true,needsApproval:false},shortcuts:[{kind:'record',title:'Record',label,recording,externallyManaged:false,isDefault:platform==='linux'||label==='Fn',clearable:false,suggestedFn:platform==='macos'?{keyCode:63,modifiers:0,key:'Fn'}:null,error}],errorReporting:true};
}

test('Settings changes adopted panes in one live document and enforces the current capabilities', {timeout:120000}, async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'shell-'));
  const child=spawn(createRequire(import.meta.url)('electron'),['--no-sandbox',path.resolve(import.meta.dirname,'../..'),'--settings-storage','--settings-general','--settings-parent','--remote-debugging-port=0'],
    {env:{...process.env,ELECTRON_RUN_AS_NODE:'',HOME:home,XDG_CONFIG_HOME:path.join(home,'config')},stdio:'pipe'});
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  const send=(message:object)=>child.stdin!.write(JSON.stringify(message)+'\n');
  const actions:Record<string,unknown>[]=[];
  let holdLabs=false,heldLabs:Record<string,unknown>|undefined;
  createInterface({input:child.stdout!}).on('line',line=>{
    const action=JSON.parse(line);actions.push(action);
    if(action.action==='navigate') {
      send({type:'show',pane:action.pane});
      if(action.pane==='general')send(generalState('linux'));
      if(action.pane==='about')send({type:'about-state',version:'shell-test',updates:false,linux:true,mainUpdates:false,updateChannel:'stable',updateCheck:{checking:false,result:null}});
    }
    if(action.action==='labs-preference'){if(holdLabs)heldLabs=action;else send({type:'labs-result',request:action.request,facts:{saved:false,sharingSaved:false,autoPasteSaved:false,autoPasteSupported:process.platform==='linux',wisprSaved:false,wisprSupported:process.platform==='darwin'}});}
    if(action.action==='agents-preference')send({type:'agents-result',request:action.request,facts:{t3Saved:false,t3Configured:false}});
  });
  let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined;
  try {
    const endpoint=await new Promise<string>((resolve,reject)=>{
      let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);const match=stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);if(match)resolve(match[1]);});
      child.once('error',reject);child.once('exit',code=>reject(Error(`Settings exited ${code}: ${stderr.slice(-1000)}`)));
    });
    browser=await chromium.connectOverCDP(endpoint);
    const context=browser.contexts()[0],page=context.pages()[0];
    await expect(page).toHaveTitle('Apparent Settings — General');
    await page.evaluate(()=>Object.assign(window,{shellIdentity:'same document'}));
    let loads=0;page.on('load',()=>loads++);
    const originalUrl=page.url();
    async function openPane(pane:string){
      if(await page.locator('.settings-navigation-compact').isVisible())await page.getByRole('button',{name:/^Settings pages,/}).click();
      const target=page.getByRole('button',{name:pane,exact:true});await target.focus();await page.keyboard.press('Enter');
      return page.locator('.settings-navigation-wide').isVisible().then(wide=>wide?target:page.getByRole('button',{name:`Settings pages, ${pane}`,exact:true}));
    }
    const session=await context.newCDPSession(page);
    for(const width of [720,640,320])for(const colorScheme of ['light','dark'] as const){
      await session.send('Emulation.setDeviceMetricsOverride',{width,height:width===320?265:530,deviceScaleFactor:1,mobile:false});
      await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
      for(const pane of ['Labs','Recording','Agents','Storage','About','Storage','General','Labs','About','Agents','General']){
        const nav=await openPane(pane);
        await expect(page).toHaveTitle(`Apparent Settings — ${pane}`);
        await expect(page.locator('.settings-navigation-wide').getByRole('button',{name:pane,exact:true,includeHidden:true})).toHaveAttribute('aria-current','page');
        assert.equal(page.url(),originalUrl);
        assert.equal(context.pages().length,1);
        assert.equal(await page.evaluate(()=>Reflect.get(window,'shellIdentity')),'same document');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        assert.equal(await page.evaluate(async(current)=>{
          const calls:Record<string,()=>Promise<unknown>>={General:()=>window.apparentGeneral.act({action:'set',key:'errorReporting',value:false}),Labs:()=>window.apparentLabs.save(false,'sharing'),Agents:()=>window.apparentAgents.saveT3(false),About:()=>window.apparentAbout.act({action:'tour'}),Storage:()=>window.apparent!.resetCaptureLocation()};
          for(const [owner,call] of Object.entries(calls)){if(owner===current)continue;try{await call();return false;}catch{}}
          return true;
        },pane),true,'inactive pane mutations are rejected');
        await expect(page.locator('h1')).toHaveText(pane);
        if(pane==='General')await expect(page.getByRole('switch',{name:'Launch at login'})).toBeVisible();
        if(width===320){
          const last=page.locator('main').locator('button:enabled:visible,select:enabled:visible,a[href]:visible').last();
          if(await last.count()){await last.focus();await expect(last).toBeInViewport();}
          await nav.focus();await expect(nav).toBeInViewport();
          await page.locator('.settings-shell').evaluate(el=>el.scrollTop=0);
        }
        if(process.env.APPARENT_SHELL_PROOF){await fs.mkdir(process.env.APPARENT_SHELL_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_SHELL_PROOF,`${pane}-${width}-${colorScheme}.png`)});}
      }
    }
    await openPane('Labs');
    const streaming=page.getByRole('switch',{name:'Live local transcription'});
    await expect(streaming).toBeEnabled();holdLabs=true;await streaming.click();
    await expect.poll(()=>heldLabs?.enabled).toBe(true);await expect(streaming).toBeDisabled();
    await openPane('General');await expect(page).toHaveTitle('Apparent Settings — General');
    send({type:'labs-result',request:heldLabs!.request,facts:{saved:true}});holdLabs=false;
    await openPane('Labs');
    await expect(streaming).toBeEnabled();await expect(streaming).toHaveAttribute('aria-checked','false');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>Reflect.get(window,'shellIdentity')),'same document');
    assert.equal(loads,0,'navigation never reloads Chromium');
    await openPane('General');
    await expect(page.getByRole('switch',{name:'Launch at login'})).toBeVisible();
    const macShortcut=(recording:boolean,label='Fn')=>send(generalState('macos',recording,label));
    const optionCount=()=>actions.filter(a=>a.action==='shortcut'&&a.key==='Option').length;
    for(const side of ['AltLeft','AltRight']){
      macShortcut(true);
      await expect(page.getByRole('button',{name:'Use Fn',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Cancel changing Record shortcut',exact:true}).focus();
      assert.equal(await page.getByRole('button',{name:'Change Record shortcut, currently Option',exact:true}).count(),0,'Option is not suggested');
      const before=optionCount();
      await page.keyboard.down(side);assert.equal(optionCount(),before);
      await page.keyboard.up(side);await expect.poll(optionCount).toBe(before+1);
      assert.deepEqual(actions.filter(a=>a.action==='shortcut'&&a.key==='Option').at(-1),{action:'shortcut',kind:'record',keyCode:58,modifiers:0,key:'Option',reserved:false});
      macShortcut(false,'Option');await expect(page.getByRole('button',{name:'Change Record shortcut, currently Option',exact:true})).toBeVisible();
    }
    macShortcut(true);
    const fnChoice=page.getByRole('button',{name:'Use Fn',exact:true});
    await fnChoice.focus();const beforeControl=optionCount();
    await page.keyboard.down('Alt');await page.keyboard.up('Alt');
    await page.waitForTimeout(100);assert.equal(optionCount(),beforeControl,'Fn suggestion is not the shortcut recorder');
    await fnChoice.press('Enter');
    await expect.poll(()=>actions.some(a=>a.action==='shortcut'&&a.key==='Fn'&&a.keyCode===63)).toBe(true);
    macShortcut(false,'Fn');await expect(page.getByRole('button',{name:'Change Record shortcut, currently Fn',exact:true})).toBeVisible();
    macShortcut(true);
    await page.getByRole('button',{name:'Cancel changing Record shortcut',exact:true}).focus();
    const cleanCount=optionCount();
    await page.keyboard.down('Alt');await page.keyboard.press('r');await page.keyboard.up('Alt');
    await expect.poll(()=>actions.some(a=>a.action==='shortcut'&&a.key==='r'&&a.modifiers===2048)).toBe(true);
    macShortcut(false,'r');await expect(page.getByRole('button',{name:'Change Record shortcut, currently r',exact:true})).toBeVisible();macShortcut(true);
    await page.keyboard.down('Alt');await page.keyboard.down('Shift');await page.keyboard.up('Shift');await page.keyboard.up('Alt');
    await page.keyboard.down('Alt');await page.mouse.wheel(0,120);await page.keyboard.up('Alt');
    await page.locator('h1').scrollIntoViewIfNeeded();
    const heading=await page.locator('h1').boundingBox();assert.ok(heading);
    await page.mouse.move(heading.x+5,heading.y+5);await page.mouse.down();
    await page.keyboard.down('Alt');await page.keyboard.up('Alt');await page.mouse.up();
    await page.keyboard.down('Alt');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Alt');
    await expect.poll(()=>actions.some(a=>a.action==='cancel-shortcut')).toBe(true);
    assert.equal(optionCount(),cleanCount,'chords, mixed modifiers, clicks and blur do not select Option');
    macShortcut(false,'Option');
    const selected=page.getByRole('button',{name:'Change Record shortcut, currently Option',exact:true});
    await expect(selected).toBeVisible();await selected.focus();await expect(selected).toBeFocused();
    await openPane('Storage');
    await expect(page).toHaveTitle('Apparent Settings — Storage');
    assert.equal(await page.evaluate(()=>typeof window.apparent?.readCaptureLocation),'function');
    assert.equal(await page.evaluate(async()=>{try{await window.apparent!.showCaptureFolder();return true;}catch{return false;}}),true);
    await expect.poll(()=>actions.at(-1)?.action).toBe('show-captures');
    await openPane('Permissions');
    await expect.poll(()=>actions.at(-1)?.pane).toBe('permissions');
  } finally {
    await browser?.close().catch(()=>{});child.stdin.end();
    await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))]);
    if(child.exitCode===null)child.kill('SIGKILL');
    await fs.rm(home,{recursive:true,force:true});
  }
});

test('General waits for parent confirmation and keeps recovery keyboard input outside shortcut capture',{timeout:30000},async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'general-recovery-'));
  const application=await electron.launch({args:['--no-sandbox',path.resolve(import.meta.dirname,'../..'),'--settings-storage','--settings-general'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:home+'/config'}});
  const page=await application.firstWindow();let recoveryOutput='';application.process().stdout!.on('data',data=>recoveryOutput+=String(data));
  async function projectGeneral(loginOn=false,recording=false,label='Ctrl+R',error:string|null=null){
    await page.locator('.general-settings').waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await application.evaluate(({BrowserWindow},state)=>BrowserWindow.getAllWindows()[0].webContents.send('apparent:general-state',state),generalState('linux',recording,label,loginOn,error));
  }
  try {
  await application.evaluate(({ipcMain})=>{
    global.generalActionHandler=ipcMain._invokeHandlers.get('apparent:general-action');global.generalRefusals=0;
    ipcMain.removeHandler('apparent:general-action');ipcMain.handle('apparent:general-action',()=>{global.generalRefusals++;throw Error('Synthetic sender refusal')});
  });
  await projectGeneral(false,true);
  const listening=page.getByRole('button',{name:'Cancel changing Record shortcut',exact:true});
  await listening.focus();await page.keyboard.press('F7');
  const shortcutFailure=page.getByRole('alertdialog',{name:/^(Couldn’t change record shortcut|Record shortcut not confirmed)$/});
  await expect(shortcutFailure).toHaveAccessibleName('Couldn’t change record shortcut');
  await expect(shortcutFailure).toBeVisible();await page.keyboard.press('Tab');
  await expect(shortcutFailure.getByRole('button',{name:'Close',exact:true})).toBeFocused();
  await page.keyboard.press('Enter');await expect(shortcutFailure).not.toBeVisible();
  assert.equal(await application.evaluate(()=>global.generalRefusals),1,'Tab and Enter belong to modal recovery');
  await listening.focus();await page.keyboard.press('F8');await expect(shortcutFailure).toBeVisible();
  await page.keyboard.press('Escape');await expect(shortcutFailure).not.toBeVisible();await expect(listening).toBeFocused();
  assert.equal(await application.evaluate(()=>global.generalRefusals),2,'Escape dismisses the modal without submitting a shortcut');
  await application.evaluate(({ipcMain})=>{ipcMain.removeHandler('apparent:general-action');ipcMain.handle('apparent:general-action',global.generalActionHandler);delete global.generalActionHandler});
  await listening.focus();await page.keyboard.press('F9');await expect(shortcutFailure).toBeVisible({timeout:15000});
  await expect(shortcutFailure).toHaveAccessibleName('Record shortcut not confirmed');
  const retryStart=recoveryOutput.length;
  await shortcutFailure.getByRole('button',{name:'Try again',exact:true}).press('Enter');
  await expect.poll(()=>recoveryOutput.slice(retryStart).includes('"key":"F9"')).toBe(true);
  assert.equal(recoveryOutput.slice(retryStart).includes('"key":"Enter"'),false,'Enter retries the selected shortcut instead of binding Enter');
  const recordShortcut=page.getByRole('button',{name:'Change Record shortcut, currently F9',exact:true});
  await projectGeneral(false,false,'F9');await expect(shortcutFailure).not.toBeVisible();
  await expect(recordShortcut).toBeFocused();
  await projectGeneral(false,true,'F9');await listening.focus();await page.keyboard.press('F9');
  await expect(listening).toHaveAttribute('aria-busy','true');
  await projectGeneral(false,false,'F9');
  await expect(recordShortcut).not.toHaveAttribute('aria-busy','true');
  for(const zoom of [1,2]){
    await application.evaluate(({BrowserWindow},zoom)=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(640,530);w.webContents.setZoomFactor(zoom)},zoom);
    await projectGeneral(false,false,'F9');
    await recordShortcut.focus();await page.keyboard.press('Enter');await expect(recordShortcut).toHaveAttribute('aria-busy','true');
    await projectGeneral(false,false,'F9','Shortcut unavailable. Choose another shortcut.');
    await expect(recordShortcut).toBeFocused();
    assert.equal(await page.locator('.general-validation').evaluate(el=>{const r=el.closest('.general-shortcut').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),true,'focused shortcut and new validation are visible together');
  }
  await projectGeneral();
  await page.getByRole('switch',{name:'Launch at login',exact:true}).click();
  await expect.poll(()=>recoveryOutput.includes('"key":"launchAtLogin","value":true')).toBe(true);
  const startup=page.getByRole('switch',{name:'Launch at login',exact:true});
  await expect(startup).toBeDisabled();await expect(startup).toHaveAttribute('aria-busy','true');
  const sent=recoveryOutput.split('"key":"launchAtLogin"').length;
  await startup.evaluate(element=>element.click());
  assert.equal(recoveryOutput.split('"key":"launchAtLogin"').length,sent,'repeat activation waits for the parent state');
  await projectGeneral(true);await expect(startup).toBeEnabled();await expect(startup).toBeChecked();await expect(startup).not.toHaveAttribute('aria-busy','true');
  assert.equal(await page.evaluate(async()=>{try{await window.apparentGeneral.act({action:'set',key:'cloud',value:true});return false}catch{return true}}),true);
  }finally{await application.close();await fs.rm(home,{recursive:true,force:true})}
});
