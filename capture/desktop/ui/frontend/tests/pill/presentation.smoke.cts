const {test}=require('node:test');
const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const {formatPillDiagnostic}=require('../../electron/pill/diagnostics.cjs');

test('pill diagnostics retain bounded facts and exclude caller-supplied exception or frame text',()=>{
 const secret='private-capture-path-and-frame-secret';
 const line=formatPillDiagnostic('renderer_gone',{pid:123,phase:'recording',revision:17,rendererReady:true,
  activated:true,loaded:true,stateAgeMs:1200,renderReadinessDeadlineRemainingMs:3800},
  {rendererReason:'crashed',exitCode:9,exception:secret,stack:secret,parentFrame:secret});
 const record=JSON.parse(line);
 assert.deepEqual(record,{kind:'apparent-pill-diagnostic',reason:'renderer_gone',pid:123,phase:'recording',revision:17,
  rendererReady:true,activated:true,loaded:true,elapsedSinceStateMs:1200,parentStateDeadlineRemainingMs:3800,
  renderReadinessDeadlineRemainingMs:3800,rendererReason:'crashed',rendererExitCode:9});
 assert.equal(Buffer.byteLength(line)<768,true);
 assert.equal(line.includes(secret),false);
 const invalid=JSON.parse(formatPillDiagnostic(secret,{pid:Infinity,phase:secret,revision:-1,stateAgeMs:NaN},null));
 assert.equal(invalid.reason,'unknown');assert.equal(invalid.phase,null);assert.equal(invalid.revision,null);
 assert.equal(JSON.stringify(invalid).includes(secret),false);
 let reads=0;
 const changing={get phase(){return ++reads===1?'recording':secret;}};
 assert.equal(JSON.parse(formatPillDiagnostic('parent_stream_end',changing)).phase,'recording');
 assert.equal(reads,1,'Validate and retain the same observed primitive');
});

test('malformed parent frames log only a bounded failure classification',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-diagnostics-'));
 const application=await electron.launch({args:[path.resolve(__dirname,'host.cjs'),'--no-sandbox'],
  env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 t.after(async()=>{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 const child=application.process(),stderr=[];child.stderr.on('data',chunk=>stderr.push(chunk.toString()));
 const closed=application.waitForEvent('close',{timeout:8000});
 const secret='private-capture-path-and-frame-secret';
 await application.evaluate((_e,secret)=>setTimeout(()=>process.stdin.emit('data',`${secret}\n`),100),secret);
 await closed;assert.equal(child.exitCode,1);
 const output=stderr.join('');
 assert.equal(output.includes(secret),false);
 const diagnostic=output.split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}})
  .find(record=>record?.kind==='apparent-pill-diagnostic');
 assert.ok(diagnostic);
 assert.equal(diagnostic.reason,'invalid_parent_frame');
 assert.equal(diagnostic.frameCode,'malformed');
 assert.equal(typeof diagnostic.pid,'number');
});

const hidden={revision:1,phase:'hidden',clock:'00:00',label:'Recording',warning:null,notice:null,
 reducedMotion:false,draggable:true,inputWaveform:null,actions:[]};
const recording={...hidden,revision:2,phase:'recording',inputWaveform:Array(24).fill(.2),actions:[
 {id:'finish',label:'Finish',enabled:true,selected:false,primary:true},
 {id:'cancel',label:'Cancel',enabled:true,selected:false,primary:false}]};

