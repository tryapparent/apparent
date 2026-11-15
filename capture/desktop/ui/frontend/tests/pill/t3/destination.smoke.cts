const {test}=require('node:test');const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');const path=require('node:path');const fs=require('node:fs/promises');
test('real pill keeps Paste by default, then selects during processing and dispatches through main only', {timeout:60000},async t=>{
 const {fixture}=await import('./testing/server.ts');const f=await fixture(t);f.many();await f.save(false);
 const app=await electron.launch({args:[path.resolve(__dirname,'../host.cjs'),'--no-sandbox','--ozone-platform=x11','--force-device-scale-factor=1'],env:{...process.env,APPARENT_CONFIG:f.config,HOME:f.home,XDG_CONFIG_HOME:path.join(f.home,'config')}});
 let page=await app.firstWindow();
 t.after(async()=>{await app.close().catch(()=>{});});
 let parentBuffer='',holdActivation=false;const readyIds=[];
 const activate=id=>app.evaluate((_electron,id)=>process.stdin.emit('data',JSON.stringify({type:'activate',windowId:id})+'\n'),id);
 app.process().stdout.on('data',chunk=>{parentBuffer+=String(chunk);let end;while((end=parentBuffer.indexOf('\n'))>=0){const line=parentBuffer.slice(0,end);parentBuffer=parentBuffer.slice(end+1);try{const message=JSON.parse(line);if(message.ready){readyIds.push(message.windowId);if(!holdActivation)void activate(message.windowId).catch(()=>{});}}catch{}}});
 async function proof(name){await page.evaluate(()=>document.fonts.ready);await expect.poll(()=>page.evaluate(()=>{const r=document.querySelector('main')!.getBoundingClientRect();return innerWidth>=Math.ceil(r.width)&&innerHeight>=Math.ceil(r.height);})).toBe(true);if(process.env.APPARENT_T3_PROOF){await fs.mkdir(process.env.APPARENT_T3_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_T3_PROOF,name+'.png')});}}

 let frame={type:'state',capture:'off',t3Eligible:true,view:{revision:1,phase:'completed',clock:'00:04',label:'Saved',warning:null,notice:null,reducedMotion:true,draggable:false,inputWaveform:null,noteCount:0,actions:[{id:'paste',label:'Paste',enabled:true,selected:false,primary:true},{id:'dismiss',label:'Dismiss',enabled:true,selected:false,primary:false}]}};
 const publish=async()=>app.evaluate((_electron,frame)=>process.stdin.emit('data',JSON.stringify(frame)+'\n'),frame);
 // A visible React control can precede the native paint/admission receipt.
 // Delay only the initial measurement to exercise that scheduling boundary in CI.
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
  // Establish the original native window before testing its replacement. DOM
  // visibility alone does not acknowledge the asynchronous layout/admission.
  await expect.poll(()=>readyIds.length).toBe(1);
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
 }
 holdActivation=process.platform==='linux';const oldPage=page;
 const pickerWindow=process.platform==='linux'?app.waitForEvent('window'):null;
 await f.save(true);frame={...frame,capture:'on',view:{...frame.view,revision:2,phase:'processing',label:'Processing recording…',actions:[]}};await publish();
 if(pickerWindow)page=await pickerWindow;
 if(pickerWindow){
  await expect.poll(()=>readyIds.length).toBe(2);
  await activate(readyIds[0]);assert.equal(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>Number(w.getMediaSourceId().split(':')[1])===id).isVisible(),readyIds[1]),false,'stale activation cannot expose the replacement');
  await activate(readyIds[1]);holdActivation=false;await expect.poll(()=>oldPage.isClosed()).toBe(true);
 }
 const trigger=page.getByRole('combobox');await expect(trigger).toBeEnabled();await expect(trigger).toBeFocused();
 // Destination data may arrive after the capture revision. Replacing the
 // ordinary pill must retain native sizing for subsequent tray expansion.
 const destination=await page.evaluate(()=>window.apparentPill.destinations());
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('pill:destinations',null));
 await expect(page.locator('.pill-row')).toBeVisible();await proof('destination-pending');
 await app.evaluate(({BrowserWindow},value)=>BrowserWindow.getAllWindows()[0].webContents.send('pill:destinations',value),destination);
 await expect(trigger).toBeEnabled();await trigger.focus();
 await page.keyboard.press('ArrowDown');await expect(trigger).toHaveAttribute('aria-expanded','true');await expect(page.getByRole('option')).toHaveCount(3);await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected','true');await expect(page.getByRole('option').last()).toHaveAttribute('data-continuation','true');
 for(const colorScheme of ['dark','light']){await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await proof('processing-expanded-'+colorScheme);}
 assert.ok((await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds())).height>160,'native window must fit the expanded tray');
 await page.keyboard.press('Escape');await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(trigger).toContainText('New thread');assert.equal(f.calls.length,0);
 await trigger.click();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Cancel handoff',exact:true})).toBeVisible();assert.equal(f.calls.length,0);
 const handoff='PRIVATE exact recording handoff';await app.evaluate((_electron,args)=>process.stdin.emit('data',JSON.stringify({type:'handoff-ready',capture:'on',text:args})+'\n'),handoff);
 frame={...frame,view:{...frame.view,revision:3,phase:'completed',label:'Saved',actions:[{id:'paste',label:'Paste',enabled:true,selected:false,primary:true}]}};await publish();
 await expect.poll(()=>f.calls.length).toBe(1);await expect(trigger).toBeDisabled();assert.equal(f.calls[0].payload.threadId,'thread');assert.equal(f.calls[0].payload.text,handoff);assert.equal(await page.evaluate(()=>document.body.textContent.includes('PRIVATE')),false);
 await page.reload();await expect(trigger).toBeDisabled();assert.equal(f.accepted.size,1);
 // A new capture starts with New thread; a missing ACK retains the exact request for retry.
 frame={...frame,capture:'retry',view:{...frame.view,revision:4}};await publish();await expect(trigger).toBeEnabled();await app.evaluate(()=>process.stdin.emit('data',JSON.stringify({type:'handoff-ready',capture:'retry',text:'COPY THIS EXACT HANDOFF'})+'\n'));
 f.lose();await trigger.focus();await page.keyboard.press('Enter');await expect(page.getByRole('alert')).toContainText('Delivery not confirmed');
 await page.getByRole('button',{name:'Copy instead',exact:true}).click();await expect(page.getByText('Copied',{exact:true})).toBeVisible();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'COPY THIS EXACT HANDOFF');
 for(const colorScheme of ['dark','light']){await page.emulateMedia({colorScheme,reducedMotion:'reduce'});if(process.env.APPARENT_T3_PROOF){await fs.mkdir(process.env.APPARENT_T3_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_T3_PROOF,`error-${colorScheme}.png`)});}}
 await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('img',{name:'Submitted',exact:true})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);await expect.poll(()=>f.calls.length).toBe(3);assert.equal(f.accepted.size,2);assert.deepEqual(f.calls[1],f.calls[2]);
 // The actual renderer and host must fit a narrow work area, including the
 // final highlighted row reaching the rounded bottom edge.
 await app.evaluate(({screen})=>{const matching=screen.getDisplayMatching.bind(screen);screen.getDisplayMatching=(bounds)=>{const display=matching(bounds);return {...display,workArea:{...display.workArea,width:320}};};});
 frame={...frame,capture:'narrow',view:{...frame.view,revision:5}};await publish();await expect(trigger).toBeEnabled();await trigger.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await expect(page.getByRole('option').last()).toHaveAttribute('aria-selected','true');
 for(const colorScheme of ['dark','light']){await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await proof('narrow-expanded-'+colorScheme);}
 const narrow=await page.evaluate(()=>{const tray=document.querySelector('.destination-tray')!.getBoundingClientRect(),rows=document.querySelectorAll('.destination-option'),last=rows[rows.length-1].getBoundingClientRect();return {width:document.querySelector('main')!.getBoundingClientRect().width,gap:tray.bottom-last.bottom};});
 assert.ok(narrow.width<=320);assert.ok(narrow.gap<=1.1,'selected last row reaches the tray border');
 if(process.platform==='linux'){
  // Opening/closing the tray changes geometry without changing the capture's
  // parent revision. A stale paint completion must not clip the newer list.
  await page.evaluate(revision=>window.apparentPill.layout(revision),frame.view.revision);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0],shape=w.setShape.bind(w);w.__pickerShapes=[];w.setShape=rects=>{w.__pickerShapes.push(rects);return shape(rects);};});
  await page.evaluate(()=>{window.__originalPickerFrame=window.requestAnimationFrame;window.__pickerFrames=[];window.requestAnimationFrame=callback=>window.__pickerFrames.push(callback);});
  await page.keyboard.press('Escape');
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds().height)).toBe(58);
  await trigger.focus();await page.keyboard.press('ArrowDown');await expect(page.getByRole('option')).toHaveCount(3);
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds().height)).toBeGreaterThan(160);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].__pickerShapes.every(shape=>shape.length===1)),true);
  await page.evaluate(async revision=>{for(let i=0;i<8;i++){for(const callback of window.__pickerFrames.splice(0))callback(performance.now());await new Promise(r=>setTimeout(r,10));}window.requestAnimationFrame=window.__originalPickerFrame;await window.apparentPill.layout(revision);},frame.view.revision);
  const masks=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {height:w.getBounds().height,rounded:w.__pickerShapes.filter(shape=>shape.length>1).map(shape=>Math.max(...shape.map(r=>r.y+r.height)))};});
  assert.ok(masks.rounded.length>0);assert.ok(masks.rounded.every(height=>height===masks.height),'only the current list size may restore the rounded mask');
 }
 assert.equal(await page.evaluate(async()=>{try{await fetch('https://example.com');return false;}catch{return true;}}),true);
 const reads=f.reads,returning=process.platform==='linux'?app.waitForEvent('window'):null;
 await f.save(false);frame={...frame,capture:'off-next',view:{...frame.view,revision:6}};await publish();if(returning)page=await returning;
 await expect(page.getByRole('button',{name:'Paste',exact:true})).toBeVisible();await expect.poll(()=>app.windows().length).toBe(1);assert.equal(f.reads,reads);
 if(returning)assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFocusable()),false,'turning off restores the original non-focusable recording role');
});

test('enabled unpaired pill opens Agents through the native pipe and can copy the kept recording', {timeout:30000},async t=>{
 const {fixture}=await import('./testing/server.ts');const f=await fixture(t);
 await fs.writeFile(f.config,JSON.stringify({experiments:{t3DestinationPicker:true}}));
 const app=await electron.launch({args:[path.resolve(__dirname,'../host.cjs'),'--no-sandbox','--ozone-platform=x11'],env:{...process.env,APPARENT_CONFIG:f.config,HOME:f.home}});t.after(async()=>{await app.close().catch(()=>{});});
 let page=await app.firstWindow(),buffer='',setup=false;
 app.process().stdout.on('data',chunk=>{buffer+=String(chunk);let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const value=JSON.parse(line);if(value.ready)void app.evaluate((_electron,id)=>process.stdin.emit('data',JSON.stringify({type:'activate',windowId:id})+'\n'),value.windowId).catch(()=>{});if(value.action==='settings-agents')setup=true;}catch{}}});
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
