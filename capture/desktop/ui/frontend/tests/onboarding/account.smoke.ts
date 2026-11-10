// Real Electron renderer/bridge with synthetic native facts; not native acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {chromium, expect} = require('@playwright/test');

test('pending admission explains beta full and permits local continuation, cancellation and retry', {timeout:30000}, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'account-'));
  const child = spawn(require('electron'), [path.resolve(import.meta.dirname,'../..'), '--onboarding', '--remote-debugging-port=0', ...(process.platform==='linux'?['--no-sandbox']:[])], {
    env:{...process.env, APPARENT_UI_PROFILE:profile}, stdio:['pipe','pipe','pipe'],
  });
  let browser:any;
  t.after(async()=>{
    if(child.exitCode===null){
      const exited=new Promise(resolve=>child.once('exit',resolve));
      child.stdin.end('{"type":"close"}\n');
      const timer=setTimeout(()=>child.kill(),3000);
      await exited;clearTimeout(timer);
    }
    await browser?.close();await fs.rm(profile,{recursive:true,force:true});
  });
  const endpoint=await new Promise<string>((resolve,reject)=>{
    let log='';const timer=setTimeout(()=>reject(Error('No Electron endpoint')),10000);
    child.once('error',reject);
    child.once('exit',()=>{clearTimeout(timer);reject(Error('Electron exited'));});
    child.stderr.on('data',bytes=>{log+=bytes;const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
  browser=await chromium.connectOverCDP(endpoint);
  const context=browser.contexts()[0];const page=context.pages()[0]||await context.waitForEvent('page');
  let output='';child.stdout.on('data',bytes=>output+=bytes);
  const send=(account:unknown)=>child.stdin.write(JSON.stringify({type:'state',step:'welcome',rows:[],ready:true,index:0,count:5,testInstance:true,shortcut:'Ctrl+9',account})+'\n');
  send({status:'approval',userCode:'TEST-CODE',verificationUri:'https://example.test/connect/device?code=TEST-CODE'});
  await expect(page.getByText(/Signing in alone/)).toBeVisible();
  await expect(page.getByText(/Beta full\?/)).toBeVisible();
  assert.equal(await page.locator('.native-setup section').evaluate((element:HTMLElement)=>element.scrollHeight>element.clientHeight),false,'approval and local fallback fit the setup window');
  if(process.env.APPARENT_ACCOUNT_EVIDENCE) await page.screenshot({path:path.join(process.env.APPARENT_ACCOUNT_EVIDENCE,'account-pending.png')});
  assert.equal(await page.getByText('✓ Signed in.',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Set up locally',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"continue"');
  assert.doesNotMatch(output,/upload|consent/);
  await page.getByRole('button',{name:'Cancel sign-in',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"cancel-sign-in"');
  send({status:'signed-out'});
  await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();
  await expect.poll(()=>output).toContain('"action":"sign-in"');
  send({status:'failed',error:'expired'});
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByRole('button',{name:'Set up locally',exact:true})).toBeEnabled();
  send({status:'signed-in'});
  await expect(page.getByText('✓ Signed in.',{exact:true})).toBeVisible();
  await expect(page.getByText(/Uploads need separate permission/)).toBeVisible();
  if(process.env.APPARENT_ACCOUNT_EVIDENCE) await page.screenshot({path:path.join(process.env.APPARENT_ACCOUNT_EVIDENCE,'account-connected.png')});
});
