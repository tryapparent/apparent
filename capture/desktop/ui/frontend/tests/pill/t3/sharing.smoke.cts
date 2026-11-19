const {test}=require('node:test');
const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path');const fs=require('node:fs/promises');

async function pickerGeometry(app,page){
 const pill=await page.locator('.destination-pill').boundingBox();
 assert.ok(pill);
 const host=await app.evaluate(({BrowserWindow})=>{
  const {x,y,width}=BrowserWindow.getAllWindows()[0].getBounds();
  return {x,y,width};
 });
 return {pill,host};
}

test('T3 destinations and public sharing coexist with explicit consent', {timeout:60000},async t=>{
 const {fixture}=await import('./testing/server.ts');const f=await fixture(t);
 const app=await electron.launch({args:[path.resolve(__dirname,'../host.cjs'),'--no-sandbox','--ozone-platform=x11'],env:{...process.env,APPARENT_CONFIG:f.config,HOME:f.home,XDG_CONFIG_HOME:path.join(f.home,'config')}});
 t.after(async()=>{await app.close().catch(()=>{});});
 // Consume the initial window before awaiting Linux's focusable replacement.
 await app.firstWindow();
 const sent=[];let buffer='';
 app.process().stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const message=JSON.parse(line);sent.push(message);if(message.ready)void app.evaluate((_e,id)=>process.stdin.emit('data',JSON.stringify({type:'activate',windowId:id})+'\n'),message.windowId).catch(()=>{});}catch{}}});
 let frame={type:'state',capture:'sharing',t3Eligible:true,view:{revision:1,phase:'completed',clock:'00:04',label:'Saved',warning:null,notice:null,reducedMotion:true,draggable:false,inputWaveform:null,noteCount:0,actions:[{id:'copy-link',label:'Public link',enabled:true,selected:false,primary:false}]}};
 const publish=()=>app.evaluate((_e,frame)=>process.stdin.emit('data',JSON.stringify(frame)+'\n'),frame);
 const replacement=process.platform==='linux'?app.waitForEvent('window'):null;
 await publish();const heartbeat=setInterval(()=>void publish().catch(()=>{}),100);t.after(()=>clearInterval(heartbeat));
 let page=replacement?await replacement:await app.firstWindow();
 const trigger=page.getByRole('combobox'),copy=page.getByRole('button',{name:'Public link',exact:true}),confirm=page.getByRole('button',{name:'Create public link',exact:true});
 await expect(trigger).toBeEnabled();await expect(copy).toBeEnabled();
 await expect.poll(()=>app.evaluate(({BrowserWindow})=>{const windows=BrowserWindow.getAllWindows();return windows.length===1&&windows[0].isVisible();})).toBe(true);
 if(process.platform==='linux')await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0],shape=w.setShape.bind(w);w.__sharingShape=[];w.setShape=rects=>{w.__sharingShape=rects;return shape(rects);};});
 for(const width of [1200,320]){
  await app.evaluate(({screen},width)=>{const matching=screen.getDisplayMatching.bind(screen);screen.getDisplayMatching=bounds=>{const display=matching(bounds);return {...display,workArea:{...display.workArea,width}};};},width);
  await page.evaluate(()=>window.apparentPill.layout(1));
  await expect.poll(()=>trigger.locator('.destination-label>span').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  for(const colorScheme of ['light','dark']){
   await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
   await expect.poll(()=>pickerGeometry(app,page).then(({pill,host})=>Math.ceil(pill.width)===host.width)).toBe(true);
   if(process.env.APPARENT_T3_PROOF){await fs.mkdir(process.env.APPARENT_T3_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_T3_PROOF,`completed-${width}-${colorScheme}.png`)});}
   const collapsed=await pickerGeometry(app,page);
   await trigger.click();await expect(trigger).toHaveAttribute('aria-expanded','true');
   await expect.poll(()=>pickerGeometry(app,page)).toEqual(collapsed);
   await page.keyboard.press('Escape');await expect(trigger).toHaveAttribute('aria-expanded','false');
   await copy.focus();await page.keyboard.press('Enter');await expect(confirm).toBeVisible();await expect(trigger).toBeDisabled();
   await assert.rejects(page.evaluate(()=>window.apparentPill.destinationAction('sharing','choose','new')));
   assert.equal(f.calls.length,0);assert.equal(sent.filter(x=>x.action==='copy-public-link').length,0);
   await expect.poll(()=>page.evaluate(()=>{const main=document.querySelector('main').getBoundingClientRect();return main.width<=innerWidth&&main.height<=innerHeight;})).toBe(true);
   if(process.platform==='linux'){
    const center=await confirm.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
    await expect.poll(()=>app.evaluate(({BrowserWindow},p)=>BrowserWindow.getAllWindows()[0].__sharingShape.some(r=>p.x>=r.x&&p.x<r.x+r.width&&p.y>=r.y&&p.y<r.y+r.height),center)).toBe(true);
   }
   if(process.env.APPARENT_T3_PROOF){await fs.mkdir(process.env.APPARENT_T3_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_T3_PROOF,`sharing-${width}-${colorScheme}.png`)});}
   await page.getByRole('button',{name:'Cancel sharing',exact:true}).focus();await page.keyboard.press('Enter');await expect(confirm).toHaveCount(0);await expect(trigger).toBeEnabled();
  }
 }
 // Confirming sends only the public-copy command, never a T3 submission.
 await copy.click();await confirm.focus();await page.keyboard.press('Enter');
 await expect.poll(()=>sent.filter(x=>x.action==='copy-public-link').length).toBe(1);assert.equal(f.calls.length,0);
 // Authoritative upload readback leaves cancel/retry available beside T3.
 frame={...frame,view:{...frame.view,revision:2,label:'Uploading…',actions:[{id:'copy-link',label:'Cancel upload',enabled:true,selected:false,primary:false}]}};await publish();
 await expect(page.getByRole('button',{name:'Cancel upload',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Cancel upload',exact:true}).click();await expect.poll(()=>sent.filter(x=>x.action==='copy-link').length).toBe(1);await expect(confirm).toHaveCount(0);
 frame={...frame,view:{...frame.view,revision:3,label:'Upload failed',actions:[{id:'copy-link',label:'Retry upload',enabled:true,selected:false,primary:false}]}};await publish();
 await page.getByRole('button',{name:'Retry upload',exact:true}).click();await expect(confirm).toBeVisible();
 frame={...frame,capture:'next',view:{...frame.view,revision:4,actions:[]}};await publish();await expect(confirm).toHaveCount(0);await expect(page.getByRole('button',{name:'Retry upload',exact:true})).toHaveCount(0);
 await assert.rejects(page.evaluate(()=>window.apparentPill.act(3,'confirm-public-link')));
 await app.evaluate(()=>process.stdin.emit('data',JSON.stringify({type:'handoff-ready',capture:'next',text:'Synthetic private recording handoff'})+'\n'));
 await expect(trigger).toBeEnabled();await trigger.focus();await page.keyboard.press('Enter');
 await expect.poll(()=>f.calls.length).toBe(1);await expect(page.getByRole('img',{name:'Submitted',exact:true})).toBeVisible();
});


test('picker warms both computers during recording and keeps the waiting state actionable',{timeout:60000},async t=>{
 let app;t.after(async()=>{await app?.close().catch(()=>{});});
 const {fixture}=await import('./testing/server.ts');const a=await fixture(t),b=await fixture(t);a.computer('X1');b.computer('Clanker');a.label('Apparent');b.label('Apparent');const resumeClanker=b.delayConfig();
 const credentials=origin=>({origin,token:'private-test-token',expiresAt:Date.now()+3600000});
 await fs.writeFile(a.config,JSON.stringify({t3:{...credentials(a.origin),connections:[credentials(b.origin)]},experiments:{t3DestinationPicker:true}}));
 app=await electron.launch({args:[path.resolve(__dirname,'../host.cjs'),'--no-sandbox','--ozone-platform=x11'],env:{...process.env,APPARENT_CONFIG:a.config,HOME:a.home}});
 let buffer='',finished=false;app.process().stdout.on('data',chunk=>{buffer+=String(chunk);let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const m=JSON.parse(line);if(m.ready)void app.evaluate((_e,id)=>process.stdin.emit('data',JSON.stringify({type:'activate',windowId:id})+'\n'),m.windowId).catch(()=>{});if(m.action==='finish')finished=true;}catch{}}});
 let page=await app.firstWindow();
 const frame={type:'state',capture:'names',t3Eligible:true,view:{revision:1,phase:'recording',clock:'00:04',label:'Recording',warning:null,notice:null,reducedMotion:true,draggable:false,inputWaveform:null,noteCount:0,actions:[{id:'finish',label:'Finish',enabled:true,selected:false,primary:true}]}};
 const send=value=>app.evaluate((_e,value)=>process.stdin.emit('data',JSON.stringify(value)+'\n'),value);
 await send(frame);const heartbeat=setInterval(()=>void send(frame).catch(()=>{}),500);t.after(()=>clearInterval(heartbeat));
 const finish=page.getByRole('button',{name:'Finish',exact:true});
 await expect(finish).toBeEnabled();
 await expect.poll(()=>[a.reads,b.reads]).toEqual([1,1]);
 assert.equal(await page.evaluate(()=>window.apparentPill.destinations()),null);
 assert.equal(a.calls.length+b.calls.length,0);
 const next=process.platform==='linux'?app.waitForEvent('window'):null;
 await finish.click();await expect.poll(()=>finished).toBe(true);
 frame.view={...frame.view,revision:2,phase:'processing',label:'Processing recording…',actions:[]};
 await send(frame);if(next)page=await next;
 const trigger=page.getByRole('combobox');await expect(trigger).toBeEnabled();
 const proof=async name=>{await page.evaluate(()=>document.fonts.ready);await expect.poll(()=>page.evaluate(()=>{const r=document.querySelector('main').getBoundingClientRect();return innerWidth===Math.ceil(r.width)&&innerHeight===Math.max(58,Math.ceil(r.height));})).toBe(true);if(process.env.APPARENT_T3_PROOF)await page.screenshot({path:path.join(process.env.APPARENT_T3_PROOF,name+'.png')});};
 await trigger.click();await expect(page.getByRole('option')).toHaveCount(3);
 await page.getByRole('option',{name:/Chosen thread, X1/}).click();
 await expect(page.getByRole('button',{name:'Cancel send'})).toBeVisible();assert.equal(a.calls.length+b.calls.length,0);
 await page.getByRole('button',{name:'Cancel send'}).click();
 resumeClanker();await expect.poll(()=>page.evaluate(async()=>(await window.apparentPill.destinations()).choices.length)).toBe(6);
 assert.deepEqual([a.reads,b.reads],[1,1]);
 await trigger.click();await proof('friendly-selecting');await page.getByRole('combobox',{name:'Search threads'}).fill('Clanker chosen');await expect(page.getByRole('option',{name:/Chosen thread, Clanker/})).toBeVisible();assert.equal(a.calls.length+b.calls.length,0);await expect(trigger).toBeFocused();await page.keyboard.press('Escape');await trigger.click();await page.getByRole('option',{name:/New thread, Clanker/}).click();await expect(page.locator('.destination-receipt')).toContainText('Preparing recording');await expect(trigger).toContainText('Clanker · Apparent');
 for(const theme of ['light','dark'])for(const width of [1200,320]){await app.evaluate(({screen},width)=>{screen.__pickerDisplay??=screen.getDisplayMatching.bind(screen);screen.getDisplayMatching=b=>({...screen.__pickerDisplay(b),workArea:{x:0,y:0,width,height:800}});},width);++frame.view.revision;await send(frame);await page.evaluate(revision=>window.apparentPill.layout(revision),frame.view.revision);await page.emulateMedia({colorScheme:theme});await proof('friendly-waiting-'+theme+'-'+width);}
 await page.getByRole('button',{name:'Cancel send',exact:true}).focus();await page.keyboard.press('Enter');await expect(trigger).toBeEnabled();assert.equal(a.calls.length,0);assert.equal(b.calls.length,0);
 for(const theme of ['light','dark'])for(const width of [1200,320]){
  await app.evaluate(({screen},width)=>{screen.__pickerDisplay??=screen.getDisplayMatching.bind(screen);screen.getDisplayMatching=b=>({...screen.__pickerDisplay(b),workArea:{x:0,y:0,width,height:800}});},width);
  ++frame.view.revision;await send(frame);await page.evaluate(revision=>window.apparentPill.layout(revision),frame.view.revision);await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  await proof('friendly-collapsed-'+theme+'-'+width);
  const collapsed=await pickerGeometry(app,page);
  await trigger.click();await expect(trigger).toHaveAttribute('aria-expanded','true');await expect(page.getByRole('option')).toHaveCount(6);
  await expect(page.getByRole('option',{name:/New thread, Clanker/})).toBeVisible();await expect(page.locator('main')).not.toContainText('127.0.0.1');await proof('friendly-expanded-'+theme+'-'+width);
  assert.deepEqual(await pickerGeometry(app,page),collapsed);
  await page.keyboard.press('Escape');await expect(trigger).toHaveAttribute('aria-expanded','false');await proof('friendly-reclosed-'+theme+'-'+width);
  assert.deepEqual(await pickerGeometry(app,page),collapsed);
 }
 await trigger.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(page.locator('.destination-receipt')).toContainText('Preparing recording');await send({type:'handoff-ready',capture:'names',text:'Synthetic name routing check'});
 await expect.poll(()=>b.calls.length).toBe(1);assert.equal(a.calls.length,0);
});
