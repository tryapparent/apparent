const {test}=require('node:test');
const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');

test('public copy waits for disclosure and rejects cancel and stale recording',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'public-pill-'));
 const app=await electron.launch({args:[path.resolve(__dirname,'../host.cts'),'--no-sandbox'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 t.after(async()=>{await app.close();await fs.rm(home,{recursive:true,force:true,maxRetries:3});});
 const page=await app.firstWindow(),sent=[];let stream='';
 app.process().stdout.on('data',data=>{stream+=data;let end;while((end=stream.indexOf('\n'))>=0){const line=stream.slice(0,end);stream=stream.slice(end+1);try{sent.push(JSON.parse(line));}catch{}}});
 const state={revision:1,phase:'completed',clock:'00:04',label:'Saved',warning:null,notice:null,reducedMotion:true,draggable:false,actions:[{id:'copy-link',label:'Copy link',enabled:true,selected:false,primary:false}]};
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async(_window,options)=>{globalThis.disclosure=options;return await new Promise(resolve=>{globalThis.answer=resolve;});};});
 const publish=async view=>await app.evaluate((_e,view)=>process.stdin.emit('data',JSON.stringify({type:'state',view})+'\n'),view);
 await publish(state);await page.getByRole('button',{name:'Copy link',exact:true}).click();
 await expect.poll(()=>app.evaluate(()=>!!globalThis.answer)).toBe(true);
 const disclosure=await app.evaluate(()=>globalThis.disclosure);assert.match(disclosure.message,/Anyone with this link/);assert.match(disclosure.detail,/not end-to-end encrypted/);
 assert.equal(sent.filter(x=>x.action==='copy-public-link').length,0);
 await app.evaluate(()=>globalThis.answer({response:0}));await expect(page.getByRole('button',{name:'Copy link',exact:true})).toBeEnabled();assert.equal(sent.filter(x=>x.action==='copy-public-link').length,0);
 await page.getByRole('button',{name:'Copy link',exact:true}).click();await publish({...state,revision:2});await app.evaluate(()=>globalThis.answer({response:1}));await expect(page.getByRole('button',{name:'Copy link',exact:true})).toBeEnabled();assert.equal(sent.filter(x=>x.action==='copy-public-link').length,0);
 await page.getByRole('button',{name:'Copy link',exact:true}).click();await app.evaluate(()=>globalThis.answer({response:1}));await expect.poll(()=>sent.filter(x=>x.action==='copy-public-link').length).toBe(1);
 assert.equal(sent.find(x=>x.action==='copy-public-link').revision,2);
});
