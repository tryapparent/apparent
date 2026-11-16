const {test}=require('node:test');
const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');

test('public copy waits for disclosure and rejects cancel and stale recording',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'public-pill-'));
 const app=await electron.launch({args:[path.resolve(__dirname,'../host.cts'),'--no-sandbox'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 let heartbeat;
 t.after(async()=>{clearInterval(heartbeat);await app.close();await fs.rm(home,{recursive:true,force:true,maxRetries:3});});
 const page=await app.firstWindow(),sent=[];let stream='';
 app.process().stdout.on('data',data=>{stream+=data;let end;while((end=stream.indexOf('\n'))>=0){const line=stream.slice(0,end);stream=stream.slice(end+1);try{sent.push(JSON.parse(line));}catch{}}});
 const state={revision:1,phase:'completed',clock:'00:04',label:'Saved',warning:null,notice:null,reducedMotion:true,draggable:false,actions:[{id:'copy-link',label:'Copy link',enabled:true,selected:false,primary:false}]};
 let latest=state;
 const publish=async view=>{latest=view;await app.evaluate((_e,view)=>process.stdin.emit('data',JSON.stringify({type:'state',view})+'\n'),view);};
 const held=()=>sent.filter(x=>typeof x.sharingConfirmation==='boolean').at(-1);
 await publish(state);
 heartbeat=setInterval(()=>void publish(latest).catch(()=>{}),100);
 await assert.rejects(page.evaluate(()=>window.apparentPill.act(1,'confirm-public-link')));
 await page.getByRole('button',{name:'Copy link',exact:true}).click();
 const confirm=page.getByRole('button',{name:'Create public link',exact:true});
 await expect(confirm).toBeVisible();
 await expect.poll(held).toEqual({revision:1,sharingConfirmation:true});
 await expect(page.getByText('Anyone with this link can view this capture. Shared captures are not end-to-end encrypted.')).toBeVisible();
 assert.equal(sent.filter(x=>x.action==='copy-public-link').length,0);
 for(const colorScheme of ['dark','light']){
  await page.emulateMedia({colorScheme});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  if(process.env.APPARENT_PUBLIC_SHARE_PROOF){await fs.mkdir(process.env.APPARENT_PUBLIC_SHARE_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_PUBLIC_SHARE_PROOF,'confirmation-'+colorScheme+'.png')});}
 }
 // Reading consent must retain the presentation beyond ordinary completion.
 await new Promise(resolve=>setTimeout(resolve,16_000));
 await expect(confirm).toBeVisible();
 assert.deepEqual(held(),{revision:1,sharingConfirmation:true});
 await page.getByRole('button',{name:'Cancel sharing',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(confirm).toHaveCount(0);await expect(page.getByRole('alert')).toHaveCount(0);
 await expect.poll(held).toEqual({revision:1,sharingConfirmation:false});
 assert.equal(sent.filter(x=>x.action==='copy-public-link').length,0);
 await page.getByRole('button',{name:'Copy link',exact:true}).click();await expect(confirm).toBeVisible();
 await publish({...state,revision:2});await expect(confirm).toHaveCount(0);
 await expect.poll(held).toEqual({revision:1,sharingConfirmation:false});
 await assert.rejects(page.evaluate(()=>window.apparentPill.act(1,'confirm-public-link')));
 assert.equal(sent.filter(x=>x.action==='copy-public-link').length,0);
 await page.getByRole('button',{name:'Copy link',exact:true}).click();await expect(confirm).toBeVisible();
 await page.reload();await expect(confirm).toHaveCount(0);
 await expect.poll(held).toEqual({revision:2,sharingConfirmation:false});
 await assert.rejects(page.evaluate(()=>window.apparentPill.act(2,'confirm-public-link')));
 await page.getByRole('button',{name:'Copy link',exact:true}).click();await confirm.focus();await page.keyboard.press('Enter');
 await expect.poll(()=>sent.filter(x=>x.action==='copy-public-link').length).toBe(1);
 await expect.poll(held).toEqual({revision:2,sharingConfirmation:false});
 assert.equal(sent.find(x=>x.action==='copy-public-link').revision,2);
});
