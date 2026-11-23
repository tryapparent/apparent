import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
test('Labs uses parent acknowledgements, persists its switch, and recovers from refusal', {timeout:60000}, async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'labs-settings-'));
 const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
 const application=spawn(createRequire(import.meta.url)('electron') as string,
  ['--no-sandbox',frontend,'--settings-storage','--settings-labs','--settings-parent','--remote-debugging-port=0'],
  {env:{...process.env,ELECTRON_RUN_AS_NODE:'',APPARENT_MODELS_DIR:'',HOME:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache')},stdio:'pipe'});
 const exited=new Promise<void>(resolve=>application.once('exit',()=>resolve()));
 let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined;
 const messages:Record<string,unknown>[]=[];
 const saved: Record<string, boolean | null> = {saved: null};
 let hold=true, fail=false, held:Record<string,unknown>|undefined;
 const reply=(message:Record<string,unknown>)=>{
  if(typeof message.enabled==='boolean' && !fail){
   const setting=message.setting;
   const field=setting==='wisprFlow'?'wisprSaved':setting?`${setting}Saved`:'saved';
   saved[field]=message.enabled;
  }
  application.stdin.write(JSON.stringify({type:'labs-result',request:message.request,facts:fail?{error:'config_write_failed'}:{...saved,agentContextAccess:'approval_required',autoPasteSupported:process.platform==='linux',wisprSupported:process.platform==='darwin'}})+'\n');
 };
 createInterface({input:application.stdout}).on('line',line=>{
  try{const value=JSON.parse(line);messages.push(value);if(value.action==='agents-preference'){application.stdin.write(JSON.stringify({type:'agents-result',request:value.request,facts:{saved:null,t3Saved:false,t3Configured:false}})+'\n');}if(value.action==='labs-preference'){if(hold)held=value;else reply(value);}}catch{}
 });
 try{
  const url=await new Promise<string>((resolve,reject)=>{
   let stderr='';application.stderr.on('data',chunk=>{stderr+=chunk.toString();const match=stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];if(match)resolve(match);});
   application.once('error',reject);application.once('exit',code=>reject(Error(`Settings exited ${code}: ${stderr.slice(-600)}`)));
  });
  browser=await chromium.connectOverCDP(url);const page=browser.contexts()[0].pages()[0];
  await expect(page).toHaveTitle('Apparent Settings — Labs');
  assert.deepEqual(await page.locator('.settings-navigation-wide button').allTextContents(),['General','Recording','Storage','Permissions','Agents','Labs','About']);
  await expect(page.getByRole("switch",{name:"Skip screen selection"})).toHaveCount(0);
  const toggle=page.getByRole('switch',{name:'Live local transcription'});
  await expect(page.getByText('Compact recording prompts',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Transcript-only handoff',{exact:true})).toHaveCount(0);
  const agentContext=page.getByRole('switch',{name:'Recording context for agents'});
  const doodles=page.getByRole('switch',{name:'Recording pill doodles'});
  const circles=page.getByRole('switch',{name:'Label circled items'});
  await expect(circles).toBeDisabled();
  await expect(agentContext).toBeDisabled();
  await expect(agentContext).toHaveAccessibleDescription(/local dev page using the Apparent SDK/);
  await expect(toggle).toBeDisabled();await expect.poll(()=>Boolean(held)).toBe(true);
  reply(held!);hold=false;await expect(toggle).toBeEnabled();await expect(toggle).toHaveAttribute('aria-checked','false');
  await expect(doodles).toBeChecked();
  await expect(agentContext).toHaveAttribute('aria-checked','false');
  await expect(circles).not.toBeChecked();
  await circles.focus();await page.keyboard.press('Space');
  await expect(circles).toBeChecked();await expect(circles).toBeFocused();
  await agentContext.focus();await page.keyboard.press('Space');
  await expect(agentContext).toHaveAttribute('aria-checked','true');await expect(agentContext).toBeFocused();
  await expect(page.locator('#agent-context-access')).toContainText('Allow Apparent');
  await page.reload();
  await expect(circles).toBeChecked();
  await expect(agentContext).toBeChecked();
  await expect(doodles).toBeChecked();
  assert.equal(await toggle.locator('.apparent-switch-track').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(229, 229, 234)');
  const track=toggle.locator('.apparent-switch-track');
  await expect(track).toHaveCSS('width','51px');
  await expect(track).toHaveCSS('height','31px');
  await expect(page.getByRole('button',{name:'Labs',exact:true})).toHaveAttribute('aria-current','page');
  assert.match(await page.getByRole('button',{name:'Labs',exact:true}).locator('svg').innerHTML(),/M9 3h6/);
  hold=true;held=undefined;await toggle.focus();await page.keyboard.press('Space');
  await expect(toggle).toBeDisabled();await expect(toggle).toHaveAttribute('aria-checked','false');
  await expect(toggle).toHaveCSS('cursor','wait');await expect(toggle).toHaveAttribute('aria-busy','true');
  await expect(page.getByText('Reading or saving preference…',{exact:true})).toHaveCount(0);
  await expect.poll(()=>Boolean(held)).toBe(true);reply(held!);hold=false;
  await expect(toggle).toHaveAttribute('aria-checked','true');
  await expect(toggle).toBeFocused();
  await expect(toggle.locator('.apparent-switch-thumb')).toHaveCSS('transform','matrix(1, 0, 0, 1, 20, 0)');
  const enableAndReload = async (control: typeof toggle) => {
   await expect(control).not.toBeChecked();
   await control.focus();
   await page.keyboard.press('Space');
   await expect(control).toBeChecked();
   await expect(control).toBeFocused();
   await page.reload();
   await expect(control).toBeChecked();
   await expect(toggle).toBeChecked();
  };
  const speaking=page.getByRole('switch',{name:'Match my speaking style'});
  await enableAndReload(speaking);
  const sharing=page.getByRole('switch',{name:'Public sharing links'});
  await enableAndReload(sharing);
  const autoPaste=page.getByRole('switch',{name:'Auto paste',exact:true});
  if(process.platform==='linux') await enableAndReload(autoPaste);
  else await expect(autoPaste).toBeDisabled();
  await expect(page.getByRole('switch',{name:'Double-tap Shift for notes'})).toHaveCount(0);
  const wispr=page.getByRole('switch',{name:'Dictation app conflicts',exact:true});
  await expect(wispr).toHaveAttribute('aria-checked','false');
  if(process.platform==='darwin') await enableAndReload(wispr);
  else await expect(wispr).toBeDisabled();
  assert.equal(await page.evaluate(async()=>await window.apparentGeneral.read().then(()=>false,()=>true) && await window.apparent.readConnectSettings().then(()=>false,()=>true)),true);
  if(process.platform!=='darwin')await assert.rejects(()=>page.evaluate(()=>window.apparentLabs.save(true,'wisprFlow')));
  const silentPrompt = page.getByRole('switch', {name:'Silent prompts'});
  const retryLipflow = page.getByRole('button', {name:'Retry setup'});
  await expect(silentPrompt).toHaveAttribute('aria-checked','false');
  await expect(retryLipflow).toHaveCount(0);
  await assert.rejects(() => page.evaluate(() => window.apparentLipPrompt.begin()));
  await silentPrompt.focus(); await page.keyboard.press('Space');
  await expect(silentPrompt).toHaveAttribute('aria-checked','true');
  await expect(silentPrompt).toBeFocused();
  if (process.platform === "linux" && process.arch === "arm64")
   await expect(page.getByText("Automatic model setup is unavailable on this platform.")).toBeVisible();
  else await expect(retryLipflow).toBeEnabled();
  await page.reload();
  await expect(silentPrompt).toHaveAttribute('aria-checked','true');
  if (process.platform === "linux" && process.arch === "arm64")
   await expect(page.getByText("Automatic model setup is unavailable on this platform.")).toBeVisible();
  else await expect(retryLipflow).toBeEnabled();
  const frog = page.getByRole('switch', {name:'Frog after dictation'});
  if (process.platform === 'darwin') {
   await expect(frog).toHaveAttribute('aria-checked','false');
   await expect(frog).toHaveAccessibleDescription(/after the first session and every other session after that/);
   await page.getByRole('button',{name:'Preview frog'}).click();
   const animation = page.locator('.dictation-frog-preview img');
   await expect.poll(() => animation.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(240);
   await page.getByRole('button',{name:'Stop preview'}).click();
   await expect(animation).toHaveCount(0);
   await expect(frog).toHaveAttribute('aria-checked','false');
   await frog.click();
   await expect(frog).toHaveAttribute('aria-checked','true');
   await frog.click();
   await expect(frog).toHaveAttribute('aria-checked','false');
  } else await expect(frog).toHaveCount(0);

  assert.equal(await page.evaluate(async()=>{
   for(const call of [()=>window.apparentAgents.save(true),()=>window.apparentAgents.copySkill(),()=>window.apparent.resetCaptureLocation(),()=>window.apparentLabs.save('true' as unknown as boolean),()=>window.apparentLabs.save(true,'t3' as 'sharing')]){
    try{await call();return false;}catch{}
   }return true;
  }),true,'Labs cannot mutate another pane or send invalid preferences');
  for(const width of [920,720,640,320])for(const theme of ['light','dark']){
   const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:530,deviceScaleFactor:1,mobile:false});
   await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
   assert.equal(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontSize),'48px');
   assert.equal(await page.locator('#auto-paste-label').evaluate(e=>getComputedStyle(e).fontSize),'18px');
   assert.equal(await sharing.locator('.apparent-switch-thumb').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
   assert.equal(await toggle.locator('.apparent-switch-track').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(122, 88, 199)');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await page.locator('.settings-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
   await toggle.scrollIntoViewIfNeeded();await expect(toggle).toBeInViewport();
   if(process.env.APPARENT_LIVE_PROOF){
    await fs.mkdir(process.env.APPARENT_LIVE_PROOF,{recursive:true});
    await page.locator('.settings-content').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:path.join(process.env.APPARENT_LIVE_PROOF,`labs-${theme}-${width}.png`)});
    await page.locator('.settings-content').evaluate(el=>el.scrollTop=el.scrollHeight);
    await expect(page.locator('.settings-labs > .agent-preference').last().locator('p').last()).toBeInViewport();
    await page.screenshot({path:path.join(process.env.APPARENT_LIVE_PROOF,`labs-${theme}-${width}-bottom.png`)});
    await toggle.scrollIntoViewIfNeeded();
   }
   for(const id of ['speaking-style-help','agent-context-limits','circle-labels-help','local-stream-ready','auto-paste-limits','public-sharing-limits','wispr-lab-help']){
    const guidance=page.locator(`#${id}`);await guidance.evaluate(el=>el.scrollIntoView({block:'center'}));await expect(guidance).toBeInViewport();
    if(['circle-labels-help','agent-context-limits','speaking-style-help'].includes(id) && process.env.APPARENT_LIVE_PROOF)
     await page.screenshot({path:path.join(process.env.APPARENT_LIVE_PROOF,`${id}-${theme}-${width}.png`)});
   }
   await cdp.detach();
  }
  await silentPrompt.click();
  await expect(silentPrompt).toHaveAttribute('aria-checked','false');
  await expect(retryLipflow).toHaveCount(0);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width:640,height:530,deviceScaleFactor:1,mobile:false});
  const recoveries: [string,typeof toggle][]=[['streaming',toggle],['agentContext',agentContext],['speakingStyle',speaking],['circleLabels',circles],['pillDoodles',doodles]];
  if(process.platform==='linux')recoveries.push(['autoPaste',autoPaste]);
  recoveries.push(['sharing',sharing]);
  if(process.platform==='darwin')recoveries.push(['wisprFlow',wispr]);
  for(const [setting,control] of recoveries){
   fail=true;await control.click();const popup=page.getByRole('alertdialog');await expect(popup).toContainText('Unable to save preference');await expect(control).toBeDisabled();
   assert.deepEqual(await popup.getByRole('button').allTextContents(),['Refresh preference','Close']);
   await expect(popup.getByRole('button',{name:'Refresh preference'})).toBeFocused();
   for(const theme of ['light','dark']){
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    if(process.env.APPARENT_LIVE_PROOF)await page.screenshot({path:path.join(process.env.APPARENT_LIVE_PROOF,`labs-error-${setting}-${theme}.png`)});
   }
   fail=false;await popup.getByRole('button',{name:'Refresh preference'}).click();await expect(popup).not.toBeVisible();
   await expect(control).toHaveAttribute('aria-checked','true');await expect(control).toBeFocused();
  }
  await cdp.detach();
  await agentContext.click();await expect(agentContext).toHaveAttribute('aria-checked','false');
  await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','false');
  await expect(sharing).toHaveAttribute('aria-checked','true');
  await sharing.click();await expect(sharing).toHaveAttribute('aria-checked','false');
  if(process.platform==='linux'){
   await expect(autoPaste).toHaveAttribute('aria-checked','true');
   await autoPaste.click();await expect(autoPaste).toHaveAttribute('aria-checked','false');
  }
  application.stdin.write(JSON.stringify({type:'labs-state',facts:{error:'config_read_failed'}})+'\n');
  await expect(page.getByRole('alertdialog')).toContainText('Unable to read preference');await expect(toggle).toBeDisabled();
  await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Refresh preference'})).toBeFocused();
  await page.getByRole('button',{name:'Refresh preference'}).click();await expect(toggle).toBeEnabled();
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  for(const theme of ['light','dark'] as const){
   await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
   assert.equal(await page.locator('.settings-content').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
   for(const control of [toggle,sharing,wispr]){await control.scrollIntoViewIfNeeded();await expect(control).toBeInViewport();}
  }
  await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
  for(const pane of ['General','Agents','Recording','Permissions','Storage','About']){
   const before=messages.length;const target=page.getByRole('button',{name:pane,exact:true});
   await expect(target).toBeEnabled();await target.focus();await expect(target).toBeFocused();await target.press('Enter');
   await expect.poll(()=>messages.slice(before).some(value=>value.action==='navigate'&&value.pane===pane.toLowerCase())).toBe(true);
  }
  assert.ok(messages.every(value=>value.action!=='set' && !(value.action==='agents-preference' && value.enabled!==undefined && value.setting!=='t3')));
 }finally{
  await browser?.close().catch(()=>{});if(application.exitCode===null){application.kill('SIGTERM');await exited;}
  await fs.rm(home,{recursive:true,force:true});
 }
});
