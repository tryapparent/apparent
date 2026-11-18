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
  const suggestedFn = {keyCode:63,modifiers:0,key:'Fn'};
  const send = (platform: string) => child.stdin.write(JSON.stringify({
    type:'state', step:'shortcut', platform, ready:true, rows:[], index:1, count:3,
    firstCaptureRequired:true, shortcutChosen:false, shortcutEditor:{recording:true,suggestedFn:platform==='macos'?suggestedFn:null},
  })+'\n');
  const recorder=page.getByRole('group',{name:'Shortcut recorder'});
  send('linux');
  await expect(recorder).toBeFocused();
  const suggestions=page.getByRole('button',{name:'Show suggestions',exact:true});
  await suggestions.focus();await page.keyboard.press('Space');
  await expect(suggestions).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'Ctrl + Alt + R',exact:true})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(()=>output).toContain('"keyCode":82,"modifiers":6144,"key":"r"');
  await expect(suggestions).toHaveAttribute('aria-expanded','false');
  output='';await recorder.focus();
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
  await expect(page.getByRole('button',{name:'Choose suggested Fn shortcut',exact:true})).toBeVisible();
  output='';
  child.stdin.write(JSON.stringify({type:'desktop-shortcut',keyCode:201,modifiers:768,key:'Copilot'})+'\n');
  await page.waitForTimeout(100);assert.equal(output,'','Mac does not accept Linux compositor callbacks');
  const fnChoice=page.getByRole('button',{name:'Choose suggested Fn shortcut',exact:true});
  await fnChoice.focus();output='';
  await page.keyboard.down('Alt');await page.keyboard.up('Alt');
  await page.waitForTimeout(100);assert.equal(output,'','nested controls do not record a shortcut');
  await fnChoice.press('Enter');
  await expect.poll(()=>output).toContain('"keyCode":63,"modifiers":0,"key":"Fn"');
  output='';await fnChoice.click();
  await expect.poll(()=>output).toContain('"keyCode":63,"modifiers":0,"key":"Fn"');
  await recorder.focus();output='';
  await page.keyboard.down('Control');await page.keyboard.down('Shift');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('r');
  await expect.poll(()=>output).toContain('"keyCode":15,"modifiers":4608,"key":"r"');

  await page.keyboard.up('Shift');await page.keyboard.up('Control');
  await recorder.focus();output='';
  await page.keyboard.down('Alt');
  assert.equal(output,'');
  await page.keyboard.up('Alt');
  await expect.poll(()=>output).toContain('"keyCode":58,"modifiers":0,"key":"Option"');
  output='';await page.keyboard.down('Alt');await page.keyboard.press('r');await page.keyboard.up('Alt');
  await expect.poll(()=>output).toContain('"keyCode":15,"modifiers":2048,"key":"r"');
  assert.equal(output.includes('"key":"Option"'),false);
  output='';await page.keyboard.down('Alt');await page.keyboard.down('Shift');await page.keyboard.up('Shift');await page.keyboard.up('Alt');
  await page.waitForTimeout(100);assert.equal(output,'');
  await recorder.focus();output='';
  await page.keyboard.down('Alt');await page.mouse.wheel(0,120);await page.keyboard.up('Alt');
  await page.waitForTimeout(100);assert.equal(output,'','Option-scroll is not Option alone');
  for(const theme of ['light','dark'] as const)for(const width of [760,320]){
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    await page.setViewportSize({width,height:520});await recorder.focus();
    await page.keyboard.down('Alt');
    const evidence=process.env.ANNOTATION_EVIDENCE;
    if(evidence)await page.screenshot({path:path.join(evidence,'option-'+theme+'-'+width+'.png')});
    await page.keyboard.up('Alt');
  }

  // Back retains the native choice/test facts until the editor acknowledges a
  // new selection. Those facts must not immediately send Continue again.
  const chosen={type:'state',step:'shortcut',platform:'macos',ready:true,rows:[],index:1,count:3,
    firstCaptureRequired:true,shortcut:'Fn',shortcutChosen:true,shortcutTested:true,
    shortcutSelectionReleased:true,shortcutEditor:{recording:false,suggestedFn}};
  child.stdin.write(JSON.stringify({...chosen,step:'try-it',practice:'start'})+'\n');
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  output='';await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"back"');
  output='';child.stdin.write(JSON.stringify(chosen)+'\n');
  const evidence=process.env.ANNOTATION_EVIDENCE;
  if(evidence)await page.screenshot({path:path.join(evidence,'shortcut-returned.png')});
  await expect.poll(()=>output).toContain('"action":"change-shortcut"');
  assert.equal(output.includes('"action":"continue"'),false,'Back must wait for a fresh selection');
  child.stdin.write(JSON.stringify({...chosen,shortcutEditing:true,shortcutEditor:{recording:true,suggestedFn}})+'\n');
  await expect(recorder).toBeFocused();
  await expect(page.getByRole('heading',{name:'Choose your shortcut.',exact:true})).toBeVisible();
  for(const theme of ['light','dark'] as const){
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    for(const width of [760,320]){
      await page.setViewportSize({width,height:520});
      assert.equal(await page.locator('.native-setup').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      await page.getByRole('button',{name:'Choose suggested Fn shortcut',exact:true}).focus();
      await expect(page.getByRole('button',{name:'Choose suggested Fn shortcut',exact:true})).toBeFocused();
      if(evidence)await page.screenshot({path:path.join(evidence,`shortcut-retry-${theme}-${width}.png`)});
    }
  }
  await page.setViewportSize({width:760,height:520});
  output='';await page.getByRole('button',{name:'Choose suggested Fn shortcut',exact:true}).click();
  await expect.poll(()=>output).toContain('"keyCode":63,"modifiers":0,"key":"Fn"');
  output='';child.stdin.write(JSON.stringify({...chosen,shortcutTested:false})+'\n');
  await expect.poll(()=>output).toContain('"action":"accept-shortcut-choice:Fn"');
  assert.equal(output.includes('"action":"continue"'),false,'selection needs the native test acknowledgement');
  child.stdin.write(JSON.stringify(chosen)+'\n');
  await expect.poll(()=>output).toContain('"action":"continue"');

  send('macos');
  await expect(recorder).toBeVisible();
  await expect(page.getByText('Fn switches languages? Try another shortcut.',{exact:true})).toBeVisible();
  for(const theme of ['light','dark'] as const){
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    for(const width of [760,320]){
      await page.setViewportSize({width,height:600});
      await suggestions.scrollIntoViewIfNeeded();
      if(evidence)await page.screenshot({path:path.join(evidence,`suggestions-closed-${theme}-${width}.png`)});
      await suggestions.click();
      const alternative=page.getByRole('button',{name:'Control + Option + R',exact:true});
      await alternative.scrollIntoViewIfNeeded();
      await expect(alternative).toBeInViewport();
      await expect(page.getByRole('button',{name:'Control + Option + S',exact:true})).toBeInViewport();
      assert.equal(await page.locator('.native-setup section').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      if(evidence)await page.screenshot({path:path.join(evidence,`suggestions-open-${theme}-${width}.png`)});
      output='';await alternative.focus();await page.keyboard.press('Escape');
      await expect(suggestions).toBeFocused();
      await expect(suggestions).toHaveAttribute('aria-expanded','false');
      assert.equal(output,'','Escape closes suggestions without cancelling the recorder');
    }
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await suggestions.scrollIntoViewIfNeeded();await suggestions.click();
  for(const key of ['R','S']){
    const option=page.getByRole('button',{name:`Control + Option + ${key}`,exact:true});
    await option.scrollIntoViewIfNeeded();
    await expect(option).toBeInViewport({ratio:1});
  }
  assert.equal(await page.locator('.native-setup section').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  if(evidence)await page.screenshot({path:path.join(evidence,'suggestions-enlarged.png')});
  await page.keyboard.press('Escape');
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  await page.setViewportSize({width:760,height:600});
  await suggestions.click();output='';
  await page.getByRole('button',{name:'Control + Option + R',exact:true}).click();
  await expect.poll(()=>output).toContain('"keyCode":15,"modifiers":6144,"key":"r"');
  assert.equal(output.includes('"action":"continue"'),false,'suggestions do not bypass native validation');
  child.stdin.write(JSON.stringify({...chosen,shortcutChosen:false,shortcutTested:false,shortcutEditor:{recording:false,error:'That shortcut is already in use. Choose another shortcut.'}})+'\n');
  await expect(page.getByRole('alert')).toContainText('already in use');
  await suggestions.click();output='';
  await page.getByRole('button',{name:'Control + Option + S',exact:true}).click();
  await expect.poll(()=>output).toContain('"keyCode":1,"modifiers":6144,"key":"s"');
  assert.ok(output.indexOf('"action":"change-shortcut"')<output.indexOf('"keyCode":1'),'recovery starts listening before submitting another suggestion');
  child.stdin.write(JSON.stringify({...chosen,step:'try-it',practice:'start'})+'\n');
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  const acknowledgeBack=(bytes:Buffer)=>{
    if(bytes.toString().includes('"action":"back"'))child.stdin.write(JSON.stringify(chosen)+'\n');
  };
  child.stdout.on('data',acknowledgeBack);
  await suggestions.click();output='';
  if(evidence)await page.screenshot({path:path.join(evidence,'suggestions-practice.png')});
  await page.getByRole('button',{name:'Control + Option + R',exact:true}).click();
  await expect.poll(()=>output).toContain('"keyCode":15,"modifiers":6144,"key":"r"');
  await expect(page.getByRole('heading',{name:'One more time.',exact:true})).toBeVisible();
  await page.waitForTimeout(100);
  child.stdout.off('data',acknowledgeBack);
  const actions=output.trim().split('\n').map(line=>JSON.parse(line).action);
  assert.deepEqual(actions,['back','change-shortcut','shortcut'],'the practice prompt can reopen the real editor before choosing an alternative');
});
