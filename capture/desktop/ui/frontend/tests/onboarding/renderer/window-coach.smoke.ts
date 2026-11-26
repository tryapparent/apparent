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
    nativeOnboarding: { action(value: string): Promise<unknown> };
    releasePenImage?: () => void;
    originalGuideNode?: Element;
  }
}

const schemes: Array<'light' | 'dark'> = ['light', 'dark'];
const penSchemes: Array<'light' | 'dark'> = ['light', 'dark', 'light'];
test('onboarding fixed window shrinks to coach and restores setup', { timeout: 90000 }, async (t) => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'onboarding-window-'));
  const electronExecutable: string = require('electron');
  const child = spawn(electronExecutable, [path.join(__dirname, '../dist/composition/onboarding/entry.cjs'), '--assets-root', path.join(__dirname, '..'), '--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
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
  send({});
  await expect(page.getByRole('heading',{name:'Where’s ur agent at?',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Right here',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Up in the cloud',exact:true})).toHaveCount(1);
  for(const choice of await page.locator('.native-agent-choices button').all())await expect(choice).toHaveCSS('box-shadow','none');
  await page.getByRole('button',{name:'idk?? →',exact:true}).click();
  await expect(page.getByText('Can ur agent open files on this computer?',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Right here →',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"continue"');
  send({ penPicker:true });
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect.poll(latestAction).toBe('back');
  send({penPicker:false});
  await expect(page.getByRole('heading',{name:'Pick your pen.',exact:true})).toHaveCount(0);
  send({penPicker:true});
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
  const penAdvancesBefore=(output.match(/"action":"continue"/g)?.length??0);
  const before=await page.locator('.native-pond-frog').boundingBox();if(!before)throw new Error('Pond frog has no bounding box');
  await page.getByRole('button',{name:'purple pen',exact:true}).click();
  await expect.poll(()=>output).toContain('pen:purple:');
  const penSaveId=receiptId(latestAction());
  send({penPicker:true,penSelected:true,penRgb:[122,88,199]});
  await page.waitForTimeout(100);
  assert.equal((output.match(/"action":"continue"/g)?.length??0),penAdvancesBefore,'stale selection cannot acknowledge this save');
  send({penPicker:true,penSelected:true,penRgb:[122,88,199],penSaveId});
  await expect(page.locator('.native-puddle path')).toHaveCSS('fill','rgb(122, 88, 199)');
  await expect(page.getByRole('button',{name:'purple pen',exact:true})).toBeDisabled();
  await new Promise(resolve=>setTimeout(resolve,1400));
  assert.equal((output.match(/"action":"continue"/g)?.length??0),penAdvancesBefore,'cold image readiness must not be bypassed by a timer');
  await page.evaluate(()=>{if(!window.releasePenImage)throw new Error('Pen image decode is not held');window.releasePenImage();});
  await expect(page.locator('.native-pond')).toHaveAttribute('data-landing','true');
  const minimum=await page.evaluate(()=>new Promise<number>(resolve=>{
    const frog=document.querySelector<HTMLElement>('.native-pond-frog');if(!frog)throw new Error('Missing pond frog');const pondFrog=frog;let min=pondFrog.getBoundingClientRect().y;const began=performance.now();
    function sample(){min=Math.min(min,pondFrog.getBoundingClientRect().y);if(performance.now()-began<1000)requestAnimationFrame(sample);else resolve(min)}requestAnimationFrame(sample);
  }));
  assert.ok(minimum<before.y-25,'frog must rise visibly before landing');
  await expect.poll(()=>(output.match(/"action":"continue"/g)?.length??0)).toBe(penAdvancesBefore+1);
  assert.equal(output.match(/"action":"continue"/g)?.length,penAdvancesBefore+1);
  send({step:'try-it',practice:'screen',platform:'macos'});
  await expect(page.locator('main')).toHaveCount(0);
  send({step:'try-it',practice:'screen',platform:'linux'});
  await expect(page.getByRole('heading',{name:'Choose your display.',exact:true})).toBeVisible();
  await expect(page.locator('.native-control')).toHaveCount(0);
  const coachMetrics = await context.newCDPSession(page);
  const evidence = process.env.APPARENT_ONBOARDING_EVIDENCE;
  if (evidence) await fs.mkdir(evidence, { recursive: true });
  try {
    for (const [phase, action, title] of [
      ['whiteboard', 'whiteboard', 'Open Whiteboard.'],
      ['stop', 'finish', 'Finish your capture.'],
    ]) {
      send({ step: 'try-it', practice: phase, practiceAttempt: '7', anchor: [300, 30, 320, 50] });
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(380);
      for (const width of [380, 320]) for (const scheme of schemes) {
        await coachMetrics.send('Emulation.setDeviceMetricsOverride', { width, height: 440, deviceScaleFactor: 1, mobile: false });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        const coach = page.locator('.native-coach');
        await expect.poll(() => coach.evaluate(el => Math.ceil(el.getBoundingClientRect().width))).toBeLessThanOrEqual(Math.min(260, width - 48));
        assert.ok(await coach.evaluate(el => el.getBoundingClientRect().height < 200), phase + ' coach stays compact');
        await expect(coach.locator('p, kbd')).toHaveCount(0);
        await expect(coach.locator('.native-pill-guide')).toHaveAttribute('data-kind', action);
        await expect.poll(() => coach.evaluate((el, action) => {
          const pointer = el.querySelector('.native-pill-pointer')?.getBoundingClientRect();
          const button = el.querySelector(`[data-action=${action}]`)?.getBoundingClientRect();
          const row = el.querySelector('.pill-row')?.getBoundingClientRect();
          const content = el.querySelector('.native-coach-content')?.getBoundingClientRect();
          const mascot = el.querySelector(':scope > img')?.getBoundingClientRect();
          const heading = el.querySelector('h1');
          const close = el.querySelector('.native-finish-close')?.getBoundingClientRect();
          if (!pointer || !button || !row || !content || !mascot || !heading || !close) return false;
          const range = document.createRange();
          range.selectNodeContents(heading);
          const text = range.getBoundingClientRect();
          const center = (rect: DOMRect) => rect.left + rect.width / 2;
          return Math.abs(center(row) - center(content)) <= 1 &&
            Math.abs(center(mascot) - center(content)) <= 1 &&
            Math.abs(center(text) - center(content)) <= 1 &&
            text.right <= close.left &&
            Math.abs(pointer.left - center(button)) <= 1 &&
            Math.abs(pointer.top - (button.top + button.height / 2)) <= 1 &&
            row.right <= content.right && pointer.bottom <= content.bottom;
        }, action)).toBe(true);
        await page.locator('h1').click();
        if (evidence) await page.screenshot({ path: path.join(evidence, `${action}-coach-${scheme}-${width}.png`), omitBackground: true });
        await page.keyboard.press('Tab');
        const target = coach.locator(`button[data-action=${action}]`);
        await expect(target).toBeFocused();
        await expect(target).toHaveCSS('outline-style', 'solid');
        await expect(coach.locator('button[data-action=cancel]')).toBeDisabled();
        await page.keyboard.press('Tab');
        const close = page.getByRole('button', { name: 'Close guide', exact: true });
        await expect(close).toBeFocused();
        await expect(close).toHaveCSS('outline-style', 'solid');
      }
      const target = page.locator(`.native-pill-guide button[data-action=${action}]`);
      if (action === 'whiteboard') await target.click();
      else await target.press('Enter');
      const command = action === 'whiteboard' ? 'practice-open-board' : 'practice-save-capture';
      await expect.poll(latestAction).toBe(command + ':7');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect(page.locator('.native-pill-pointer')).toHaveCSS('animation-name', 'pill-guide-pointer');
      await coachMetrics.send('Emulation.clearDeviceMetricsOverride');
    }
  } finally {
    await coachMetrics.send('Emulation.clearDeviceMetricsOverride');
    await coachMetrics.detach();
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  }
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
  for(const phase of ['whiteboard','screen-ink','stop','copied','paste','locate','complete','retry','copy-failed']){
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
      const buttons=[...card.querySelectorAll<HTMLButtonElement>('button')].filter(button=>!button.closest('[inert]')).map(button=>({font:parseFloat(getComputedStyle(button).fontSize),radius:getComputedStyle(button).borderRadius,...(()=>{const r=button.getBoundingClientRect();return{width:r.width,height:r.height}})()}));
      return{bottom:rect.bottom,viewport:innerHeight,horizontal:content.scrollWidth>content.clientWidth,scroll:content.scrollHeight>content.clientHeight,buttons};
    });
    assert.ok(layout.bottom<=layout.viewport,phase+' coach is clipped');
    assert.equal(layout.horizontal,false,phase+' content overflows horizontally');
    assert.equal(layout.scroll,false,phase+' needs scrolling at normal text size');
    for(const button of layout.buttons){assert.ok(button.font>=18&&button.width>=44&&button.height>=44,phase+' button violates brand minimum');assert.equal(button.radius,'6px');}
  }
  for(const [stage,label,action] of [['copied','Done','practice-review'],['paste','Done','practice-review'],['complete','Finish setup','practice-finish']]){
    send({step:'try-it',practice:stage});
    await page.getByRole('button',{name:label,exact:true}).click();
    await expect.poll(()=>output).toContain(JSON.stringify({action}));
  }
  assert.equal(await page.evaluate(()=>window.nativeOnboarding.action('practice-settings').then(()=>false,()=>true)),true);
  send({step:'try-it',practice:'stop',shortcut:'⌃⌥⇧9',firstCaptureRequired:true});
  await expect(page.getByRole('heading',{name:'Finish your capture.',exact:true})).toBeVisible();
  await expect(page.getByRole('figure', { name: 'Example: click the stop square to save your capture' })).toBeVisible();
  await expect(page.getByRole('button',{name:'Close guide'})).toBeVisible();
  send({step:'try-it',practice:'board-ink',practiceBoard:[100,100,720,540]});
  await expect(page.getByRole("heading", { name: "Whiteboard", exact: true })).toHaveCount(0);
  send({step:'try-it',practice:'note',firstCaptureRequired:true});
  await expect(page.locator('.native-coach')).toHaveAttribute('data-stage','screen-ink');
  await expect(page.getByRole('heading',{name:'Draw on your screen.',exact:true})).toBeVisible();
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','draw');
  assert.equal(await page.getByRole('textbox').count(),0,'the coach must not replace the real note editor');
  await page.emulateMedia({reducedMotion:'no-preference'});
  // The teaching preview reuses real controls but cannot dispatch capture actions.
  send({step:'try-it',practice:'whiteboard',platform:'linux',firstCaptureRequired:true});
  await expect(page.locator('.native-control')).toHaveAttribute('data-kind','whiteboard');
  assert.deepEqual(await page.locator('.native-pill-example [data-action]').evaluateAll(
    buttons => buttons.map(button => button.getAttribute('data-action')),
  ), ['finish', 'whiteboard', 'cancel']);
  await expect(page.locator('.native-pill-example .input-bloom, .native-pill-example .pill-doodles, .native-pill-example .clock')).toHaveCount(0);
  assert.equal(await page.locator('.native-pill-example .pill').evaluate(el=>Boolean(el.closest('[inert]'))),true);
  const beforePreview=output;
  await page.locator('.native-pill-example [data-action=whiteboard]').evaluate((el:HTMLElement)=>el.click());
  assert.equal(output,beforePreview,'the production markup is inert inside an example');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.native-pill-example').evaluate(el=>el.getAnimations({subtree:true}).length),0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  // Guides use the saved keys, finish once, and replay without invoking app actions.
  send({step:'try-it',practice:'retry',shortcut:'⌃⌘9',firstCaptureRequired:true});
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','record');
  assert.deepEqual(await page.locator('.native-gesture kbd').allTextContents(),['⌃','⌘','9']);
  const strip=await page.locator('.native-gesture').boundingBox();assert.ok(strip);
  assert.ok(strip.height<=80,'Keep the inline demonstration compact');
  const priorActions=output;
  assert.equal(await page.locator('.native-gesture').evaluate(el=>el.getAnimations({subtree:true}).every(a=>a.effect?.getTiming().iterations===Infinity)),true);
  await expect(page.getByRole('button',{name:'Replay shortcut guide',exact:true})).toHaveCount(0);
  assert.equal(output,priorActions,'Looping guides never drive app actions');
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
  await expect(page.locator('.native-gesture')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');

  send({step:'try-it',practice:'screen-ink',firstCaptureRequired:true});
  await expect(page.locator('.native-gesture')).toHaveAttribute('data-kind','draw');
  await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
  assert.equal(await page.locator('.native-gesture').evaluate(el=>el.getAnimations({subtree:true}).length),0);
  await expect(page.getByRole('button',{name:'Replay drawing guide',exact:true})).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'light'});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(720);
  await expect(page.locator('.native-coach')).toHaveAttribute('data-paired','true');
  await expect(page.locator('.native-coach h1')).toHaveCSS('font-size','36px');
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
  await expect(page.locator('.shortcut-test kbd')).toHaveText(['Super','Shift','Copilot']);
  const changeShortcut=page.getByRole('button',{name:'Change shortcut',exact:true});
  const useShortcut=page.getByRole('button',{name:'Use shortcut',exact:true});
  await expect(useShortcut).toBeDisabled();
  await changeShortcut.click();
  await expect.poll(()=>output).toContain('"action":"change-shortcut"');
  send({step:'shortcut',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:true});
  await expect(page.getByRole('status')).toHaveText('Shortcut detected.');
  await useShortcut.press('Enter');
  await expect.poll(()=>output).toContain('"action":"use-shortcut"');
  const beforeTrialAdvance=(output.match(/"action":"continue"/g)?.length??0);
  send({step:'try-it',practice:'start',firstCaptureRequired:true,shortcutChosen:true,shortcutTested:true});
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  assert.equal(await page.getByText(/Press .* to start recording/).count(),0);
  await expect(page.locator('.native-setup')).toBeVisible();
  await expect(page.locator('.native-coach')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>[innerWidth,innerHeight])).toEqual([760,600]);
  await expect(page.locator('.native-shortcut kbd')).toHaveText('⌃⌥⇧9');
  await expect(page.locator('.native-shortcut kbd')).toHaveCSS('font-size','40px');
  const pressFrame=async(time:number)=>page.locator('.native-shortcut kbd').evaluate((key,time)=>{
    for(const animation of key.getAnimations()){animation.pause();animation.currentTime=time}
    const style=getComputedStyle(key);return {transform:style.transform,background:style.backgroundColor};
  },time);
  const released=await pressFrame(0),pressed=await pressFrame(2000);
  assert.equal(pressed.transform,'matrix(1, 0, 0, 1, 0, 3)');
  assert.notEqual(pressed.background,released.background);
  await pressFrame(0);
  await page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).forEach(a=>a.finish()));
  const heading=await page.getByRole('heading',{name:'One more time.',exact:true}).boundingBox();assert.ok(heading);
  const keys=await page.locator('.native-shortcut kbd').boundingBox();assert.ok(keys);
  assert.ok(Math.abs(heading.x+heading.width/2-(keys.x+keys.width/2))<2,'heading and shortcut share a centre');
  assert.ok(Math.abs(keys.y-heading.y-heading.height-16)<=2);
  if(process.env.APPARENT_ONBOARDING_EVIDENCE){
    await fs.mkdir(process.env.APPARENT_ONBOARDING_EVIDENCE,{recursive:true});
    for(const scheme of schemes){
      await page.emulateMedia({colorScheme:scheme});
      await expect(page.locator('.native-setup')).toHaveCSS('background-color',scheme==='light'?'rgb(245, 240, 232)':'rgb(2, 1, 2)');
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      await page.screenshot({path:path.join(process.env.APPARENT_ONBOARDING_EVIDENCE,'one-more-time-'+scheme+'.png'),animations:'disabled'});
    }
  }
  assert.ok(Math.abs(keys.x+keys.width/2-380)<2,'keys are horizontally centered');
  assert.ok(Math.abs(keys.y+keys.height/2-260)<60,'keys are vertically centered in the compact setup');
  assert.equal(await page.locator('.native-setup section').evaluate(el=>el.scrollHeight>el.clientHeight),false);
  await expect(page.getByRole('button',{name:'Try a capture',exact:true})).toHaveCount(0);
  send({step:'try-it',practice:'screen',platform:'linux',firstCaptureRequired:true});
  await expect(page.getByRole('heading', { name: 'Choose your display.' })).toBeVisible();
  await expect(page.locator('.native-setup')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThan(760);
  send({step:'try-it',practice:null,firstCaptureRequired:true});
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>[innerWidth,innerHeight])).toEqual([760,600]);
  await page.setViewportSize({width:320,height:520});
  for(const scheme of schemes){
    await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
    await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeInViewport();
    await expect(page.locator('.native-shortcut kbd')).toBeInViewport();
    assert.equal(await page.locator('.native-shortcut-prompt').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.keyboard.press('Tab');
    await expect(page.locator('.native-setup')).toHaveCSS('background-color',scheme==='light'?'rgb(245, 240, 232)':'rgb(2, 1, 2)');
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    if(process.env.APPARENT_ONBOARDING_EVIDENCE)await page.screenshot({path:path.join(process.env.APPARENT_ONBOARDING_EVIDENCE,'one-more-time-320-'+scheme+'.png'),animations:'disabled'});
  }
  await page.setViewportSize({width:760,height:520});
  const fnEditor={externallyManaged:false,suggestedFn:{keyCode:63,modifiers:0,key:'Fn'}};
  send({step:'shortcut',platform:'macos',shortcutEditor:{...fnEditor,recording:true}});
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
    await expect(page.locator('.native-setup')).toHaveCSS('background-color',scheme==='light'?'rgb(245, 240, 232)':'rgb(32, 27, 36)');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`shortcut editor overflows at 320px in ${scheme} mode`);
    await expect(recorder).toBeInViewport();
    await screenshot(`shortcut-listening-320-${scheme}`);
  }
  await page.emulateMedia({colorScheme:'light'});
  const priorFnCount=(output.match(/"keyCode":63/g)||[]).length;
  await recorder.evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Fn',code:'Fn',metaKey:true,bubbles:true})));
  await expect(page.getByRole('alert')).toContainText('Press a different shortcut');
  await screenshot('shortcut-rejected-fn-modifier');
  assert.equal((output.match(/"keyCode":63/g)||[]).length,priorFnCount,'Fn with another modifier must not be accepted');
  await recorder.dispatchEvent('keydown',{key:'Fn',code:'Fn'});
  await expect.poll(()=>output).toContain('"keyCode":63,"modifiers":0,"key":"Fn"');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await screenshot('shortcut-fn-error-recovered');
  send({step:'shortcut',platform:'macos',shortcut:'Fn',shortcutChosen:true,shortcutTested:false,shortcutEditor:{...fnEditor,recording:false}});
  await expect(page.getByRole('heading',{name:'Test your recording shortcut.',exact:true})).toBeVisible();
  await expect(page.locator('.shortcut-test kbd')).toHaveText('fn');
  await screenshot('shortcut-accepted-fn');
  send({step:'shortcut',platform:'macos',shortcut:'Fn',shortcutChosen:true,shortcutEditor:{...fnEditor,recording:true}});
  await page.getByRole('group',{name:'Shortcut recorder'}).focus();
  await page.getByRole('group',{name:'Shortcut recorder'}).press('Control+Alt+k');
  await expect.poll(()=>output).toContain('"keyCode":40');
  await expect.poll(()=>output).toContain('"modifiers":6144');
  await page.getByRole('group',{name:'Shortcut recorder'}).evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'ß',code:'KeyS',altKey:true,bubbles:true})));
  await expect.poll(()=>output).toContain('"keyCode":1,"modifiers":2048,"key":"s"');
  await page.getByRole('group',{name:'Shortcut recorder'}).press('Tab');
  await expect(page.getByRole('button',{name:'Back',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Back',exact:true}).press('Enter');
  await expect.poll(()=>output).toContain('cancel-shortcut');

  await page.emulateMedia({reducedMotion:'reduce'});
  send({penPicker:true,penSelected:true,penRgb:[59,121,189]});
  await expect(page.getByRole('heading',{name:'Pick your pen.',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'blue pen',exact:true}).click();
  await expect.poll(()=>output).toContain('pen:blue:');
  const blueSaveId=receiptId(latestAction());
  send({penPicker:true,penSelected:true,penRgb:[59,121,189],penSaveId:blueSaveId});
  await expect.poll(()=>output.match(/"action":"continue"/g)?.length).toBe(beforeTrialAdvance+1);
  await expect(page.locator('.native-pond-frog')).toHaveCSS('animation-name','none');
  await page.setViewportSize({width:320,height:600});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'pen picker must reflow at 320 CSS pixels');
  await page.setViewportSize({width:760,height:600});

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
    await page.setViewportSize({width,height:600});
    await page.getByRole('button',{name:'blue pen',exact:true}).focus();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const pond=await page.locator('.native-puddle').boundingBox(),pickerSection=await page.locator('.native-setup section').boundingBox();
    assert.ok(pond&&pickerSection);
    assert.ok(pond.y+pond.height<=pickerSection.y+pickerSection.height-24,'the whole pond stays clear of the footer at normal and narrow widths');
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
    await page.setViewportSize({width,height:600});
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
  send({step:'try-it',practice:'locate',platform:'linux'});
  await expect(page.getByText('Right-click the tray icon. Open Latest Capture.', {exact:true})).toBeVisible();
  for(const width of [380,320])for(const scheme of schemes){
    await page.setViewportSize({width,height:440});
    await page.emulateMedia({colorScheme:scheme});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    if(process.env.APPARENT_ONBOARDING_EVIDENCE){await fs.mkdir(process.env.APPARENT_ONBOARDING_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_ONBOARDING_EVIDENCE,`locate-${scheme}-${width}.png`)});}
    const fit=await page.locator('.native-coach-content').evaluate(el=>({w:el.clientWidth,h:el.clientHeight,sw:el.scrollWidth,sh:el.scrollHeight}));
    assert.ok(fit.sw<=fit.w&&fit.sh<=fit.h,'Linux tray guidance must fit '+JSON.stringify({width,scheme,fit}));
  }

});
