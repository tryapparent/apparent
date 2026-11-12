import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Browser, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('../..', import.meta.url));

declare global {
  interface Window {
    releasePenImage?: () => void;
    originalGuideNode?: Element;
  }
}

const schemes: Array<'light' | 'dark'> = ['light', 'dark'];
const penSchemes: Array<'light' | 'dark'> = ['light', 'dark', 'light'];
for(const mode of ['--onboarding'])test(`onboarding fixed window shrinks to coach and restores setup ${mode}`, { timeout: 45000 }, async (t) => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'onboarding-window-'));
  const electronExecutable: string = require('electron');
  const child = spawn(electronExecutable, [path.join(__dirname, '..'), mode, '--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
    env: { ...process.env, APPARENT_UI_PROFILE: profile }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let browser: Browser | undefined;
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.stdin.end('{"type":"close"}\n');
      const timer = setTimeout(() => child.kill(), 3000);
      await exited; clearTimeout(timer);
    }
    await browser?.close();
    await fs.rm(profile, { recursive: true, force: true });
  });
  const endpoint = await new Promise<string>((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(Error('No Electron debugger endpoint')), 10000);
    child.once('error', reject);
    child.once('exit', () => { clearTimeout(timer); reject(Error('Electron exited before connection')); });
    child.stderr.on('data', bytes => {
      log += bytes;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context=browser.contexts()[0];
  const page: Page = context.pages()[0]||await context.waitForEvent('page');
  const send = (patch: Record<string, unknown>) => child.stdin.write(JSON.stringify({ type:'state', step:'welcome', rows:[], ready:true,
    index:0, count:5, testInstance:true, shortcut:'⌃⌥⇧9', ...patch })+'\n');
  let output='';child.stdout.on('data',bytes=>output+=bytes);
  const latestAction = (): string => {
    const line = output.trim().split('\n').at(-1);
    assert.ok(line, 'Expected an Electron action');
    const action: unknown = JSON.parse(line).action;
    assert.equal(typeof action, 'string', 'Expected an action string');
    if (typeof action !== 'string') throw new TypeError('Expected an action string');
    return action;
  };
  const receiptId = (action: string): string => {
    const id = action.split(':')[2];
    assert.ok(id, 'Expected a receipt ID in the Electron action');
    return id;
  };
  await page.emulateMedia({reducedMotion:'no-preference'});
  send({account:{status:'signed-out'}});
  await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"sign-in"');
  send({account:{status:'approval',userCode:'TEST-CODE',verificationUri:'https://app.example.test/connect/device?code=TEST-CODE'}});
  await expect(page.locator('.native-account code')).toHaveText('TEST-CODE');
  await page.getByRole('button',{name:'Continue in browser',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"open-sign-in"');
  await page.getByRole('button',{name:'Cancel sign-in',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"cancel-sign-in"');
  send({account:{status:'failed',error:'expired'}});
  await expect(page.getByRole('alert')).toContainText('code expired');
  await expect(page.getByRole('button',{name:'Sign in with Google',exact:true})).toBeEnabled();
  send({account:{status:'signed-in'}});
  await expect(page.getByText('✓ Signed in.',{exact:true})).toBeVisible();
  await expect(page.getByText('Recording stays local. Uploads need separate permission in Settings.',{exact:true})).toBeVisible();
  send({ penPicker:true });
  await expect(page.getByRole('heading', { name:'Pick your pen.', exact:true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(760);
  assert.deepEqual(await page.locator('.native-pencils button').allTextContents(),['','','','']);
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.native-setup')).toHaveCSS('font-family', '"Host Grotesk", system-ui, sans-serif');
  await expect(page.getByRole('heading',{name:'Pick your pen.',exact:true})).toHaveCSS('font-size','36px');
  await expect(page.getByRole('button',{name:'Use this pen',exact:true})).toHaveCount(0);
  for(const scheme of penSchemes){
    await page.emulateMedia({colorScheme:scheme});
    await expect(page.locator('.native-setup')).toHaveCSS('background-color',scheme==='light'?'rgb(245, 240, 232)':'rgb(2, 1, 2)');
    const tip=await page.locator('.native-pencils button span').first().evaluate((el: HTMLElement)=>getComputedStyle(el,'::after').borderTopColor);
    assert.notEqual(tip,scheme==='light'?'rgb(245, 240, 232)':'rgb(2, 1, 2)','pen tip must remain visible against the page');
  }

  // Hold the first image decode, as on a cold launch. Save must finish first.
  await page.locator('.native-pond-frog').evaluate(img=>{if(!(img instanceof HTMLImageElement))throw new Error('Pond frog is not an image');const decode=img.decode.bind(img);img.decode=()=>decode().then(()=>new Promise<void>(resolve=>{window.releasePenImage=resolve}));});
  const before=await page.locator('.native-pond-frog').boundingBox();if(!before)throw new Error('Pond frog has no bounding box');
  await page.getByRole('button',{name:'purple pen',exact:true}).click();
  await expect.poll(()=>output).toContain('pen:purple:');
  const penSaveId=receiptId(latestAction());
  send({penPicker:true,penSelected:true,penRgb:[122,88,199]});
  await page.waitForTimeout(100);
  assert.equal(output.includes('"action":"continue"'),false,'stale selection cannot acknowledge this save');
  send({penPicker:true,penSelected:true,penRgb:[122,88,199],penSaveId});
  await expect(page.locator('.native-puddle path')).toHaveCSS('fill','rgb(122, 88, 199)');
  await expect(page.getByRole('button',{name:'purple pen',exact:true})).toBeDisabled();
  await new Promise(resolve=>setTimeout(resolve,1400));
  assert.equal(output.includes('"action":"continue"'),false,'cold image readiness must not be bypassed by a timer');
  await page.evaluate(()=>{if(!window.releasePenImage)throw new Error('Pen image decode is not held');window.releasePenImage();});
  await expect(page.locator('.native-pond')).toHaveAttribute('data-landing','true');
  const minimum=await page.evaluate(()=>new Promise<number>(resolve=>{
    const frog=document.querySelector<HTMLElement>('.native-pond-frog');if(!frog)throw new Error('Missing pond frog');const pondFrog=frog;let min=pondFrog.getBoundingClientRect().y;const began=performance.now();
    function sample(){min=Math.min(min,pondFrog.getBoundingClientRect().y);if(performance.now()-began<1000)requestAnimationFrame(sample);else resolve(min)}requestAnimationFrame(sample);
  }));
  assert.ok(minimum<before.y-25,'frog must rise visibly before landing');
  await expect.poll(()=>output).toContain('"action":"continue"');
  assert.equal(output.match(/"action":"continue"/g)?.length,1);
  send({step:'try-it',practice:'screen'});
  await expect(page.getByRole('heading',{name:'Choose Screen.',exact:true})).toBeVisible();
  send({ step:'try-it', practice:'whiteboard', anchor:[300,30,320,50] });
  await expect(page.getByRole('heading', { name:'Open Whiteboard.', exact:true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(380);
  assert.equal(await page.evaluate(() => {
    const main=document.querySelector<HTMLElement>('main');if(!main)throw new Error('Missing main');const rect=main.getBoundingClientRect();
    return rect.left>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight;
  }), true);
  send({step:'try-it',practice:'copy-failed'});
  await page.getByRole('button',{name:'Find saved capture',exact:true}).click();
  await expect.poll(()=>output).toContain('practice-locate');
  send({ step:'try-it', practice:'locate', anchor:[900,0,24,24] });
  await expect(page.getByRole('heading', { name:'apparent lives here.', exact:true })).toBeVisible();
  await expect(page.getByText('Click the a in your menu bar, then Open Latest Capture.', { exact:true })).toBeVisible();
  await expect(page.locator('.native-coach')).toHaveAttribute('data-arrow','true');
  for(const phase of ['screen','whiteboard','board-ink','screen-ink','stop','preparing','copied','paste','locate','complete','retry','copy-failed']){
    send({step:'try-it',practice:phase});
    await expect(page.locator('.native-coach')).toHaveAttribute('data-stage',phase);
    if(phase==='screen-ink'){
      await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(720);
      await expect(page.locator('.native-coach')).toHaveAttribute('data-paired','true');
      await expect(page.getByRole('complementary',{name:'Trackpad drawing hint'})).toBeVisible();
      const pair=await page.evaluate(()=>{const coach=document.querySelector<HTMLElement>('.native-coach'),helper=document.querySelector<HTMLElement>('.native-trackpad-helper');if(!coach||!helper)throw new Error('Missing paired coach surfaces');const a=coach.getBoundingClientRect(),b=helper.getBoundingClientRect();return{separate:a.right<b.left,inside:b.right<=innerWidth&&b.bottom<=innerHeight}});
      assert.deepEqual(pair,{separate:true,inside:true});
    }else{assert.equal(await page.getByRole('complementary',{name:'Trackpad drawing hint'}).count(),0)}
    const layout=await page.locator('.native-coach').evaluate(card=>{
      const content=card.querySelector<HTMLElement>('.native-coach-content');if(!content)throw new Error('Missing coach content');const rect=card.getBoundingClientRect();
      const buttons=[...card.querySelectorAll<HTMLButtonElement>('button')].map(button=>({font:parseFloat(getComputedStyle(button).fontSize),radius:getComputedStyle(button).borderRadius,...(()=>{const r=button.getBoundingClientRect();return{width:r.width,height:r.height}})()}));
      return{bottom:rect.bottom,viewport:innerHeight,horizontal:content.scrollWidth>content.clientWidth,scroll:content.scrollHeight>content.clientHeight,buttons};
    });
    assert.ok(layout.bottom<=layout.viewport,phase+' coach is clipped');
    assert.equal(layout.horizontal,false,phase+' content overflows horizontally');
    assert.equal(layout.scroll,false,phase+' needs scrolling at normal text size');
    for(const button of layout.buttons){assert.ok(button.font>=18&&button.width>=44&&button.height>=44,phase+' button violates brand minimum');assert.equal(button.radius,'0px');}
  }
  send({step:'try-it',practice:'note',firstCaptureRequired:true});
  await expect(page.locator('.native-coach')).toHaveAttribute('data-stage','screen-ink');
  await expect(page.getByRole('heading',{name:'Draw on your screen.',exact:true})).toBeVisible();
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','draw');
  assert.equal(await page.getByRole('textbox').count(),0,'the coach must not replace the real note editor');
  await page.emulateMedia({reducedMotion:'no-preference'});
  // All three control examples remain presentation only, and settle once.
  for(const [phase,kind] of [['whiteboard','whiteboard'],['stop','finish'],['locate','locate']]){
    send({step:'try-it',practice:phase,firstCaptureRequired:true});
    await expect(page.locator('.native-control')).toHaveAttribute('data-kind',kind);
    const before=output;
    await page.locator('.native-control button').click();
    assert.equal(output,before,'Control-guide replay must never drive the app');
  }
  send({step:'try-it',practice:'whiteboard',firstCaptureRequired:true});
  await expect(page.locator('.native-control')).toHaveAttribute('data-kind','whiteboard');
  await page.locator('.native-control').evaluate(el=>{for(const a of el.getAnimations({subtree:true})){a.pause();a.currentTime=2500}});
  await expect(page.locator('.control-screen')).toHaveCSS('opacity','0');
  await expect(page.locator('.control-board')).toHaveCSS('opacity','1');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.native-control').evaluate(el=>el.getAnimations({subtree:true}).length),0);
  await expect(page.locator('.native-control button')).toBeHidden();
  await page.emulateMedia({reducedMotion:'no-preference'});
  send({step:'try-it',practice:'whiteboard',platform:'linux',firstCaptureRequired:true});
  await expect(page.getByText('Open Whiteboard from the recording controls.',{exact:true})).toBeVisible();
  await expect(page.getByRole('figure',{name:'Example: click Whiteboard',exact:true})).toBeVisible();
  await expect(page.locator('.control-screen')).toBeHidden();
  await expect(page.locator('.control-board')).toHaveCSS('opacity','1');
  // Guides use the saved keys, finish once, and replay without invoking app actions.
  send({step:'try-it',practice:'retry',shortcut:'⌃⌘9',firstCaptureRequired:true});
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','record');
  assert.deepEqual(await page.locator('.native-gesture kbd').allTextContents(),['⌃','⌘','9']);
  const strip=await page.locator('.native-gesture').boundingBox();assert.ok(strip);
  assert.ok(strip.height<=80,'Keep the inline demonstration compact');
  await page.locator('.native-gesture').evaluate(async el=>{
    await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished));
  });
  assert.equal(await page.locator('.native-gesture').evaluate(el=>el.getAnimations({subtree:true}).every(animation=>animation.playState==='finished')),true);
  await page.locator('.native-gesture-motion').evaluate(el=>{window.originalGuideNode=el;});
  const priorActions=output;
  await page.getByRole('button',{name:'Replay shortcut guide',exact:true}).click();
  assert.equal(await page.locator('.native-gesture-motion').evaluate(el=>el!==window.originalGuideNode),true);
  assert.equal(output,priorActions,'Replay must never send shortcuts or advance onboarding');
  send({step:'try-it',practice:'paste',platform:'linux',firstCaptureRequired:true});
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','paste');
  assert.deepEqual(await page.locator('.native-gesture kbd').allTextContents(),['Ctrl','V']);
  send({step:'try-it',practice:'retry',platform:'linux',shortcut:'Ctrl+Alt+K',firstCaptureRequired:true});
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','record');
  assert.deepEqual(await page.locator('.native-gesture kbd').allTextContents(),['Ctrl','Alt','K']);
  for(const [platform,shortcut,keys] of [
    ['linux','Ctrl++',['Ctrl','+']],
    ['macos','⌥⇧Space',['⌥','⇧','Space']],
    ['macos','⌥⇧+',['⌥','⇧','+']],
  ]){
    send({step:'try-it',practice:'retry',platform,shortcut,firstCaptureRequired:true});
    await expect(page.locator('.native-gesture')).toHaveAttribute('aria-label','Record with '+shortcut);
    assert.deepEqual(await page.locator('.native-gesture kbd').allTextContents(),keys);
  }
  await page.emulateMedia({colorScheme:'dark'});
  await page.locator('.native-gesture').evaluate(el=>{for(const animation of el.getAnimations({subtree:true})){animation.pause();animation.currentTime=2000}});
  await expect(page.locator('.native-gesture kbd').first()).toHaveCSS('color','rgb(2, 1, 2)');
  await expect(page.locator('.native-gesture')).toHaveCSS('background-color','rgb(231, 224, 238)');
  await expect(page.getByRole('button',{name:'Replay shortcut guide',exact:true})).toHaveCSS('color','rgb(2, 1, 2)');
  send({step:'try-it',practice:'screen-ink',firstCaptureRequired:true});
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','draw');
  await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
  assert.equal(await page.locator('.native-gesture').evaluate(el=>el.getAnimations({subtree:true}).length),0);
  await expect(page.getByRole('button',{name:'Replay drawing guide',exact:true})).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'light'});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(720);
  await expect(page.locator('.native-coach')).toHaveAttribute('data-paired','true');
  await expect(page.locator('.native-coach-content > p')).toHaveCSS('font-size','36px');
  await expect(page.locator('.native-trackpad-helper p')).toHaveCSS('font-size','36px');
  const enlargedHelper=await page.locator('.native-trackpad-helper').evaluate(el=>{const r=el.getBoundingClientRect(),content=el.querySelector<HTMLElement>('.native-trackpad-helper-content');if(!content)throw new Error('Missing trackpad helper content');return{inside:r.right<=innerWidth&&r.bottom<=innerHeight,horizontal:content.scrollWidth>content.clientWidth}});
  assert.deepEqual(enlargedHelper,{inside:true,horizontal:false});
  assert.equal(await page.locator('.native-coach-content').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.getByRole('button',{name:'Close guide',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:'Close guide',exact:true})).toBeInViewport();
  await page.evaluate(()=>document.documentElement.style.fontSize='');

  send({ step:'permissions' });
  await expect(page.getByRole('heading', { name:'We need three things.', exact:true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(760);
  assert.equal(await page.locator('.native-setup section > p').count(),0);
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:false,platform:'linux',shortcut:'Super+Shift+Copilot',shortcutEditor:{recording:false,externallyManaged:true}});
  await expect(page.locator('.native-shortcut kbd')).toHaveText('Super+Shift+Copilot');
  await expect(page.getByRole('button',{name:'Use Super+Shift+Copilot',exact:true})).toBeInViewport();
  await expect(page.getByRole('button',{name:'Choose another shortcut',exact:true})).toBeInViewport();
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Choose another shortcut',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"change-shortcut"');
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:false,platform:'macos',shortcutEditor:{recording:false,externallyManaged:false}});
  await expect(page.getByRole('heading',{name:'Choose your shortcut.',exact:true})).toBeVisible();
  await expect(page.locator('.native-shortcut kbd')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Choose shortcut',exact:true}).click();
  await expect.poll(()=>output).toContain('change-shortcut');
  assert.equal(output.includes('use-current-shortcut'),false);
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:false});
  await expect(page.getByRole('heading',{name:'Try your shortcut.',exact:true})).toBeVisible();
  assert.equal(await page.getByText(/This check won’t record/).count(),0);
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
  const beforeTrialAdvance=(output.match(/"action":"continue"/g)?.length??0);
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:true});
  await expect(page.getByRole('heading',{name:'Go again.',exact:true})).toBeVisible();
  await expect.poll(()=>(output.match(/"action":"continue"/g)?.length??0)).toBe(beforeTrialAdvance+1);
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:true});
  await page.waitForTimeout(100);
  assert.equal((output.match(/"action":"continue"/g)?.length??0),beforeTrialAdvance+1,'repeated state must not advance twice');
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Change shortcut',exact:true})).toBeVisible();
  send({step:'try-it',practice:'start',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:true});
  await expect(page.getByRole('heading',{name:'Go again.',exact:true})).toBeVisible();
  assert.equal(await page.getByText(/Press .* to start recording/).count(),0);
  await expect(page.locator('.native-setup')).toBeVisible();
  await expect(page.locator('.native-coach')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>[innerWidth,innerHeight])).toEqual([760,520]);
  await expect(page.locator('.native-shortcut kbd')).toHaveText('⌃⌥⇧9');
  await expect(page.locator('.native-shortcut kbd')).toHaveCSS('font-size','40px');
  const keys=await page.locator('.native-shortcut kbd').boundingBox();assert.ok(keys);
  assert.ok(Math.abs(keys.x+keys.width/2-380)<2,'keys are horizontally centered');
  assert.ok(Math.abs(keys.y+keys.height/2-260)<60,'keys are vertically centered in the compact setup');
  assert.equal(await page.locator('.native-setup section').evaluate(el=>el.scrollHeight>el.clientHeight),false);
  await expect(page.getByRole('button',{name:'Try a capture',exact:true})).toHaveCount(0);
  send({step:'try-it',practice:'screen',firstCaptureRequired:true});
  await expect(page.locator('.native-coach')).toBeVisible();
  await expect(page.locator('.native-setup')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThan(760);
  send({step:'try-it',practice:null,firstCaptureRequired:true});
  await expect(page.getByRole('heading',{name:'Go again.',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>[innerWidth,innerHeight])).toEqual([760,520]);
  const fnChoiceStart=output.length;
  send({step:'shortcut',platform:'macos',shortcutChosen:false,shortcutEditor:{recording:false,externallyManaged:false,error:null}});
  await page.getByRole('button',{name:'Use Fn',exact:true}).click();
  await expect.poll(()=>output.slice(fnChoiceStart)).toContain('\"keyCode\":63');
  assert.ok(output.slice(fnChoiceStart).indexOf('change-shortcut')<output.slice(fnChoiceStart).indexOf('\"keyCode\":63'),'open the provider editor before Fn selection');
  send({step:'shortcut',shortcutEditor:{recording:true,externallyManaged:false}});
  const recorder=page.getByRole('group',{name:'Shortcut recorder'});
  await recorder.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button',{name:'Close setup'})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(recorder).toBeFocused();
  await expect(recorder).toHaveCSS('outline-style','solid');
  const screenshot=async (name: string): Promise<void> =>{
    if(!process.env.APPARENT_FN_EVIDENCE)return;
    await fs.mkdir(process.env.APPARENT_FN_EVIDENCE,{recursive:true});
    await page.screenshot({path:path.join(process.env.APPARENT_FN_EVIDENCE,name+'.png'),fullPage:true});
  };
  await screenshot('shortcut-listening-normal-light');
  await page.setViewportSize({width:320,height:520});
  for(const scheme of schemes){
    await page.emulateMedia({colorScheme:scheme});
    await expect(page.locator('.native-setup')).toHaveCSS('background-color',scheme==='light'?'rgb(245, 240, 232)':'rgb(2, 1, 2)');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`shortcut editor overflows at 320px in ${scheme} mode`);
    await expect(recorder).toBeInViewport();
    await screenshot(`shortcut-listening-320-${scheme}`);
  }
  await page.emulateMedia({colorScheme:'light'});
  const priorFnCount=(output.match(/"keyCode":63/g)||[]).length;
  await recorder.evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Fn',code:'Fn',metaKey:true,bubbles:true})));
  await expect(page.getByRole('alert')).toContainText('Fn alone');
  await screenshot('shortcut-rejected-fn-modifier');
  assert.equal((output.match(/"keyCode":63/g)||[]).length,priorFnCount,'Fn with another modifier must not be accepted');
  await recorder.getByRole('button',{name:'Use Fn',exact:true}).click();
  await expect.poll(()=>output).toContain('"keyCode":63,"modifiers":0,"key":"Fn"');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await screenshot('shortcut-fn-error-recovered');
  send({step:'shortcut',platform:'macos',shortcut:'Fn',shortcutChosen:true,shortcutTested:false,shortcutEditor:{recording:false,externallyManaged:false,error:null}});
  await expect(page.getByRole('heading',{name:'Try your shortcut.',exact:true})).toBeVisible();
  await expect(page.locator('.native-shortcut kbd')).toHaveText('Fn');
  await screenshot('shortcut-accepted-fn');
  send({step:'shortcut',platform:'macos',shortcut:'Fn',shortcutChosen:true,shortcutEditor:{recording:true,externallyManaged:false,error:null}});
  await page.getByRole('group',{name:'Shortcut recorder'}).focus();
  await page.getByRole('group',{name:'Shortcut recorder'}).press('Control+Alt+k');
  await expect.poll(()=>output).toContain('"keyCode":40');
  await expect.poll(()=>output).toContain('"modifiers":6144');
  await page.getByRole('group',{name:'Shortcut recorder'}).evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'ß',code:'KeyS',altKey:true,bubbles:true})));
  await expect.poll(()=>output).toContain('"keyCode":1,"modifiers":2048,"key":"s"');
  await page.getByRole('group',{name:'Shortcut recorder'}).press('Tab');
  await expect(page.getByRole('button',{name:'Use Fn',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Use Fn',exact:true}).press('Tab');
  await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Cancel',exact:true}).press('Enter');
  await expect.poll(()=>output).toContain('cancel-shortcut');
  send({step:'shortcut',platform:'linux',shortcutChosen:false,shortcutEditor:{recording:false,externallyManaged:false,error:null}});
  await expect(page.getByRole('button',{name:'Use Fn',exact:true})).toHaveCount(0);
  send({shortcutEditor:{recording:true,externallyManaged:false,error:null}});
  await expect(page.getByRole('button',{name:'Use Fn',exact:true})).toHaveCount(0);

  await page.emulateMedia({reducedMotion:'reduce'});
  send({penPicker:true,penSelected:true,penRgb:[59,121,189]});
  await expect(page.getByRole('heading',{name:'Pick your pen.',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'blue pen',exact:true}).click();
  await expect.poll(()=>output).toContain('pen:blue:');
  const blueSaveId=receiptId(latestAction());
  send({penPicker:true,penSelected:true,penRgb:[59,121,189],penSaveId:blueSaveId});
  await expect.poll(()=>output.match(/"action":"continue"/g)?.length).toBe(beforeTrialAdvance+2);
  await expect(page.locator('.native-pond-frog')).toHaveCSS('animation-name','none');
  await page.setViewportSize({width:320,height:720});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'pen picker must reflow at 320 CSS pixels');
  await page.setViewportSize({width:760,height:720});

  // Back returns to a stable picker; an old success must never replay advance.
  const advances=()=>output.match(/"action":"continue"/g)?.length??0;
  const beforeBack=advances();
  send({step:'permissions',index:1});
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"back"');
  send({penPicker:true,penSelected:true,penRgb:[59,121,189],penSaveId:blueSaveId});
  await expect(page.getByRole('button',{name:'blue pen',exact:true})).toBeEnabled();
  await page.waitForTimeout(120);
  assert.equal(advances(),beforeBack);
  for(const scheme of schemes)for(const width of [760,320]){
    await page.emulateMedia({colorScheme:scheme});
    await page.setViewportSize({width,height:720});
    await page.getByRole('button',{name:'blue pen',exact:true}).focus();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const back=await page.getByRole('button',{name:'Back',exact:true}).boundingBox();assert.ok(back);
    assert.ok(back.x<60,'Back stays at the leading edge after removing confirmation');
    if(process.env.APPARENT_PEN_EVIDENCE)await page.screenshot({path:path.join(process.env.APPARENT_PEN_EVIDENCE,`picker-${scheme}-${width}.png`)});
  }
  // Keyboard selection and an immediate duplicate click produce just one save.
  const saves=()=>output.match(/pen:blue:/g)?.length??0;
  const beforeSave=saves();
  await page.getByRole('button',{name:'blue pen',exact:true}).press('Enter');
  await page.getByRole('button',{name:'blue pen',exact:true}).evaluate(button=>{if(!(button instanceof HTMLButtonElement))throw new Error('Pen control is not a button');button.click();});
  await expect.poll(saves).toBe(beforeSave+1);
  const failedId=receiptId(latestAction());
  assert.notEqual(failedId,blueSaveId,'same-colour reselection has a fresh receipt');
  send({penPicker:true,penSelected:false,penError:true,penSaveId:failedId});
  await expect(page.getByRole('alert')).toHaveText('The colour could not be saved. Try choosing it again.');
  await expect(page.getByRole('button',{name:'blue pen',exact:true})).toBeEnabled();
  assert.equal(advances(),beforeBack);
  for(const width of [760,320]){
    await page.setViewportSize({width,height:720});
    await page.locator('.native-setup section').evaluate(section=>section.scrollTop=0);
    const alert=await page.getByRole('alert').boundingBox(),section=await page.locator('.native-setup section').boundingBox();assert.ok(alert&&section);
    assert.ok(alert.y>=section.y&&alert.y+alert.height<=section.y+section.height,'save feedback must be visible above the footer without scrolling');
  }
  if(process.env.APPARENT_PEN_EVIDENCE)await page.screenshot({path:path.join(process.env.APPARENT_PEN_EVIDENCE,'picker-save-error-dark-320.png')});
  await page.getByRole('button',{name:'blue pen',exact:true}).press('Space');
  await expect.poll(saves).toBe(beforeSave+2);
  const retryId=receiptId(latestAction());
  send({penPicker:true,penSelected:false,penError:true,penSaveId:failedId});
  await page.waitForTimeout(100);assert.equal(advances(),beforeBack);
  send({penPicker:true,penSelected:true,penRgb:[59,121,189],penSaveId:retryId});
  await expect.poll(advances).toBe(beforeBack+1);
});
