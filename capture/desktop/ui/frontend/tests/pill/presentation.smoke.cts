const {test}=require('node:test');
const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');

const hidden={revision:1,phase:'hidden',clock:'00:00',label:'Recording',warning:null,notice:null,
 reducedMotion:false,draggable:true,inputWaveform:null,actions:[]};
const recording={...hidden,revision:2,phase:'recording',inputWaveform:Array(24).fill(.2),actions:[
 {id:'finish',label:'Finish',enabled:true,selected:false,primary:true},
 {id:'cancel',label:'Cancel',enabled:true,selected:false,primary:false}]};

test('a warm pill waits for its current layout and performs no sizing work for telemetry',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-presentation-'));
 const application=await electron.launch({args:[path.resolve(__dirname,'host.cjs'),'--no-sandbox'],
  env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
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
 await publish({...recording,revision:3,warning:'Microphone input stopped; screen recording continues'});
 await expect(page.getByRole('status')).toContainText('Microphone');
 await expect(page.getByRole('button',{name:'Finish',exact:true})).toBeInViewport();
 assert.ok(await application.evaluate(()=>globalThis.measurements)>start,'Content changes must still size the window');
 await publish({...hidden,revision:4});
 await expect.poll(()=>application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
});
