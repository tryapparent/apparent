import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {_electron:electron,expect}=require('@playwright/test');

test('running backend identity survives Electron launch, appearance and scrolling', {timeout:45000}, async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'build-ui-'));
  const expected=process.env.APPARENT_EXPECTED_BUILD_LABEL ?? '0.3.13 · abc1234 +modified';
  const application=await electron.launch({
    args:[path.resolve(import.meta.dirname,'../../electron/main.cjs'),'--no-sandbox'],
    cwd:home,
    env:{...process.env,HOME:home,
      APPARENT_RUNNING_BUILD_LABEL:process.env.APPARENT_EXPECTED_BUILD_LABEL ? process.env.APPARENT_RUNNING_BUILD_LABEL : expected},
  });
  t.after(async()=>{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
  const page=await application.firstWindow();
  assert.equal(await page.evaluate(()=>window.apparentBuild.read()),expected);
  const identity=expected.split(' · ')[1] ?? 'build unknown';
  const marker=page.locator('.apparent-build-identity');
  await expect(marker).toHaveText(identity);
  for(const theme of ['light','dark']) {
    await application.evaluate(({nativeTheme}:any,theme:string)=>{nativeTheme.themeSource=theme;},theme);
    await page.locator('.apparent-window-content').evaluate((element:HTMLElement)=>element.scrollTo(0,element.scrollHeight));
    await expect(marker).toBeVisible();
    assert.equal(await marker.evaluate((element:HTMLElement)=>{
      const r=element.getBoundingClientRect();
      return r.top>=0 && r.left>=0 && r.bottom<=innerHeight && r.right<=innerWidth &&
        getComputedStyle(element).pointerEvents==='none' && element.tabIndex<0;
    }),true);
  }
});
