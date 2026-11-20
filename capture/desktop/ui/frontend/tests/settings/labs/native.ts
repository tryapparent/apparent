// Rust owns the real writer; this driver relays the shipped private pipe.
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const timeout=setTimeout(()=>process.exit(1),30000);timeout.unref();
const home=await fs.mkdtemp(path.join(os.tmpdir(),'labs-native-'));
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const app=spawn(createRequire(import.meta.url)('electron') as string,
 ['--no-sandbox',frontend,'--settings-storage','--settings-labs','--settings-parent','--remote-debugging-port=0'],
 {env:{...process.env,ELECTRON_RUN_AS_NODE:'',HOME:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache')},stdio:'pipe'});
const parent=createInterface({input:process.stdin});parent.on('line',line=>app.stdin.write(line+'\n'));
app.stdout.on('data',chunk=>process.stdout.write(chunk));
const exited=new Promise<void>(resolve=>app.once('exit',()=>resolve()));
let browser:Awaited<ReturnType<typeof chromium.connectOverCDP>>|undefined;
try{
 const url=await new Promise<string>((resolve,reject)=>{
  let stderr='';app.stderr.on('data',chunk=>{stderr+=chunk.toString();const url=stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];if(url)resolve(url);});
  app.once('error',reject);app.once('exit',code=>reject(Error(`Labs exited ${code}: ${stderr.slice(-600)}`)));
 });
 browser=await chromium.connectOverCDP(url);const page=browser.contexts()[0].pages()[0];
 const agentContext=page.getByRole('switch',{name:'Recording context for agents'});
 await expect(agentContext).toHaveAttribute('aria-checked','false');
 for(const on of [true,false]){
  await agentContext.click();
  await expect(agentContext).toHaveAttribute('aria-checked',String(on));
  const saved=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  assert.equal(saved.experiments.agentContext,on);
  assert.equal(saved.experiments.other,true);
  assert.equal(saved.secret,'private');
  await page.reload();
  await expect(agentContext).toBeEnabled();
  await expect(agentContext).toHaveAttribute('aria-checked',String(on));
 }
 const speech=page.getByRole('switch',{name:'Transcript-only handoff'});
 await expect(speech).toBeEnabled();await expect(speech).toHaveAttribute('aria-checked','false');
 for(const on of [true,false]){
  await speech.click();
  await expect(speech).toHaveAttribute('aria-checked',String(on))
  const saved=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  assert.equal(saved.experiments.transcriptOnlyHandoff,on);assert.equal(saved.experiments.other,true);
  await page.reload();await expect(speech).toBeEnabled();await expect(speech).toHaveAttribute('aria-checked',String(on));
 }
 const compact=page.getByRole('switch',{name:'Compact recording prompts'});
 await expect(compact).toBeEnabled();await expect(compact).toHaveAttribute('aria-checked','false');
 for(const on of [true,false]){
  await compact.click();
  await expect(compact).toHaveAttribute('aria-checked',String(on))
  const saved=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  assert.equal(saved.experiments.compactHandoff,on);assert.equal(saved.experiments.other,true);
  await page.reload();await expect(compact).toBeEnabled();await expect(compact).toHaveAttribute('aria-checked',String(on));
 }
 const toggle=page.getByRole('switch',{name:'Live local transcription'});
 await expect(toggle).toHaveAttribute('aria-checked','false');await expect(toggle).toBeEnabled();
 for(const on of [true,false]){
  await toggle.click();await expect(toggle).toHaveAttribute('aria-checked',String(on));
  const saved=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  assert.equal(saved.experiments.localStreamingTranscription,on);assert.equal(saved.experiments.other,true);assert.equal(saved.secret,'private');
  await page.reload();await expect(toggle).toBeEnabled();await expect(toggle).toHaveAttribute('aria-checked',String(on));
 }
 await expect(page.getByRole('switch',{name:'Send recordings to T3 Code'})).toHaveCount(0);
 const sharing=page.getByRole('switch',{name:'Public sharing links'});
 for(const on of [true,false]){
  await sharing.click();await expect(sharing).toHaveAttribute('aria-checked',String(on));
  const saved=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  assert.equal(saved.experiments.hostedSharing,on);assert.equal(saved.experiments.localStreamingTranscription,false);
  assert.equal(saved.experiments.other,true);assert.equal(saved.secret,'private');
  await page.reload();await expect(sharing).toBeEnabled();await expect(sharing).toHaveAttribute('aria-checked',String(on));
 }
 const autoPaste=page.getByRole('switch',{name:'Auto paste',exact:true});
 await expect(autoPaste).toHaveAccessibleDescription(/supported Hyprland|Unavailable in this session/);
 if(await autoPaste.isEnabled()){
  for(const on of [true,false]){
   await autoPaste.click();await expect(autoPaste).toHaveAttribute('aria-checked',String(on));
   const saved=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
   assert.equal(saved.experiments.autoPasteDraft,on);assert.equal(saved.experiments.localStreamingTranscription,false);
   assert.equal(saved.experiments.other,true);assert.equal(saved.secret,'private');
   await page.reload();await expect(autoPaste).toBeEnabled();await expect(autoPaste).toHaveAttribute('aria-checked',String(on));
  }
 }else await expect(autoPaste).not.toBeChecked();
 const wispr=page.getByRole('switch',{name:'Dictation app conflicts',exact:true});
 await expect(wispr).toHaveAttribute('aria-checked','false');
 if(process.platform==='darwin'){
  for(const on of [true,false]){
   await wispr.click();await expect(wispr).toHaveAttribute('aria-checked',String(on));
   const saved=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
   assert.equal(saved.experiments.onboardingWisprFlow,on);assert.equal(saved.experiments.localStreamingTranscription,false);
   assert.equal(saved.secret,'private');assert.equal(saved.experiments.other,true);
   await page.reload();await expect(wispr).toBeEnabled();await expect(wispr).toHaveAttribute('aria-checked',String(on));
  }
 }else await expect(wispr).toBeDisabled();
}finally{
 await browser?.close().catch(()=>{});if(app.exitCode===null){app.kill('SIGTERM');await exited;}
 parent.close();process.stdin.destroy();await fs.rm(home,{recursive:true,force:true});clearTimeout(timeout);
}