test('Linux mapped resize waits for paint and rejects superseded rounded geometry',{skip:process.platform!=='linux'},async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-shape-paint-'));
 const application=await electron.launch({args:[path.resolve(__dirname,'host.cjs'),'--no-sandbox'],
  env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 t.after(async()=>{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 const page=await application.firstWindow();
 const publish=async view=>{
  await application.evaluate((_e,view)=>process.stdin.emit('data',JSON.stringify({type:'state',view})+'\n'+JSON.stringify({type:'activate'})+'\n'),view);
  await expect(page.locator('main')).toHaveAttribute('data-revision',String(view.revision));
 };
 await publish(recording);
 await page.evaluate(()=>window.apparentPill.layout(2));
 await application.evaluate(({BrowserWindow})=>{
  const w=BrowserWindow.getAllWindows()[0],shape=w.setShape.bind(w);
  w.__shapes=[];w.__mapping=[];
  w.setShape=rects=>{w.__shapes.push(rects);return shape(rects);};
  for(const event of ['hide','show'])w.on(event,()=>w.__mapping.push(event));
 });
 // Hold actual renderer paint callbacks, including concurrent layout requests.
 // Neither a duplicate request nor an obsolete revision may restore the clip.
 await page.evaluate(()=>{window.__paintFrames=[];window.requestAnimationFrame=callback=>window.__paintFrames.push(callback);});
 await publish({...hidden,revision:3,phase:'processing',draggable:false,label:'Processing recording…'});
 await expect.poll(()=>application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].__shapes.length)).toBeGreaterThan(0);
 await page.evaluate(()=>{window.__oldLayout=window.apparentPill.layout(3);});
 await publish({...hidden,revision:4,phase:'completed',draggable:false,label:'Recording saved and ready to hand off'});
 await expect.poll(()=>application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].__shapes.length)).toBeGreaterThan(1);
 assert.ok(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].__shapes.every(shape=>shape.length===1)),
  'The rounded clip must stay removed while the resized surface has not painted');
 await page.evaluate(async()=>{
  for(let frame=0;frame<8;frame++){
   const callbacks=window.__paintFrames.splice(0);for(const callback of callbacks)callback(performance.now());
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  await window.__oldLayout;
  await window.apparentPill.layout(4);
 });
 const result=await application.evaluate(({BrowserWindow})=>{
  const w=BrowserWindow.getAllWindows()[0];return {shapes:w.__shapes,bounds:w.getBounds(),mapping:w.__mapping};
 });
 const rounded=result.shapes.filter(shape=>shape.length>1);
 assert.equal(rounded.length,1,'Only the current revision may restore rounded geometry');
 assert.equal(Math.max(...rounded[0].map(r=>r.x+r.width)),result.bounds.width);
 assert.deepEqual(result.mapping,[],'Resizing must keep the XWayland surface mapped');
 await publish({...recording,revision:5});
 await expect.poll(()=>application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].__shapes.length)).toBeGreaterThan(result.shapes.length);
 await page.reload();
 await expect(page.getByRole('button',{name:'Finish',exact:true})).toBeVisible();
 await page.evaluate(()=>window.apparentPill.layout(5));
});

