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
  {env:{...process.env,ELECTRON_RUN_AS_NODE:'',HOME:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache')},stdio:'pipe'});
 const exited=new Promise<void>(resolve=>application.once('exit',()=>resolve()));
 let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined;
 const messages:Record<string,unknown>[]=[];
 let saved:boolean|null=null, autoPasteSaved:boolean|null=null, sharingSaved:boolean|null=null, wisprSaved:boolean|null=null, screenPickerSaved:boolean|null=null, dictationFrogSaved:boolean|null=null, compactHandoffSaved:boolean|null=null, transcriptOnlySaved:boolean|null=null, hold=true, fail=false, held:Record<string,unknown>|undefined;
 const reply=(message:Record<string,unknown>)=>{
  if(typeof message.enabled==='boolean' && !fail){if(message.setting==='autoPaste')autoPasteSaved=message.enabled;else if(message.setting==='sharing')sharingSaved=message.enabled;else if(message.setting==='wisprFlow')wisprSaved=message.enabled;else if(message.setting==='dictationFrog')dictationFrogSaved=message.enabled;else if(message.setting==='screenPicker')screenPickerSaved=message.enabled;else if(message.setting==='compactHandoff')compactHandoffSaved=message.enabled;else if(message.setting==='transcriptOnly')transcriptOnlySaved=message.enabled;else saved=message.enabled;}
  application.stdin.write(JSON.stringify({type:'labs-result',request:message.request,facts:fail?{error:'config_write_failed'}:{saved,sharingSaved,autoPasteSaved,autoPasteSupported:process.platform==='linux',wisprSaved,wisprSupported:process.platform==='darwin',screenPickerSupported:true,screenPickerSaved,dictationFrogSaved,compactHandoffSaved,transcriptOnlySaved}})+'\n');
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
  const recordingStart=page.getByRole("group",{name:"When you press Record"});
  const startNow=recordingStart.getByRole("radio",{name:"Start screen recording right away"});
  const chooseScreen=recordingStart.getByRole("radio",{name:"Choose a screen each time"});
  await expect(startNow).toBeChecked();
  await expect(chooseScreen).toBeDisabled();
  await expect(chooseScreen).toHaveAccessibleDescription("Open the system picker before recording starts.");
  const toggle=page.getByRole('switch',{name:'Live local transcription'});
  const compact=page.getByRole('switch',{name:'Compact recording prompts'});
  const speech=page.getByRole('switch',{name:'Transcript-only handoff'});
  await expect(compact).toBeDisabled();await expect(speech).toBeDisabled();
  await expect(toggle).toBeDisabled();await expect.poll(()=>Boolean(held)).toBe(true);
  reply(held!);hold=false;await expect(toggle).toBeEnabled();await expect(toggle).toHaveAttribute('aria-checked','false');
  for(const trial of [compact,speech]){
   await expect(trial).toHaveAttribute('aria-checked','false');
   await trial.focus();await page.keyboard.press('Space');
   await expect(trial).toHaveAttribute('aria-checked','true');await expect(trial).toBeFocused();
  }
  await page.reload();
  for(const trial of [compact,speech])await expect(trial).toHaveAttribute('aria-checked','true');
  assert.equal(await toggle.locator('.apparent-switch-track').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(229, 229, 234)');
  await expect(chooseScreen).toBeEnabled();
  await startNow.focus();await page.keyboard.press("ArrowDown");
  await expect(chooseScreen).toBeChecked();
  await page.screenshot();
  application.stdin.write(JSON.stringify({type:'show',pane:'labs'})+'\n');
  await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(true);
  await page.reload();await expect(chooseScreen).toBeChecked();
  await startNow.check();await expect(startNow).toBeChecked();
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
  const sharing=page.getByRole('switch',{name:'Public sharing links'});
  await expect(sharing).toHaveAttribute('aria-checked','false');
  await sharing.focus();await page.keyboard.press('Space');await expect(sharing).toHaveAttribute('aria-checked','true');await expect(sharing).toBeFocused();
  await page.reload();await expect(sharing).toHaveAttribute('aria-checked','true');await expect(toggle).toHaveAttribute('aria-checked','true');
  const autoPaste=page.getByRole('switch',{name:'Auto paste',exact:true});
  if(process.platform==='linux'){
   await expect(autoPaste).toHaveAttribute('aria-checked','false');
   await autoPaste.focus();await page.keyboard.press('Space');await expect(autoPaste).toHaveAttribute('aria-checked','true');await expect(autoPaste).toBeFocused();
   await expect(toggle).toHaveAttribute('aria-checked','true');
   await page.reload();await expect(autoPaste).toHaveAttribute('aria-checked','true');await expect(toggle).toHaveAttribute('aria-checked','true');
  }else await expect(autoPaste).toBeDisabled();
  await expect(page.getByRole('switch',{name:'Double-tap Shift for notes'})).toHaveCount(0);
  const wispr=page.getByRole('switch',{name:'Dictation app conflicts',exact:true});
  await expect(wispr).toHaveAttribute('aria-checked','false');
  if(process.platform==='darwin'){
   await wispr.focus();await page.keyboard.press('Space');await expect(wispr).toHaveAttribute('aria-checked','true');await expect(wispr).toBeFocused();
   await page.reload();await expect(wispr).toHaveAttribute('aria-checked','true');await expect(toggle).toHaveAttribute('aria-checked','true');
  }else await expect(wispr).toBeDisabled();
  assert.equal(await page.evaluate(async()=>await window.apparentGeneral.read().then(()=>false,()=>true) && await window.apparent.readConnectSettings().then(()=>false,()=>true)),true);
  if(process.platform!=='darwin')await assert.rejects(()=>page.evaluate(()=>window.apparentLabs.save(true,'wisprFlow')));
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
   for(const id of ['recording-picker-help','compact-handoff-help','transcript-only-help','local-stream-ready','auto-paste-limits','public-sharing-limits','wispr-lab-help']){
    const guidance=page.locator(`#${id}`);await guidance.evaluate(el=>el.scrollIntoView({block:'center'}));await expect(guidance).toBeInViewport();
    if((id==='compact-handoff-help' || id==='transcript-only-help') && process.env.APPARENT_LIVE_PROOF)
     await page.screenshot({path:path.join(process.env.APPARENT_LIVE_PROOF,`${id}-${theme}-${width}.png`)});
   }
   await cdp.detach();
  }
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width:640,height:530,deviceScaleFactor:1,mobile:false});
  const recoveries: [string,typeof toggle][]=[['streaming',toggle],['compactHandoff',compact],['transcriptOnly',speech]];
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
