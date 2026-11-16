import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('Labs is a separate flask pane with acknowledged experiment saves and bounded capabilities',{timeout:45000},async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'labs-'));
  const frontend=path.resolve(import.meta.dirname,'../..');
  const child=spawn(createRequire(import.meta.url)('electron'),['--no-sandbox',frontend,'--settings-storage','--settings-labs','--settings-parent','--remote-debugging-port=0'],
    {env:{...process.env,ELECTRON_RUN_AS_NODE:'',HOME:home,XDG_CONFIG_HOME:path.join(home,'config')},stdio:'pipe'});
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  const actions:Record<string,unknown>[]=[];
  let sharingSaved:boolean|null=null;
  let saved:boolean|null=null,hold=true,fail=false,held:Record<string,unknown>|undefined;
  const reply=(action:Record<string,unknown>)=>{
    if('enabled'in action&&!fail){if(action.setting==='sharing')sharingSaved=action.enabled as boolean;else saved=action.enabled as boolean;}
    child.stdin.write(JSON.stringify({type:'agents-result',request:action.request,facts:fail?{error:'config_write_failed'}:{saved:null,autoPasteSaved:saved,sharingSaved,autoPasteSupported:process.platform==='linux'}})+'\n');
  };
  createInterface({input:child.stdout}).on('line',line=>{try{const action=JSON.parse(line);actions.push(action);if(action.action==='agents-preference'){if(hold)held=action;else reply(action);}}catch{}});
  let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined;
  try{
    const endpoint=await new Promise<string>((resolve,reject)=>{
      let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);const match=stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);if(match)resolve(match[1]);});
      child.once('error',reject);child.once('exit',code=>reject(Error(`Labs exited (${code}): ${stderr.slice(-800)}`)));
    });
    browser=await chromium.connectOverCDP(endpoint);const page=browser.contexts()[0].pages()[0];
    await expect(page).toHaveTitle('Apparent Settings — Labs');
    assert.deepEqual(await page.locator('nav button').allTextContents(),['General','Recording','Storage','Permissions','Agents','Labs','About']);
    const nav=page.getByRole('button',{name:'Labs',exact:true});
    await expect(nav).toHaveAttribute('aria-current','page');
    assert.match(await nav.locator('svg').innerHTML(),/M9 3h6/);
    const toggle=page.getByRole('switch',{name:'Auto paste',exact:true});await expect(toggle).toBeDisabled();
    await expect.poll(()=>Boolean(held)).toBe(true);reply(held!);hold=false;
    await expect(toggle).toHaveAttribute('aria-checked','false');
    if(process.platform==='linux'){
      await expect(toggle).toBeEnabled();hold=true;await toggle.focus();await page.keyboard.press('Space');
      await expect.poll(()=>held?.enabled===true).toBe(true);await expect(toggle).toBeDisabled();
      await expect(toggle).toHaveCSS('cursor','wait');await expect(toggle).toHaveAttribute('aria-busy','true');
      await expect(page.getByText('Checking experiment…',{exact:true})).toHaveCount(0);
      await expect(toggle).toHaveAttribute('aria-checked','false');assert.equal(held?.setting,'autoPaste');
      reply(held!);hold=false;await expect(toggle).toHaveAttribute('aria-checked','true');await expect(toggle).toBeFocused();
      fail=true;await toggle.click();const popup=page.getByRole('alertdialog');await expect(popup).toContainText('Unable to save preference');await expect(toggle).toBeDisabled();
      assert.deepEqual(await popup.getByRole('button').allTextContents(),['Refresh preference','Close']);
      await expect(popup.getByRole('button',{name:'Refresh preference'})).toBeFocused();
      if(process.env.APPARENT_LABS_PROOF){await fs.mkdir(process.env.APPARENT_LABS_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_LABS_PROOF,'labs-error.png')});}
      fail=false;await page.getByRole('button',{name:'Refresh preference'}).click();await expect(toggle).toHaveAttribute('aria-checked','true');
      await expect(popup).not.toBeVisible();await expect(toggle).toBeFocused();
      await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','false');
      await page.reload();await expect(toggle).toHaveAttribute('aria-checked','false');
    }else {await expect(toggle).toBeDisabled();await expect(toggle).toHaveCSS('opacity','0.45');}
    const sharing=page.getByRole('switch',{name:'Public sharing links',exact:true});
    await expect(sharing).toHaveAttribute('aria-checked','false');
    await sharing.focus();await page.keyboard.press('Space');
    await expect(sharing).toHaveAttribute('aria-checked','true');await expect(sharing).toBeFocused();
    assert.equal(actions.at(-1)?.setting,'sharing');assert.equal(saved,process.platform==='linux'?false:null);
    fail=true;await sharing.click();await expect(page.getByRole('alertdialog')).toBeVisible();
    fail=false;await page.getByRole('button',{name:'Refresh preference'}).click();
    await expect(sharing).toHaveAttribute('aria-checked','true');await expect(sharing).toBeFocused();
    await sharing.click();await expect(sharing).toHaveAttribute('aria-checked','false');
    await page.reload();await expect(sharing).toHaveAttribute('aria-checked','false');
    assert.equal(await page.evaluate(async()=>{
      for(const call of [()=>window.apparentAgents.save(true),()=>window.apparentAgents.saveT3(true),()=>window.apparentAgents.copySkill(),()=>window.apparent.resetCaptureLocation(),()=>window.apparentLabs.save('true' as unknown as boolean),()=>window.apparentLabs.save(true,'t3' as 'sharing')]){
        try{await call();return false;}catch{}
      }return true;
    }),true,'Labs cannot mutate other panes or send non-boolean preferences');
    for(const width of [920,640,320]){
      const session=await page.context().newCDPSession(page);await session.send('Emulation.setDeviceMetricsOverride',{width,height:530,deviceScaleFactor:1,mobile:false});
      for(const colorScheme of ['light','dark'] as const){
        await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
        await page.evaluate(()=>document.fonts.ready);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await toggle.scrollIntoViewIfNeeded();await expect(toggle).toBeInViewport();
        if(process.env.APPARENT_LABS_PROOF){await fs.mkdir(process.env.APPARENT_LABS_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_LABS_PROOF,`labs-${width}-${colorScheme}-auto.png`)});}
        await sharing.scrollIntoViewIfNeeded();await expect(sharing).toBeInViewport();
        await expect(sharing).toHaveCSS('font-size','18px');
        const track=sharing.locator('.apparent-switch-track');
        await expect(track).toHaveCSS('background-color','rgb(231, 224, 238)');
        await expect(track).toHaveCSS('border-width','0px');
        if(process.env.APPARENT_LABS_PROOF){await fs.mkdir(process.env.APPARENT_LABS_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_LABS_PROOF,`labs-${width}-${colorScheme}.png`)});}
        for(const id of ['auto-paste-limits','public-sharing-limits']){
          const guidance=page.locator(`#${id}`);await guidance.scrollIntoViewIfNeeded();
          const bounds=await guidance.boundingBox();
          assert.ok(bounds&&bounds.y>=0&&bounds.y+bounds.height<=await page.evaluate(()=>innerHeight)+1,'Complete experiment guidance stays reachable');
        }
      }await session.detach();
    }
    await page.getByRole('button',{name:'Agents',exact:true}).click();await expect.poll(()=>actions.some(action=>action.action==='navigate'&&action.pane==='agents')).toBe(true);
  }finally{
    await browser?.close().catch(()=>{});if(child.exitCode===null){child.kill('SIGTERM');await exited;}await fs.rm(home,{recursive:true,force:true});
  }
});
