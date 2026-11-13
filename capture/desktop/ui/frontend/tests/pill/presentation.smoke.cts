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
