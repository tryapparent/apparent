const {test}=require('node:test');const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');const path=require('node:path');const fs=require('node:fs/promises');
test('real pill keeps Paste by default, then selects during processing and dispatches through main only', {timeout:60000},async t=>{
 // Close Electron before fixture teardown waits for sockets and removes its HOME.
 let app; t.after(async()=>{await app?.close().catch(()=>{});});
 const {fixture}=await import('./testing/server.ts');const f=await fixture(t);f.many();await f.save(false);
 app=await electron.launch({args:[path.resolve(__dirname,'../host.cjs'),'--no-sandbox','--ozone-platform=x11',`--force-device-scale-factor=${process.env.APPARENT_T3_SCALE??'1'}`],env:{...process.env,APPARENT_CONFIG:f.config,HOME:f.home,XDG_CONFIG_HOME:path.join(f.home,'config'),HYPRLAND_INSTANCE_SIGNATURE:'focus-test'}});
 let page=await app.firstWindow();
 const initialWindowId=await app.evaluate(({BrowserWindow})=>Number(BrowserWindow.getAllWindows()[0].getMediaSourceId().split(':')[1]));

 let parentBuffer='',holdActivation=false;const readyIds=[],releasedIds=[];
 const activate=id=>app.evaluate((_electron,id)=>process.stdin.emit('data',JSON.stringify({type:'activate',windowId:id})+'\n'),id);
 app.process().stdout.on('data',chunk=>{parentBuffer+=String(chunk);let end;while((end=parentBuffer.indexOf('\n'))>=0){const line=parentBuffer.slice(0,end);parentBuffer=parentBuffer.slice(end+1);try{const message=JSON.parse(line);if(message.ready){readyIds.push(message.windowId);if(!holdActivation)void activate(message.windowId).catch(()=>{});}if(message.releasePickerFocus)releasedIds.push(message.releasePickerFocus);}catch{}}});
 async function proofThemes(name){for(const colorScheme of ['dark','light']){await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await proof(name+'-'+colorScheme);}}
 async function proof(name){await page.evaluate(()=>document.fonts.ready);await expect.poll(()=>page.evaluate(()=>{const r=document.querySelector('main')!.getBoundingClientRect();return innerWidth===Math.ceil(r.width)&&innerHeight===Math.max(58,Math.ceil(r.height));})).toBe(true);if(process.env.APPARENT_T3_PROOF){await fs.mkdir(process.env.APPARENT_T3_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_T3_PROOF,name+'.png')});}}

 let frame={type:'state',capture:'off',t3Eligible:true,view:{revision:1,phase:'completed',clock:'00:04',label:'Saved',warning:null,notice:null,reducedMotion:true,draggable:false,inputWaveform:null,noteCount:0,actions:[{id:'paste',label:'Paste',enabled:true,selected:false,primary:true},{id:'dismiss',label:'Dismiss',enabled:true,selected:false,primary:false}]}};
 const publish=async()=>app.evaluate((_electron,frame)=>process.stdin.emit('data',JSON.stringify(frame)+'\n'),frame);
 if(process.platform==='linux')await app.evaluate(({BrowserWindow})=>{
  const contents=BrowserWindow.getAllWindows()[0].webContents,execute=contents.executeJavaScript.bind(contents),until=Date.now()+300;
  contents.executeJavaScript=(source,...args)=>{
   if(source.includes('--pill-limit'))return new Promise(resolve=>setTimeout(resolve,Math.max(0,until-Date.now()))).then(()=>execute(source,...args));
   return execute(source,...args);
  };
 });
 await publish();const heartbeat=setInterval(()=>void publish().catch(()=>{}),500);t.after(()=>clearInterval(heartbeat));
 await expect(page.getByRole('button',{name:'Paste',exact:true})).toBeVisible();assert.equal(f.reads,0);
 if(process.platform==='linux'){
  await expect.poll(()=>readyIds.length).toBe(1);
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
 }
 holdActivation=process.platform==='linux';const oldPage=page;
 const pickerWindow=process.platform==='linux'?app.waitForEvent('window'):null;
 await f.save(true);frame={...frame,capture:'on',view:{...frame.view,revision:2,phase:'processing',label:'Processing recording…',actions:[]}};await publish();
 if(pickerWindow)page=await pickerWindow;
 if(pickerWindow){
  const replacementWindowId=await app.evaluate(({BrowserWindow},initialId)=>Number(BrowserWindow.getAllWindows().find(w=>Number(w.getMediaSourceId().split(':')[1])!==initialId).getMediaSourceId().split(':')[1]),initialWindowId);
  await expect.poll(()=>readyIds.includes(replacementWindowId)).toBe(true);
  await activate(initialWindowId);assert.equal(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>Number(w.getMediaSourceId().split(':')[1])===id).isVisible(),replacementWindowId),false,'stale activation cannot expose the replacement');
  await activate(replacementWindowId);holdActivation=false;await expect.poll(()=>oldPage.isClosed()).toBe(true);
 }
 const trigger=page.getByRole('combobox');const search=page.getByRole('combobox',{name:'Search threads'});const list=page.getByRole('listbox'),options=page.getByRole('option');const fade=page.locator('.destination-fade');await expect(trigger).toBeEnabled();await expect(trigger).toBeFocused();
 // Destination data may arrive after the capture revision. Replacing the
 // ordinary pill must retain native sizing for subsequent tray expansion.
 const destination=await page.evaluate(()=>window.apparentPill.destinations());
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('pill:destinations',null));
 await expect(page.locator('.pill-row')).toBeVisible();await proof('destination-pending');
 await app.evaluate(({BrowserWindow},value)=>BrowserWindow.getAllWindows()[0].webContents.send('pill:destinations',value),destination);
 await expect(trigger).toBeEnabled();await trigger.focus();
 await page.keyboard.press('ArrowDown');await expect(search).toBeFocused();await expect(options).toHaveCount(6);await expect(fade).toBeVisible();
 await list.hover();await page.mouse.wheel(0,700);await expect(fade).toHaveCount(0);
 await proofThemes('processing-expanded');
 assert.ok((await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds())).height>160,'native window must fit the expanded tray');
 await page.keyboard.press('Escape');await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(trigger).toContainText('New thread');assert.equal(f.calls.length,0);
 await trigger.press('c');await search.fill('chosen');
 await proofThemes('search');
 await search.press('Enter');await expect(page.getByRole('button',{name:/Will send when ready/})).toBeVisible();assert.equal(f.calls.length,0);
 if(process.platform==='linux')await expect.poll(()=>releasedIds).toEqual([readyIds.at(-1)]);
 const handoff='PRIVATE exact recording handoff';await app.evaluate((_electron,args)=>process.stdin.emit('data',JSON.stringify({type:'handoff-ready',capture:'on',text:args})+'\n'),handoff);
 frame={...frame,view:{...frame.view,revision:3,phase:'completed',label:'Saved',actions:[{id:'paste',label:'Paste',enabled:true,selected:false,primary:true}]}};await publish();
 await expect.poll(()=>f.calls.length).toBe(1);await expect(trigger).toBeDisabled();assert.equal(f.calls[0].payload.threadId,'thread');assert.equal(f.calls[0].payload.text,handoff);assert.equal(await page.evaluate(()=>document.body.textContent.includes('PRIVATE')),false);
 await page.reload();await expect(trigger).toBeDisabled();assert.equal(f.accepted.size,1);
 frame={...frame,capture:'retry',view:{...frame.view,revision:4}};await publish();await expect(trigger).toContainText('Chosen thread');await app.evaluate(()=>process.stdin.emit('data',JSON.stringify({type:'handoff-ready',capture:'retry',text:'COPY THIS EXACT HANDOFF'})+'\n'));
 f.lose();await trigger.click();await search.fill('settled');await expect(options).toHaveCount(1);
 await search.press('Enter');await expect(page.getByRole('alert')).toContainText('Delivery not confirmed');
 if(process.platform==='linux')assert.equal(releasedIds.length,1);
 await expect(page.locator('.destination-confirmed')).toContainText('Settled onboarding notes');
 assert.equal(f.calls[1].payload.threadId,'settled');
 await page.getByRole('button',{name:'Copy recording',exact:true}).click();await expect(page.getByText('Copied',{exact:true})).toBeVisible();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'COPY THIS EXACT HANDOFF');
 await proofThemes('error');
 const retry=page.getByRole('button',{name:'Retry same send',exact:true});await expect(retry).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByRole('img',{name:'Submitted',exact:true})).toBeVisible();await expect.poll(()=>f.calls.length).toBe(3);assert.equal(f.accepted.size,2);assert.deepEqual(f.calls[1],f.calls[2]);
 if(process.platform==='linux')await expect.poll(()=>releasedIds).toEqual([readyIds.at(-1),readyIds.at(-1)]);
 await app.evaluate(({screen})=>{const matching=screen.getDisplayMatching.bind(screen);screen.getDisplayMatching=(bounds)=>{const display=matching(bounds);return {...display,workArea:{...display.workArea,width:320}};};});
 frame={...frame,capture:'narrow',view:{...frame.view,revision:5}};await publish();await expect(trigger).toBeEnabled();await trigger.focus();await page.keyboard.press('ArrowDown');
 const firstTray=await page.locator('.destination-tray').boundingBox();
 for(let i=0;i<5;i++)await search.press('ArrowDown');
 await expect(options.last()).toHaveAttribute('aria-selected','true');
 await proofThemes('narrow-expanded');
 assert.ok(firstTray.width<=320);
 assert.deepEqual(await page.locator('.destination-tray').boundingBox(),firstTray);
 await expect(fade).toHaveCount(0);
 if(process.platform==='linux'){
  // Opening/closing the tray changes geometry without changing the capture's
  // parent revision. A stale paint completion must not clip the newer list.
  await page.evaluate(revision=>window.apparentPill.layout(revision),frame.view.revision);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0],shape=w.setShape.bind(w);w.__pickerShapes=[];w.setShape=rects=>{w.__pickerShapes.push(rects);return shape(rects);};});
  await page.evaluate(()=>{window.__originalPickerFrame=window.requestAnimationFrame;window.__pickerFrames=[];window.requestAnimationFrame=callback=>window.__pickerFrames.push(callback);});
  await page.keyboard.press('Escape');
  await expect.poll(async()=>{const height=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds().height),body=await page.locator('main').boundingBox();return !!body&&height>=body.height&&height<=Math.ceil(body.height)+3;}).toBe(true);
  await trigger.focus();await page.keyboard.press('ArrowDown');await expect(options).toHaveCount(6);
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds().height)).toBeGreaterThan(160);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].__pickerShapes.every(shape=>shape.length===1)),true);
  await page.evaluate(async revision=>{for(let i=0;i<8;i++){for(const callback of window.__pickerFrames.splice(0))callback(performance.now());await new Promise(r=>setTimeout(r,10));}window.requestAnimationFrame=window.__originalPickerFrame;await window.apparentPill.layout(revision);},frame.view.revision);
  const masks=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {height:w.getBounds().height,rounded:w.__pickerShapes.filter(shape=>shape.length>1).map(shape=>Math.max(...shape.map(r=>r.y+r.height)))};});
  assert.ok(masks.rounded.length>0);assert.ok(masks.rounded.every(height=>Math.abs(height-masks.height)<=2),'only the current list size may restore the rounded mask, allowing X11 fractional-DPI rounding');
 }
 assert.equal(await page.evaluate(async()=>{try{await fetch('https://example.com');return false;}catch{return true;}}),true);
 const reads=f.reads,returning=process.platform==='linux'?app.waitForEvent('window'):null;
 await f.save(false);frame={...frame,capture:'off-next',view:{...frame.view,revision:6}};await publish();if(returning)page=await returning;
 await expect(page.getByRole('button',{name:'Paste',exact:true})).toBeVisible();await expect.poll(()=>app.windows().length).toBe(1);assert.equal(f.reads,reads);
 if(returning)assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFocusable()),false,'turning off restores the original non-focusable recording role');
});

