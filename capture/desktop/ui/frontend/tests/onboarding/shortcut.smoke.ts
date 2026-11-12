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
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const profile = await mkdtemp(path.join(os.tmpdir(), 'shortcut-'));
  const child = spawn(require('electron'), [root, '--onboarding', '--remote-debugging-port=0',
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
  const send = (platform: string) => child.stdin.write(JSON.stringify({
    type:'state', step:'shortcut', platform, ready:true, rows:[], index:1, count:3,
    firstCaptureRequired:true, shortcutChosen:false, shortcutEditor:{recording:true},
  })+'\n');
  const recorder=page.getByRole('group',{name:'Shortcut recorder'});
  send('linux');
  await expect(recorder).toBeFocused();
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
  await expect(page.getByRole('alert')).toContainText('Fn is not available in this Linux shortcut recorder');
  for(const theme of ['light','dark'] as const){
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    for(const width of [760,320]){
      await page.setViewportSize({width,height:520});
      assert.equal(await page.locator('.native-setup').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      const cancel=page.getByRole('button',{name:'Cancel',exact:true});
      await cancel.focus();await expect(cancel).toBeFocused();
      const evidence=process.env.ANNOTATION_EVIDENCE;
      if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'shortcut-'+theme+'-'+width+'.png')});}
    }
  }
  await page.setViewportSize({width:760,height:520});
  output='';await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"cancel-shortcut"');
  output='';child.stdin.write(JSON.stringify({type:'desktop-shortcut',keyCode:201,modifiers:768,key:'Copilot'})+'\n');
  await page.waitForTimeout(100);assert.equal(output,'','cancel blocks late offers before provider state acknowledgement');
  send('macos');
  await expect(page.getByRole('button',{name:'Use Fn',exact:true})).toBeVisible();
  output='';
  child.stdin.write(JSON.stringify({type:'desktop-shortcut',keyCode:201,modifiers:768,key:'Copilot'})+'\n');
  await page.waitForTimeout(100);assert.equal(output,'','Mac does not accept Linux compositor callbacks');
  output='';await page.getByRole('button',{name:'Use Fn',exact:true}).click();
  await expect.poll(()=>output).toContain('"keyCode":63,"modifiers":0,"key":"Fn"');
  await recorder.focus();output='';
  await page.keyboard.down('Control');await page.keyboard.down('Shift');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('r');
  await expect.poll(()=>output).toContain('"keyCode":15,"modifiers":4608,"key":"r"');
  await page.keyboard.up('Shift');await page.keyboard.up('Control');
});
