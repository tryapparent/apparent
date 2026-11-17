import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Settings changes adopted panes in one live document and enforces the current capabilities', {timeout:60000}, async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'shell-'));
  const child=spawn(createRequire(import.meta.url)('electron'),['--no-sandbox',path.resolve(import.meta.dirname,'../..'),'--settings-storage','--settings-general','--settings-parent','--remote-debugging-port=0'],
    {env:{...process.env,ELECTRON_RUN_AS_NODE:'',HOME:home,XDG_CONFIG_HOME:path.join(home,'config')},stdio:'pipe'});
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  const send=(message:object)=>child.stdin.write(JSON.stringify(message)+'\n');
  const actions:Record<string,unknown>[]=[];
  let holdLabs=false,heldLabs:Record<string,unknown>|undefined;
  createInterface({input:child.stdout}).on('line',line=>{
    const action=JSON.parse(line);actions.push(action);
    if(action.action==='navigate') {
      send({type:'show',pane:action.pane});
      if(action.pane==='general')send({type:'general-state',platform:'linux',login:{on:false,available:true,needsApproval:false},shortcuts:[{kind:'record',title:'Record',label:'F1',recording:false,externallyManaged:false,isDefault:true,clearable:false,error:null}],errorReporting:true,lowerPlayback:false,playbackLevel:35,playbackAvailable:false});
      if(action.pane==='about')send({type:'about-state',version:'shell-test',updates:false,linux:true,mainUpdates:false,updateChannel:'stable',updateCheck:{checking:false,result:null}});
    }
    if(action.action==='labs-preference'){if(holdLabs)heldLabs=action;else send({type:'labs-result',request:action.request,facts:{saved:false,sharingSaved:false,autoPasteSaved:false,autoPasteSupported:process.platform==='linux',wisprSaved:false,wisprSupported:process.platform==='darwin'}});}
    if(action.action==='agents-preference')send({type:'agents-result',request:action.request,facts:{saved:true,sharingSaved:false,t3Saved:false,autoPasteSaved:false,autoPasteSupported:process.platform==='linux',wisprSaved:false,wisprSupported:process.platform==='darwin'}});
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
    const session=await context.newCDPSession(page);
    for(const width of [720,640])for(const colorScheme of ['light','dark'] as const){
      await session.send('Emulation.setDeviceMetricsOverride',{width,height:530,deviceScaleFactor:1,mobile:false});
      await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
      for(const pane of ['Labs','Agents','About','General','Labs','About','Agents','General']){
        const nav=page.getByRole('button',{name:pane,exact:true});
        await nav.focus();await page.keyboard.press('Enter');
        await expect(page).toHaveTitle(`Apparent Settings — ${pane}`);
        await expect(nav).toHaveAttribute('aria-current','page');
        assert.equal(page.url(),originalUrl);
        assert.equal(context.pages().length,1);
        assert.equal(await page.evaluate(()=>Reflect.get(window,'shellIdentity')),'same document');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        assert.equal(await page.evaluate(async(current)=>{
          const calls:Record<string,()=>Promise<unknown>>={General:()=>window.apparentGeneral.act({action:'set',key:'lowerPlayback',value:false}),Labs:()=>window.apparentLabs.save(false,'sharing'),Agents:()=>window.apparentAgents.save(false),About:()=>window.apparentAbout.act({action:'tour'})};
          for(const [owner,call] of Object.entries(calls)){if(owner===current)continue;try{await call();return false;}catch{}}
          return true;
        },pane),true,'inactive pane mutations are rejected');
        await expect(page.locator('h1')).toHaveText(pane);
        if(pane==='General')await expect(page.getByRole('checkbox',{name:'Launch at login'})).toBeVisible();
        if(process.env.APPARENT_SHELL_PROOF){await fs.mkdir(process.env.APPARENT_SHELL_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_SHELL_PROOF,`${pane}-${width}-${colorScheme}.png`)});}
      }
    }
    await page.getByRole('button',{name:'Labs',exact:true}).click();
    const streaming=page.getByRole('switch',{name:'Live local transcription'});
    await expect(streaming).toBeEnabled();holdLabs=true;await streaming.click();
    await expect.poll(()=>heldLabs?.enabled).toBe(true);await expect(streaming).toBeDisabled();
    await page.getByRole('button',{name:'General',exact:true}).click();await expect(page).toHaveTitle('Apparent Settings — General');
    send({type:'labs-result',request:heldLabs!.request,facts:{saved:true}});holdLabs=false;
    await page.getByRole('button',{name:'Labs',exact:true}).click();
    await expect(streaming).toBeEnabled();await expect(streaming).toHaveAttribute('aria-checked','false');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>Reflect.get(window,'shellIdentity')),'same document');
    assert.equal(loads,0,'navigation never reloads Chromium');
    // The General recorder is a separate consumer of the shared shortcut policy.
    await page.getByRole('button',{name:'General',exact:true}).click();
    await expect(page.getByRole('checkbox',{name:'Launch at login'})).toBeVisible();
    const macShortcut=(recording:boolean,label='Fn')=>send({type:'general-state',platform:'macos',login:{on:false,available:true,needsApproval:false},
      shortcuts:[{kind:'record',title:'Record',label,recording,externallyManaged:false,isDefault:label==='Fn',clearable:false,error:null}],
      errorReporting:true,lowerPlayback:false,playbackLevel:35,playbackAvailable:true});
    const optionCount=()=>actions.filter(a=>a.action==='shortcut'&&a.key==='Option').length;
    for(const side of ['AltLeft','AltRight']){
      macShortcut(true);
      await expect(page.getByRole('button',{name:'Use Fn',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Press shortcut… (Esc cancels)',exact:true}).focus();
      assert.equal(await page.getByRole('button',{name:'Option',exact:true}).count(),0,'Option is not suggested');
      const before=optionCount();
      await page.keyboard.down(side);assert.equal(optionCount(),before);
      await page.keyboard.up(side);await expect.poll(optionCount).toBe(before+1);
      assert.deepEqual(actions.filter(a=>a.action==='shortcut'&&a.key==='Option').at(-1),{action:'shortcut',kind:'record',keyCode:58,modifiers:0,key:'Option',reserved:false});
    }
    const fnChoice=page.getByRole('button',{name:'Use Fn',exact:true});
    await fnChoice.focus();const beforeControl=optionCount();
    await page.keyboard.down('Alt');await page.keyboard.up('Alt');
    await page.waitForTimeout(100);assert.equal(optionCount(),beforeControl,'Fn suggestion is not the shortcut recorder');
    await fnChoice.press('Enter');
    await expect.poll(()=>actions.some(a=>a.action==='shortcut'&&a.key==='Fn'&&a.keyCode===63)).toBe(true);
    await page.getByRole('button',{name:'Press shortcut… (Esc cancels)',exact:true}).focus();
    const cleanCount=optionCount();
    await page.keyboard.down('Alt');await page.keyboard.press('r');await page.keyboard.up('Alt');
    await expect.poll(()=>actions.some(a=>a.action==='shortcut'&&a.key==='r'&&a.modifiers===2048)).toBe(true);
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
    const selected=page.getByRole('button',{name:'Option',exact:true});
    await expect(selected).toBeVisible();await selected.focus();await expect(selected).toBeFocused();
    for(const width of [720,640])for(const colorScheme of ['light','dark'] as const){
      await session.send('Emulation.setDeviceMetricsOverride',{width,height:530,deviceScaleFactor:1,mobile:false});
      await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await selected.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.APPARENT_SHELL_PROOF)await page.screenshot({path:path.join(process.env.APPARENT_SHELL_PROOF,`Option-${width}-${colorScheme}.png`)});
    }
    await page.getByRole('button',{name:'Storage',exact:true}).click();
    await expect(page).toHaveTitle('Apparent Settings — Storage');
    assert.equal(await page.evaluate(()=>typeof window.apparent?.readCaptureLocation),'function');
    assert.equal(await page.evaluate(async()=>{try{await window.apparent!.showCaptureFolder();return true;}catch{return false;}}),true);
    await expect.poll(()=>actions.at(-1)?.action).toBe('show-captures');
    // The native-only destination goes to the parent; the renderer must not fake adoption.
    await page.getByRole('button',{name:'Permissions',exact:true}).click();
    await expect.poll(()=>actions.at(-1)?.pane).toBe('permissions');
  } finally {
    await browser?.close().catch(()=>{});child.stdin.end();
    await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))]);
    if(child.exitCode===null)child.kill('SIGKILL');
    await fs.rm(home,{recursive:true,force:true});
  }
});