test('enabled unpaired pill opens Labs through the native pipe and can copy the kept recording', {timeout:30000},async t=>{
 // Close Electron before fixture teardown waits for sockets and removes its HOME.
 let app; t.after(async()=>{await app?.close().catch(()=>{});});
 const {fixture}=await import('./testing/server.ts');const f=await fixture(t);
 await fs.writeFile(f.config,JSON.stringify({experiments:{t3DestinationPicker:true}}));
 app=await electron.launch({args:[path.resolve(__dirname,'../host.cjs'),'--no-sandbox','--ozone-platform=x11'],env:{...process.env,APPARENT_CONFIG:f.config,HOME:f.home}});
 let page=await app.firstWindow(),buffer='',setup=false;
 app.process().stdout.on('data',chunk=>{buffer+=String(chunk);let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const value=JSON.parse(line);if(value.ready)void app.evaluate((_electron,id)=>process.stdin.emit('data',JSON.stringify({type:'activate',windowId:id})+'\n'),value.windowId).catch(()=>{});if(value.action==='settings-labs')setup=true;}catch{}}});
 const frame={type:'state',capture:'unpaired',t3Eligible:true,view:{revision:1,phase:'completed',clock:'00:04',label:'Saved',warning:null,notice:null,reducedMotion:true,draggable:false,inputWaveform:null,noteCount:0,actions:[{id:'paste',label:'Paste',enabled:true,selected:false,primary:true}]}};
 const next=process.platform==='linux'?app.waitForEvent('window'):null;
 const publish=()=>app.evaluate((_electron,value)=>process.stdin.emit('data',JSON.stringify(value)+'\n'),frame);
 await publish();const heartbeat=setInterval(()=>void publish().catch(()=>{}),500);t.after(()=>clearInterval(heartbeat));if(next)page=await next;
 await expect(page.getByRole('button',{name:'Connect T3',exact:true})).toBeVisible();await expect(page.getByRole('combobox')).toHaveCount(0);assert.equal(f.reads,0);
 await page.getByRole('button',{name:'Connect T3',exact:true}).click();await expect.poll(()=>setup).toBe(true);
 await app.evaluate(()=>process.stdin.emit('data',JSON.stringify({type:'handoff-ready',capture:'unpaired',text:'Kept synthetic recording'})+'\n'));
 await page.getByRole('button',{name:'Copy instead',exact:true}).click();await expect(page.getByText('Copied',{exact:true})).toBeVisible();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'Kept synthetic recording');assert.equal(f.calls.length,0);
 if(process.env.APPARENT_T3_PROOF)for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.screenshot({path:path.join(process.env.APPARENT_T3_PROOF,'unpaired-'+colorScheme+'.png')});}
});

