const {test}=require('node:test');
const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');

test('shared pill reads captured activity, rests on stall, and respects live reduced motion',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-meter-'));
 const application=await electron.launch({args:[path.resolve(__dirname,'host.cjs'),'--no-sandbox'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 t.after(async()=>{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 const page=await application.firstWindow();
 await page.waitForFunction(()=>window.apparentPill);
 const view={revision:1,phase:'recording',clock:'00:12',label:'Recording',warning:null,notice:null,reducedMotion:false,draggable:false,inputWaveform:[0,.04,.1,.3,.16,.08,.02,0,0,.08,.5,.7,.2,.08,.02,0,0,.03,.1,.3,.02,.1,.5,.8],actions:[
 {id:'whiteboard',label:'Whiteboard',enabled:true,selected:false,primary:false},
 {id:'finish',label:'Finish',enabled:true,selected:false,primary:true},
 {id:'cancel',label:'Cancel',enabled:true,selected:false,primary:false}]};
 const publish=state=>application.evaluate((_e,state)=>{process.stdin.emit('data',JSON.stringify({type:'state',view:state})+'\n');process.stdin.emit('data','{"type":"activate"}\n');},state);
 const waveform=page.getByRole('img',{name:'Captured microphone waveform'});
 const barHeight=index=>waveform.locator('i').nth(index).evaluate(el=>el.getBoundingClientRect().height);
 const height=()=>barHeight(23);
 const silence={...view,inputWaveform:Array(24).fill(0)};
 await publish(silence);
 await expect(waveform).toBeVisible();
 await page.evaluate(()=>window.apparentPill.layout(1));
 await page.clock.install();
 await page.clock.pauseAt(Date.now()+60_000);
 await publish(view);
 await expect.poll(height).toBeGreaterThan(20);
 assert.equal(await page.locator('.meter i').count(),24);
 assert.equal(await page.locator('.meter').evaluate(el=>el.getBoundingClientRect().width),66);
 if(process.env.PILL_EVIDENCE)await page.screenshot({path:path.join(process.env.PILL_EVIDENCE,'input.png')});
 // A fresh PCM history advances the observed pulse left; no local timer shifts it.
 const advanced=[...view.inputWaveform.slice(1),0];
 await publish({...view,inputWaveform:advanced});
 await expect.poll(()=>barHeight(22)).toBeGreaterThan(20);
 await expect.poll(height).toBe(2);
 for(const colorScheme of ['light','dark']){
  await page.emulateMedia({colorScheme});await publish(view);
  await expect.poll(height).toBeGreaterThan(20);
  if(process.env.PILL_EVIDENCE)await page.screenshot({path:path.join(process.env.PILL_EVIDENCE,`${colorScheme}-waveform.png`)});
 }

 await page.clock.runFor(299);
 await expect.poll(height).toBeGreaterThan(20);
 await page.clock.runFor(21);
 await expect.poll(height).toBeLessThan(2.1);
 if(process.env.PILL_EVIDENCE)await page.screenshot({path:path.join(process.env.PILL_EVIDENCE,'stalled.png')});
 await publish(silence);
 await expect.poll(height).toBeLessThan(2.1);
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(waveform).toHaveAttribute('data-reduced','true');
 await publish(view);
 await expect(waveform).toHaveAttribute('data-active','true');
 await expect.poll(height).toBe(2);
 await page.clock.runFor(320);
 await expect(waveform).toHaveAttribute('data-active','false');
 await page.clock.resume();
 for(const colorScheme of ['light','dark']){
  await page.emulateMedia({colorScheme});await publish({...silence,reducedMotion:true});
  await application.evaluate(({screen})=>{const original=screen.getDisplayMatching.bind(screen);screen.getDisplayMatching=bounds=>{const display=original(bounds);return {...display,workArea:{...display.workArea,width:320}};};});
  await page.evaluate(()=>window.apparentPill.layout(1));
  await page.getByRole('button',{name:'Finish',exact:true}).focus();
  await expect(page.getByRole('button',{name:'Finish',exact:true})).toBeFocused();
  if(process.env.PILL_EVIDENCE)await page.screenshot({path:path.join(process.env.PILL_EVIDENCE,`${colorScheme}-narrow-reduced.png`)});
  assert.ok(await page.locator('main').evaluate(el=>el.getBoundingClientRect().width)<=320);
 }
 await publish({...view,revision:2,phase:'processing',inputWaveform:null});
 await expect(waveform).toHaveCount(0);
});