test('recording, processing and completion retain the visible center',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-center-'));
 const application=await electron.launch({args:[path.resolve(__dirname,'host.cjs'),'--no-sandbox'],
  env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 t.after(async()=>{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 const page=await application.firstWindow();
 let revision=0;
 const publish=async state=>{
  const view={...hidden,noteCount:0,...state,revision:++revision};
  await application.evaluate((_e,view)=>process.stdin.emit('data',JSON.stringify({type:'state',view})+'\n'+JSON.stringify({type:'activate'})+'\n'),view);
  if(view.phase==='hidden'){
   await expect(page.locator('main')).toHaveCount(0);
   await page.evaluate(revision=>window.apparentPill.layout(revision),revision);return;
  }
  await expect(page.locator('main')).toHaveAttribute('data-revision',String(revision));
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(revision=>window.apparentPill.layout(revision),revision);
 };
 const center=async()=>{
  const bounds=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
  const local=await page.evaluate(()=>{
   const main=document.querySelector('main');
   const element=main.dataset.phase==='recording' && !document.querySelector('.pill-notes')
    ?document.querySelector('.pill-row'):document.querySelector('.pill-surface');
   const r=element.getBoundingClientRect();return r.x+r.width/2;
  });
  return bounds.x+local;
 };
 for(const theme of ['light','dark'])for(const width of [1200,320])for(const noteCount of [0,12]){
  await page.emulateMedia({colorScheme:theme});
  await application.evaluate(({screen},width)=>{
   const display={workArea:{x:0,y:0,width,height:800},scaleFactor:1};
   screen.getDisplayMatching=()=>display;screen.getDisplayNearestPoint=()=>display;
  },width);
  await publish({...recording,noteCount});
  await application.evaluate(()=>process.stdin.emit('data',JSON.stringify({type:'place',point:[100,100]})+'\n'));
  if(width===1200)assert.ok(Math.abs(await center()-width/2)<=1,'Display placement centers the painted pill');
  // Move only the starting recording. Never reset the origin on a state change:
  // that would conceal the real host's centering behavior in tests and videos.
  if(width===1200)await application.evaluate(({BrowserWindow})=>{
   const window=BrowserWindow.getAllWindows()[0];window.setPosition(220,window.getBounds().y);
  });
  const reference=await center();
  for(const phase of ['processing','completed']){
   await publish({phase,label:phase==='processing'?'Processing recording…':'Saved',actions:[]});
   const actual=await center();
   if(process.env.APPARENT_CENTER_EVIDENCE){
    const stem=`${theme}-${width}-${noteCount}-${phase}`;
    await page.screenshot({path:path.join(process.env.APPARENT_CENTER_EVIDENCE,`${stem}.png`)});
    await fs.writeFile(path.join(process.env.APPARENT_CENTER_EVIDENCE,`${stem}.json`),JSON.stringify({reference,actual}));
   }
   assert.ok(Math.abs(actual-reference)<=1,`${theme}/${width}/${noteCount}/${phase}: visible center moved ${actual-reference}px`);
  }
 }
 // A new capture can reopen the same phase with a different notes footprint.
 // Production places the retained window before sending its new snapshot.
 await application.evaluate(({screen})=>{
  const display={workArea:{x:0,y:0,width:1200,height:800},scaleFactor:1};
  screen.getDisplayMatching=()=>display;screen.getDisplayNearestPoint=()=>display;
 });
 await publish({...recording,noteCount:12});
 await publish(hidden);
 await application.evaluate(()=>process.stdin.emit('data',JSON.stringify({type:'place',point:[100,100]})+'\n'));
 await publish({...recording,noteCount:0});
 assert.ok(Math.abs(await center()-600)<=1,'A reopened recording centers its new visible footprint');
});

test('close stays at the trailing edge and progress rotates unless motion is reduced',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-close-motion-'));
 const application=await electron.launch({args:[path.resolve(__dirname,'host.cjs'),'--no-sandbox'],
  env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 t.after(async()=>{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 const page=await application.firstWindow();
 let revision=0;
 const publish=async state=>{
  const view={...hidden,noteCount:0,...state,revision:++revision};
  await application.evaluate((_e,view)=>process.stdin.emit('data',JSON.stringify({type:'state',view})+'\n'+JSON.stringify({type:'activate'})+'\n'),view);
  await expect(page.locator('main')).toHaveAttribute('data-revision',String(revision));
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(revision=>window.apparentPill.layout(revision),revision);
 };
 const control=(id,label,primary=false)=>({id,label,enabled:true,selected:false,primary});
 const actions=[control('cancel','Cancel'),control('whiteboard','Whiteboard'),control('finish','Finish',true)];
 for(const theme of ['light','dark']){
  await page.emulateMedia({colorScheme:theme,reducedMotion:'no-preference'});
  for(const width of [1200,320]){
   // Constrain the actual Electron host's trusted work area, not a browser replica.
   await application.evaluate(({screen},width)=>{
    const original=screen.getDisplayMatching.bind(screen);
    screen.getDisplayMatching=b=>({...original(b),workArea:{x:0,y:0,width,height:800}});
   },width);
   for(const noteCount of [0,12]){
    await publish({...recording,actions:[...actions,...(noteCount?[control('notes','Open notes')]:[])],noteCount});
    if(process.env.APPARENT_PILL_EVIDENCE)await page.screenshot({path:path.join(process.env.APPARENT_PILL_EVIDENCE,`${theme}-${width}-notes-${noteCount}.png`)});
    assert.deepEqual(await page.locator('.controls button').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label'))),['Whiteboard','Finish','Cancel']);
    const close=await page.getByRole('button',{name:'Cancel',exact:true}).boundingBox();
    const finish=await page.getByRole('button',{name:'Finish',exact:true}).boundingBox();
    const row=await page.locator('.pill-row').boundingBox();
    assert.ok(close.x>=finish.x+finish.width,'Close must follow Finish spatially');
    assert.ok(close.x+close.width<=row.x+row.width);
    assert.ok(row.x+row.width<=width);
    assert.equal(close.width,44);assert.equal(close.height,44);
   }
  }
  for(const phase of ['processing','completed']){
   await publish({phase,label:phase==='processing'?'Processing recording…':'Uploading…',
    actions:phase==='completed'?[control('copy-link','Cancel upload')]:[]});
   const spinner=page.locator('.indicator.processing');
   const transform=()=>spinner.evaluate(el=>getComputedStyle(el).transform);
   const before=await transform();
   await expect.poll(transform).not.toBe(before);
   for(const reduced of ['system','native']){
    await page.emulateMedia({reducedMotion:reduced==='system'?'reduce':'no-preference'});
    if(reduced==='native')await publish({phase:'processing',label:'Processing recording…',reducedMotion:true,actions:[]});
    assert.equal(await spinner.evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.notEqual(await page.locator('.clock').textContent(),'');
   }
   await page.emulateMedia({reducedMotion:'no-preference'});
  }
 }
 // DOM order is keyboard order; the X keeps its visible focus ring and dispatch.
 await publish({...recording,actions});
 const close=page.getByRole('button',{name:'Cancel',exact:true});
 await page.getByRole('button',{name:'Finish',exact:true}).focus();
 await page.keyboard.press('Tab');await expect(close).toBeFocused();
 assert.equal(await close.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
 assert.equal(await close.evaluate(el=>getComputedStyle(el).outlineWidth),'2px');
 await page.keyboard.press('Enter');await expect(close).toBeDisabled();
});

test('parent-state timeout reports its accepted epoch and readiness without extending the deadline',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-state-timeout-'));
 const application=await electron.launch({args:[path.resolve(__dirname,'host.cjs'),'--no-sandbox'],
  env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 t.after(async()=>{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 const child=application.process(),stderr=[];child.stderr.on('data',chunk=>stderr.push(chunk.toString()));
 const closed=application.waitForEvent('close',{timeout:8000});
 const page=await application.firstWindow();
 await application.evaluate((_e,state)=>setTimeout(()=>process.stdin.emit('data',JSON.stringify({type:'state',view:state})+'\n'+JSON.stringify({type:'activate'})+'\n'),100),recording);
 await expect(page.getByRole('button',{name:'Finish',exact:true})).toBeVisible();
 await application.evaluate(()=>{const now=Date.now;Date.now=()=>now()+6000;});
 await closed;assert.equal(child.exitCode,1);
 const records=stderr.join('').split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}})
  .filter(record=>record?.kind==='apparent-pill-diagnostic');
 const diagnostic=records.find(record=>record.reason==='parent_state_timeout');
 assert.ok(diagnostic);
 assert.equal(diagnostic.phase,'recording');
 assert.equal(diagnostic.revision,2);
 assert.equal(diagnostic.activated,true);
 assert.equal(diagnostic.rendererReady,true);
 assert.equal(diagnostic.loaded,true);
 assert.ok(diagnostic.elapsedSinceStateMs>=5000);
 assert.equal(diagnostic.parentStateDeadlineRemainingMs,0);
});

test('a warm pill waits for its current layout and performs no sizing work for telemetry',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-presentation-'));
 const application=await electron.launch({args:[path.resolve(__dirname,'host.cjs'),'--no-sandbox'],
  env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config'),
   ...(process.platform==='linux'?{XDG_CURRENT_DESKTOP:'Hyprland'}:{})}});
 t.after(async()=>{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 const page=await application.firstWindow();
 const publish=state=>application.evaluate((_e,state)=>process.stdin.emit('data',JSON.stringify({type:'state',view:state})+'\n'),state);
 await publish(hidden);
 await application.evaluate(()=>process.stdin.emit('data','{"type":"activate"}\n'));
 await page.waitForFunction(()=>window.apparentPill!==undefined);
 await page.evaluate(()=>window.apparentPill.layout(1));
 // Hold the real renderer acknowledgement across hidden -> recording. Old
 // readiness must never expose the window before the new geometry is measured.
 // contextBridge exposes a frozen API; hold invoke in Electron main instead.
 await application.evaluate(({ipcMain,BrowserWindow})=>{
  const handler=ipcMain._invokeHandlers.get('pill:layout');
  globalThis.releaseLayout=null;
  ipcMain.removeHandler('pill:layout');
  ipcMain.handle('pill:layout',async(...args)=>{
   await new Promise(resolve=>{globalThis.releaseLayout=resolve;});
   return handler(...args);
  });
  globalThis.restoreLayout=()=>{ipcMain.removeHandler('pill:layout');ipcMain.handle('pill:layout',handler);};
  const w=BrowserWindow.getAllWindows()[0],execute=w.webContents.executeJavaScript.bind(w.webContents);
  globalThis.measurements=0;w.webContents.executeJavaScript=(code,...args)=>{
   if(code.includes('getBoundingClientRect'))globalThis.measurements++;
   return execute(code,...args);
  };
 });
 await publish(recording);
 await expect.poll(()=>application.evaluate(()=>Boolean(globalThis.releaseLayout))).toBe(true);
 assert.equal(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 await application.evaluate(()=>{globalThis.restoreLayout();globalThis.releaseLayout();});
 await expect.poll(()=>application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
 await expect(page.getByRole('button',{name:'Finish',exact:true})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 const start=await application.evaluate(()=>globalThis.measurements);
 for(let i=0;i<20;i++)await publish({...recording,clock:`00:${String(i).padStart(2,'0')}`,inputWaveform:Array(24).fill(i/20)});
 await expect(page.locator('.clock')).toHaveText('00:19');
 // Includes several former 250ms polling periods, with parent heartbeats.
 for(let i=0;i<6;i++){
  await page.waitForTimeout(100);await publish({...recording,clock:'00:19',inputWaveform:Array(24).fill(.95)});
 }
 assert.equal(await application.evaluate(()=>globalThis.measurements),start,'Telemetry and idle time must not measure layout');
 assert.equal(await page.locator('.indicator').evaluate(el=>getComputedStyle(el).animationName),'none');
 await application.evaluate(({BrowserWindow})=>{
  globalThis.resizeHides=0;
  BrowserWindow.getAllWindows()[0].on('hide',()=>globalThis.resizeHides++);
 });
 await publish({...recording,revision:3,warning:'Microphone input stopped; screen recording continues'});
 await expect(page.getByRole('status')).toContainText('Microphone');
 await expect(page.getByRole('button',{name:'Finish',exact:true})).toBeInViewport();
 assert.ok(await application.evaluate(()=>globalThis.measurements)>start,'Content changes must still size the window');
 await page.evaluate(()=>window.apparentPill.layout(3));
 assert.equal(await application.evaluate(()=>globalThis.resizeHides),0,'Resizing a visible pill must not unmap its native surface');
 await publish({...hidden,revision:4});
 await expect.poll(()=>application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
});