test('a first Enter and a mouse selection both launch New thread when it is the only destination',{timeout:30000},async t=>{
 // Close Electron before fixture teardown waits for sockets and removes its HOME.
 let app; t.after(async()=>{await app?.close().catch(()=>{});});
 const {fixture}=await import('./testing/server.ts');const f=await fixture(t);f.empty();
 app=await electron.launch({args:[path.resolve(__dirname,'../host.cjs'),'--no-sandbox','--ozone-platform=x11'],env:{...process.env,APPARENT_CONFIG:f.config,HOME:f.home}});
 let buffer='';app.process().stdout.on('data',chunk=>{buffer+=String(chunk);let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const message=JSON.parse(line);if(message.ready)void app.evaluate((_electron,id)=>process.stdin.emit('data',JSON.stringify({type:'activate',windowId:id})+'\n'),message.windowId).catch(()=>{});}catch{}}});
 const send=value=>app.evaluate((_electron,value)=>process.stdin.emit('data',JSON.stringify(value)+'\n'),value);
 let frame={type:'state',capture:'keyboard',t3Eligible:true,view:{revision:1,phase:'completed',clock:'00:04',label:'Saved',warning:null,notice:null,reducedMotion:true,draggable:false,inputWaveform:null,noteCount:0,actions:[]}};
 // Linux replaces the ordinary pill with a focusable picker window. Observe
 // that replacement before publishing; the initial page can close mid-query.
 let page=await app.firstWindow();const next=process.platform==='linux'?app.waitForEvent('window'):null;
 await send(frame);const heartbeat=setInterval(()=>void send(frame).catch(()=>{}),500);t.after(()=>clearInterval(heartbeat));
 if(next)page=await next;await expect(page.getByRole('combobox')).toBeVisible();
 const trigger=()=>page.getByRole('combobox');await expect(trigger()).toBeFocused();
 await send({type:'handoff-ready',capture:'keyboard',text:'Synthetic first Enter'});await page.keyboard.press('Enter');await expect.poll(()=>f.calls.length).toBe(1);assert.equal(f.calls[0].tag,'orchestration.launchThread');
 frame={...frame,capture:'mouse',view:{...frame.view,revision:2}};await send(frame);await expect(trigger()).toBeEnabled();await send({type:'handoff-ready',capture:'mouse',text:'Synthetic mouse choice'});
 await trigger().click();await expect(page.getByRole('option')).toHaveCount(1);await page.getByRole('option').click();await expect.poll(()=>f.calls.length).toBe(2);assert.equal(f.calls[1].tag,'orchestration.launchThread');
});

