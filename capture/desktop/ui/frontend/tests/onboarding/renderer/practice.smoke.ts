import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron,expect,type ElectronApplication} from '@playwright/test';
import type {Batch} from '../../../electron/onboarding/practice-host.ts';
test('production host alone reduces admitted practice; renderer intents wait for parent admission', {timeout:45000},async t=>{
 const profile=await mkdtemp(path.join(os.tmpdir(),'practice-host-'));
 let ownedChild:ChildProcessWithoutNullStreams|undefined;
 let application:ElectronApplication|undefined;
 t.after(async()=>{
  const owned=ownedChild;
  try{
   if(owned&&owned.pid&&owned.exitCode===null&&owned.signalCode===null){
    const exited=new Promise<void>(resolve=>owned.once('exit',()=>resolve()));
    const timer=setTimeout(()=>owned.kill('SIGKILL'),3000);
    try{owned.stdin.end();await exited;}finally{clearTimeout(timer);}
   }
  }finally{
   try{await application?.close();}finally{
    owned?.stdin.destroy();owned?.stdout.destroy();owned?.stderr.destroy();
    await rm(profile,{recursive:true,force:true});
   }
  }
 });
 application=await electron.launch({args:[fileURLToPath(new URL('../../../',import.meta.url)),'--onboarding',...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,APPARENT_UI_PROFILE:profile}});
 const child=application.process() as ChildProcessWithoutNullStreams;
 ownedChild=child;
 let output='';child.stdout.on('data',b=>output+=b);
 const page=await application.firstWindow();
 const send=(v:unknown)=>child.stdin.write(JSON.stringify(v)+'\n');
 send({type:'state',step:'try-it',rows:[],ready:true,platform:'linux',shortcut:'Test',practice:'start'});
 let seq=0,attempt=0;
 const batches:unknown[]=[];
 const batch=async(events:Batch['events'],reset=false)=>{if(reset)attempt++;const b={type:'practice-batch',version:1,source:'1',transport:'2',attempt:String(attempt),capture:String(attempt),sequence:String(++seq),intent:events.some(e=>e.type==='action')?String(seq):null,board:'real-owned-test-board',events};batches.push(b);send(b);await expect.poll(()=>output.split('\n').filter(Boolean).map(s=>JSON.parse(s)).some(v=>v.type==='practice-disposition'&&v.sequence===String(seq))).toBe(true);};
 const stage=async(expected:string)=>expect(page.locator('.native-coach')).toHaveAttribute('data-stage',expected);
 const evidence=process.env.APPARENT_ONBOARDING_EVIDENCE;
 const inspect=async(name:string)=>{await stage(name);for(const width of [380,320])for(const scheme of ['light','dark'] as const){await page.setViewportSize({width,height:540});await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});const fit=await page.locator('.native-coach-content').evaluate(el=>({w:el.scrollWidth<=el.clientWidth,h:el.scrollHeight<=el.clientHeight}));assert.deepEqual(fit,{w:true,h:true},name);const button=page.getByRole('button').first();if(await button.count()){await button.focus();assert.equal(await button.evaluate(e=>document.activeElement===e),true);}if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,`host-${name}-${scheme}-${width}.png`)});}}};
 await batch([{type:'selecting'}]);await inspect('screen');
 await batch([{type:'reset'},{type:'started'}],true);await inspect('whiteboard');
 await batch([{type:'whiteboard-visible',visible:true}]);await inspect('board-ink');
 await batch([{type:'ink',board:true,screen:4}]);await stage('screen-ink');
 for(const width of [720,320])for(const scheme of ['light','dark'] as const){
   await page.setViewportSize({width,height:540});await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await expect(page.getByRole('complementary',{name:'Trackpad drawing hint'})).toBeVisible();
   if(evidence)await page.screenshot({path:path.join(evidence,`host-screen-ink-${scheme}-${width}.png`)});
 }

 await batch([{type:'ink',board:false,screen:5}]);await inspect('stop');
 await batch([{type:'ink',board:false,screen:0},{type:'processing'}]);
 assert.equal(JSON.parse(output.trim().split('\n').at(-1)!).stage,'preparing');
 await expect.poll(()=>application!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
 await batch([{type:'saved',copied:true}]);await inspect('copied');
 const before=output;await page.getByRole('button',{name:'Paste into your agent',exact:true}).count().then(async count=>{if(count)await page.getByRole('button',{name:'Paste into your agent',exact:true}).press('Enter');else await page.evaluate(()=>window.nativeOnboarding.action('practice-paste'));});
 await expect.poll(()=>output.slice(before.length)).toContain('practice-paste');await stage('copied');
 await batch([{type:'action',action:'practice-paste'}]);await inspect('paste');
 await batch([{type:'action',action:'practice-pasted'}]);await inspect('locate');
 await batch([{type:'opened-latest'}]);await inspect('complete');
 // Renderer cannot manufacture facts through its existing preload action API.
 assert.equal(await page.evaluate(async()=>{try{await window.nativeOnboarding.action({type:'saved',copied:true} as unknown as string);return false;}catch{return true;}}),true);
 await batch([{type:'reset'},{type:'started'},{type:'processing'},{type:'saved',copied:false}],true);await inspect('copy-failed');
 await batch([{type:'action',action:'practice-locate'},{type:'opened-latest'}]);await inspect('retry');
 await batch([{type:'reset'},{type:'started'}],true);await stage('whiteboard');
 // A state projection cannot replace the trusted host's policy after adoption.
 send({type:'state',step:'try-it',rows:[],ready:true,practice:'complete'});await stage('whiteboard');
 child.stdin.end();await expect.poll(()=>child.exitCode).not.toBe(null);
});
