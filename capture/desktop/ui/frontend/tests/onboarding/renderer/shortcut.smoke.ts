import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';

// Actual Electron transport/renderer with synthetic provider state.
// Native Copilot resolution and registration require isolated platform proof.
test('shortcut composition waits for modifiers and preserves Fn/cancel recovery', {timeout: 45000}, async t => {
  const require = createRequire(import.meta.url);
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const profile = await mkdtemp(path.join(os.tmpdir(), 'shortcut-'));
  const child = spawn(require('electron'), [path.join(root, 'dist/composition/onboarding/entry.cjs'), '--assets-root', root, '--remote-debugging-port=0',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
    env: {...process.env, APPARENT_UI_PROFILE: profile}, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  t.after(async () => {
    if (child.exitCode === null) {
      const done = new Promise(resolve => child.once('exit', resolve));
      child.stdin.end('{"type":"close"}\n');
      const timer = setTimeout(() => child.kill(), 3000);
      await done; clearTimeout(timer);
    }
    await browser?.close();
    await rm(profile, {recursive: true, force: true});
  });
  const endpoint = await new Promise<string>((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(Error('No Electron debugger endpoint')), 10000);
    child.once('error', reject);
    child.once('exit', () => {clearTimeout(timer); reject(Error('Electron exited'));});
    child.stderr.on('data', bytes => {
      log += bytes;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {clearTimeout(timer); resolve(match[1]);}
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page');
  let output = '';
  child.stdout.on('data', bytes => output += bytes);
  const send = (platform: 'linux'|'macos', patch: object={}) => child.stdin.write(JSON.stringify({
    type:'state', step:'shortcut', platform, ready:true, rows:[], index:1, count:3,
    shortcut:platform==='macos'?'Fn':'Ctrl+R', firstCaptureRequired:true, shortcutChosen:false,
    shortcutEditor:{recording:false}, ...patch,
  })+'\n');
  const recorder=page.getByRole('group',{name:'Shortcut recorder'});
  const change=page.getByRole('button',{name:'Change shortcut'});
  const confirm=page.getByRole('button',{name:'Use shortcut'});
  const back=page.getByRole('button',{name:'Back',exact:true});
  const evidence=process.env.ANNOTATION_EVIDENCE;
  if(evidence)await mkdir(evidence,{recursive:true});
  async function capture(state:string){
    for(const theme of ['light','dark'] as const)for(const width of [760,320]){
      await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
      await page.setViewportSize({width,height:width===760?600:520});
      assert.equal(await page.locator('.native-setup section').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      await expect(page.getByRole('heading')).toBeInViewport();
      await expect(back).toBeInViewport();
      if(state==='unsupported')await expect(page.getByRole('alert')).toBeInViewport({ratio:1});
      if(evidence)await page.screenshot({path:path.join(evidence,`${state}-${theme}-${width}.png`)});
    }
  }
  send('macos');
  await expect(page.locator('.shortcut-test kbd')).toHaveText('fn');
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole('button',{name:'Later',exact:true})).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  assert.equal(output,'','opening setup must not enable shortcut recording');
  await capture('waiting');
  send('macos',{shortcutChosen:true,shortcutTested:true});
  await expect(page.getByRole('status')).toHaveText('Shortcut detected.');
  await expect(confirm).toBeEnabled();
  await capture('detected');
  assert.equal(output,'','native detection must not advance setup');
  await confirm.press('Enter');
  await expect.poll(()=>output).toContain('"action":"use-shortcut"');

  output='';await change.press('Enter');
  await expect.poll(()=>output).toContain('"action":"change-shortcut"');
  send('macos',{shortcutEditor:{recording:true}});
  await expect(recorder).toBeFocused();
  await expect(page.getByRole('heading')).toHaveText('Choose a different shortcut.');
  await expect(page.getByText('Press the keys you want to use.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Show suggestions'})).toHaveCount(0);
  await capture('editing');
  await page.keyboard.press('Escape');
  await expect.poll(()=>output).toContain('"action":"cancel-shortcut"');
  send('macos',{shortcutChosen:true,shortcutTested:true});
  await expect(change).toBeFocused();
  await expect(confirm).toBeEnabled();

  send('linux',{shortcutEditor:{recording:true}});
  await recorder.focus();
  output='';
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await expect(page.getByRole('alert')).toHaveCount(0);
  assert.equal(output,'','modifiers do not submit or cancel');
  await recorder.dispatchEvent('keydown',{key:'F23',code:'F23',ctrlKey:true,shiftKey:true});
  await expect.poll(()=>output).toContain('"keyCode":201,"modifiers":4608,"key":"Copilot"');
  await page.keyboard.up('Shift');await page.keyboard.up('Control');
  output='';
  child.stdin.write(JSON.stringify({type:'desktop-shortcut',keyCode:201,modifiers:768,key:'Copilot'})+'\n');
  await expect.poll(()=>output).toContain('"keyCode":201,"modifiers":768,"key":"Copilot"');
  output='';
  await recorder.dispatchEvent('keydown',{key:'WakeUp',code:''});
  await expect.poll(()=>output).toContain('"keyCode":95,"modifiers":0,"key":"Fn"');
  output='';
  await recorder.dispatchEvent('keydown',{key:'\u0000',code:'',metaKey:true,shiftKey:true});
  await expect.poll(()=>output).toContain('"action":"resolve-copilot"');
  assert.equal(output.includes('"keyCode"'),false,'unknown input requires native confirmation');
  await recorder.dispatchEvent('keydown',{key:'Fn',code:'Fn'});
  await expect(page.getByRole('alert')).toContainText('Fn is unavailable here');
  await capture('unsupported');
  output='';await back.press('Enter');
  await expect.poll(()=>output).toContain('"action":"cancel-shortcut"');
  output='';child.stdin.write(JSON.stringify({type:'desktop-shortcut',keyCode:201,modifiers:768,key:'Copilot'})+'\n');
  await page.waitForTimeout(100);assert.equal(output,'','Back blocks late offers before provider acknowledgement');

  send('macos',{shortcutEditor:{recording:true}});
  await recorder.focus();
  output='';
  await recorder.dispatchEvent('keydown',{key:'Fn',code:'Fn'});
  await expect.poll(()=>output).toContain('"keyCode":63,"modifiers":0,"key":"Fn"');
  await recorder.dispatchEvent('keyup',{key:'Fn',code:'Fn'});
  output='';await page.keyboard.down('Alt');
  assert.equal(output,'');
  await page.keyboard.up('Alt');
  await expect.poll(()=>output).toContain('"keyCode":58,"modifiers":0,"key":"Option"');
  output='';await page.keyboard.down('Alt');await page.keyboard.press('r');await page.keyboard.up('Alt');
  await expect.poll(()=>output).toContain('"keyCode":15,"modifiers":2048,"key":"r"');
  assert.equal(output.includes('"key":"Option"'),false);
  output='';await page.keyboard.down('Alt');await page.mouse.wheel(0,120);await page.keyboard.up('Alt');
  await page.waitForTimeout(100);assert.equal(output,'','Option-scroll does not choose Option');

  send('macos',{shortcut:'⌥R',shortcutChosen:true});
  await expect(page.locator('.shortcut-test kbd')).toHaveText(['⌥','R']);
  await expect(confirm).toBeDisabled();
  assert.equal(output,'','a successful choice alone does not count as a trial');
  send('macos',{shortcut:'⌥R',shortcutChosen:true,shortcutTested:true});
  await expect(confirm).toBeEnabled();
  await capture('changed');
  send('macos',{shortcut:'⌥R',shortcutChosen:true,shortcutTested:true,step:'try-it',practice:'start'});
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  output='';await back.click();
  await expect.poll(()=>output).toContain('"action":"back"');
  output='';send('macos',{shortcut:'⌥R',shortcutChosen:true,shortcutTested:true});
  await expect(confirm).toBeEnabled();
  assert.equal(output,'','returning to the shortcut test waits for the user');
});