test('a confirmed T3 send keeps its tab and stays centered on the next recording', {timeout:60000},async t=>{
 let app;t.after(async()=>{await app?.close().catch(()=>{});});
 const {fixture}=await import('./testing/server.ts');const f=await fixture(t);await f.save(true);
 app=await electron.launch({args:[path.resolve(__dirname,'../host.cjs'),'--no-sandbox','--ozone-platform=x11'],env:{...process.env,APPARENT_CONFIG:f.config,HOME:f.home}});
 let buffer='';
 app.process().stdout.on('data',chunk=>{
  buffer+=String(chunk);let end;
  while((end=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
   try{const message=JSON.parse(line);if(message.ready)void send({type:'activate',windowId:message.windowId}).catch(()=>{});}catch{}
  }
 });
 const send=value=>app.evaluate((_electron,value)=>process.stdin.emit('data',JSON.stringify(value)+'\n'),value);
 const actions=[{id:'whiteboard',label:'Whiteboard',enabled:true,selected:false,primary:false},{id:'finish',label:'Finish',enabled:true,selected:false,primary:true},{id:'cancel',label:'Cancel',enabled:true,selected:false,primary:false}];
 const waveform=[0,.04,.1,.3,.16,.08,.02,0,0,.08,.5,.7,.2,.08,.02,0,0,.03,.1,.3,.02,.1,.5,.8];
 const frame={type:'state',capture:'boot:1',t3Eligible:true,view:{revision:1,phase:'recording',clock:'0:04',label:'Recording',warning:null,notice:null,reducedMotion:true,draggable:false,inputWaveform:waveform,noteCount:0,actions}};
 let page=await app.firstWindow();
 const center=()=>page.evaluate(()=>{
  const row=document.querySelector('.pill-row')?.getBoundingClientRect();
  return row?screenX+row.x+row.width/2:null;
 }).catch(()=>null);
 await send(frame);
 const heartbeat=setInterval(()=>void send(frame).catch(()=>{}),500);t.after(()=>clearInterval(heartbeat));
 await expect(page.getByRole('button',{name:'Finish',exact:true})).toBeVisible();
 await expect.poll(center).not.toBeNull();
 const original=await center();
 const rowHeight=await page.locator('.pill-row').evaluate(element=>element.getBoundingClientRect().height);
 const picker=process.platform==='linux'?app.waitForEvent('window'):null;
 frame.view={...frame.view,revision:2,phase:'processing',inputWaveform:null,actions:[]};
 await send(frame);if(picker)page=await picker;
 const trigger=page.getByRole('combobox');await expect(trigger).toBeEnabled();
 const pickerRow=page.locator('.destination-pill');
 const collapsed=await pickerRow.boundingBox();
 assert.equal(collapsed.height,rowHeight);
 const chipColor=await trigger.evaluate(element=>getComputedStyle(element).backgroundColor);
 await trigger.click();
 assert.equal((await pickerRow.boundingBox()).height,rowHeight);
 await page.getByRole('option',{name:/Chosen thread/}).click();
 const confirmed=page.getByRole('button',{name:/Will send when ready/});
 await expect(confirmed).toBeVisible();
 assert.equal(await confirmed.evaluate(element=>getComputedStyle(element).backgroundColor),chipColor);
 assert.deepEqual(await pickerRow.boundingBox(),collapsed);
 await expect(page.getByRole('button',{name:'Cancel send'})).toHaveCount(0);
 assert.equal(f.calls.length,0);
 const replacement=process.platform==='linux'?app.waitForEvent('window'):null;
 frame.capture='boot:2';frame.view={...frame.view,revision:3,phase:'recording',inputWaveform:waveform,actions};
 await send(frame);if(replacement)page=await replacement;
 const tab=page.getByRole('button',{name:'1 previous recording processing'});
 await expect(tab).toBeVisible();
 const meter=()=>page.getByRole('img',{name:'Captured microphone waveform'});
 await expect(meter()).toBeVisible();
 assert.notEqual(original,null);
 await expect.poll(async()=>{const now=await center();return now!==null && Math.abs(now-original)<=2;}).toBe(true);
 for(const [theme,width] of [['light',1200],['dark',800]]){
  await app.evaluate(({screen},width)=>{screen.__overlapDisplay??=screen.getDisplayMatching.bind(screen);screen.getDisplayMatching=b=>({...screen.__overlapDisplay(b),workArea:{x:0,y:0,width,height:800}});},width);
  await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  await page.evaluate(revision=>window.apparentPill.layout(revision),frame.view.revision);
  await expect(tab).toBeVisible();
  if(process.env.APPARENT_T3_PROOF)await page.screenshot({path:path.join(process.env.APPARENT_T3_PROOF,'overlap-'+theme+'-'+width+'.png')});
 }
 await send({type:'handoff-ready',capture:'boot:1',text:'overlapping capture test'});
 const sent=page.getByRole('button',{name:'Sent to T3 Code',exact:true});
 await expect(sent).toBeVisible();
 await expect(meter().locator('i')).toHaveCount(24);
 await sent.click();
 await expect(page.locator('.pill-background-detail')).toContainText('Chosen thread');
 await expect(page.getByRole('button',{name:'Finish',exact:true})).toBeVisible();
 assert.equal(f.accepted.size,1);assert.equal(f.calls[0].payload.threadId,'thread');
});
