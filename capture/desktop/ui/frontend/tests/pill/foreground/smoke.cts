const {test}=require('node:test');
const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');

const actions=(copyLabel='Copy link',copyEnabled=false)=>[
 {id:'paste',label:'Paste',enabled:true,selected:false,primary:true},
 {id:'copy-link',label:copyLabel,enabled:copyEnabled,selected:false,primary:false},
 {id:'inspect',label:'Inspect',enabled:true,selected:false,primary:false},
 {id:'dismiss',label:'Dismiss',enabled:true,selected:false,primary:false},
];
const base={revision:1,phase:'completed',clock:'00:18',label:'Saved',warning:null,notice:null,reducedMotion:true,draggable:false,inputWaveform:null,
 actions:actions()};
const privatePath='/private/synthetic/capture.apparent';
const syntheticSecret='synthetic-secret-must-stay-private';

test('foreground upload states stay private, bounded, and use one authorized pill command',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-foreground-'));
 const application=await electron.launch({args:[path.resolve(__dirname,'../host.cts'),'--no-sandbox'],
  env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 t.after(async()=>{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 const page=await application.firstWindow(),sent=[];let stream='';
 application.process().stdout.on('data',data=>{stream+=data.toString();let end;while((end=stream.indexOf('\n'))>=0){const line=stream.slice(0,end);stream=stream.slice(end+1);try{sent.push(JSON.parse(line));}catch{}}});
 const evidence=process.env.APPARENT_FOREGROUND_EVIDENCE;
 if(evidence)await fs.mkdir(evidence,{recursive:true,mode:0o700});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 async function publish(state){
  await application.evaluate((_electron,state)=>process.stdin.emit('data',JSON.stringify({type:'state',view:state})+'\n'),state);
 }
 async function assertNoOverflow(label){
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  const bounds=await page.locator('main').boundingBox();assert.ok(bounds,label+' pill is rendered');
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  assert.ok(bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=viewport.width && bounds.y+bounds.height<=viewport.height,label+' pill fits its renderer window');
 }
 async function assertPrivate(){
  const text=await page.locator('body').innerText();
  assert.equal(text.includes(privatePath),false,'local capture paths stay private');
  assert.equal(text.includes(syntheticSecret),false,'credentials stay private');
  assert.equal(text.includes('https://connect.example.test'),false,'upload URLs stay private');
  assert.equal(JSON.stringify(sent).includes(privatePath),false);
  assert.equal(JSON.stringify(sent).includes(syntheticSecret),false);
 }

 await publish(base);
 await application.evaluate(()=>process.stdin.emit('data',JSON.stringify({type:'activate'})+'\n'));
 await expect(page.getByRole('button',{name:'Copy link',exact:true})).toBeVisible();
 await assertNoOverflow('normal workarea');
 if(evidence)await page.screenshot({path:path.join(evidence,'foreground-copy-link.png'),fullPage:true});

 const uploading={...base,revision:2,label:'Uploading… 42%',actions:actions('Cancel upload',true)};
 await publish(uploading);
 await expect(page.getByText(uploading.label,{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Cancel upload',exact:true})).toBeEnabled();
 await assertPrivate();
 await page.emulateMedia({colorScheme:'light'});
 const light=await page.locator('.pill-row').evaluate(element=>getComputedStyle(element).backgroundColor);
 if(evidence)await page.screenshot({path:path.join(evidence,'foreground-uploading-light.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'dark'});
 const dark=await page.locator('.pill-row').evaluate(element=>getComputedStyle(element).backgroundColor);
 assert.notEqual(dark,light,'the foreground pill follows the system light/dark theme');
 if(evidence)await page.screenshot({path:path.join(evidence,'foreground-uploading-dark.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'light'});
 await page.getByRole('button',{name:'Cancel upload',exact:true}).click();
 await expect.poll(()=>sent.filter(message=>message.action==='copy-link').length).toBe(1);
 assert.deepEqual(sent.filter(message=>message.action==='copy-link'),[{revision:2,action:'copy-link'}]);

 // The host uses the actual display workarea for placement and native sizing.
 // Narrow it to 640 DIP to exercise the same production bounds path on a usual
 // 800x600 Xvfb display without relying on a host-specific monitor layout.
 await application.evaluate(({screen})=>{
  const matching=screen.getDisplayMatching.bind(screen),nearest=screen.getDisplayNearestPoint.bind(screen);
  const narrow=display=>({...display,workArea:{...display.workArea,x:0,width:640}});
  screen.getDisplayMatching=bounds=>narrow(matching(bounds));
  screen.getDisplayNearestPoint=point=>narrow(nearest(point));
 });
 const failed={...base,revision:3,label:'Upload failed · recording saved locally',actions:actions('Retry upload',true)};
 await publish(failed);
 await expect(page.getByText(failed.label,{exact:true})).toBeVisible();
 const retry=page.getByRole('button',{name:'Retry upload',exact:true});
 await expect(retry).toBeEnabled();
 await assertNoOverflow('640px workarea');
 await assertPrivate();
 if(evidence)await page.screenshot({path:path.join(evidence,'foreground-failed.png'),fullPage:true});
 await retry.focus();
 await expect(retry).toBeFocused();
 if(evidence)await page.screenshot({path:path.join(evidence,'foreground-keyboard-focus.png'),fullPage:true});
 await page.keyboard.press('Enter');
 await expect.poll(()=>sent.filter(message=>message.action==='copy-link').length).toBe(2);
 assert.deepEqual(sent.filter(message=>message.action==='copy-link').at(-1),{revision:3,action:'copy-link'});

 const cancelled={...base,revision:4,label:'Upload cancelled · recording saved locally',actions:actions('Retry upload',true)};
 await publish(cancelled);
 await expect(page.getByText(cancelled.label,{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Retry upload',exact:true})).toBeEnabled();
 await assertNoOverflow('cancelled upload');
 await assertPrivate();
 if(evidence)await page.screenshot({path:path.join(evidence,'foreground-cancelled.png'),fullPage:true});

 const copied={...base,revision:5,label:'Link copied',actions:actions('Copy link',true)};
 await publish(copied);
 await expect(page.getByText('Link copied',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Copy link',exact:true})).toBeEnabled();
 await assertNoOverflow('successful upload');
 await assertPrivate();
 if(evidence)await page.screenshot({path:path.join(evidence,'foreground-link-copied.png'),fullPage:true});
 assert.deepEqual(errors,[]);
});
