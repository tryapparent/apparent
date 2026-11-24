const {test}=require('node:test');
const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
test('live text keeps controls fixed, tails overflow, clears on stop, and preserves native input shape',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-live-'));
 const application=await electron.launch({args:[path.resolve(__dirname,'../host.cjs'),'--no-sandbox'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 t.after(async()=>{await application.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 const page=await application.firstWindow();
 if(process.platform==='linux')await application.evaluate(({BrowserWindow})=>{
  const window=BrowserWindow.getAllWindows()[0],setShape=window.setShape.bind(window);
  window.setShape=rectangles=>{globalThis.liveInputShape=rectangles;setShape(rectangles);};
 });
 const state={revision:1,phase:'recording',clock:'00:12',label:'Recording',warning:null,reducedMotion:false,draggable:false,noteCount:0,inputWaveform:Array(24).fill(.2),
  transcript:{state:'starting',text:''},actions:[{id:'whiteboard',label:'Whiteboard',enabled:true,selected:false,primary:false},{id:'finish',label:'Finish',enabled:true,selected:false,primary:true},{id:'cancel',label:'Cancel',enabled:true,selected:false,primary:false}]};
 await page.waitForFunction(()=>window.apparentPill);
 const publish=async view=>{
  await application.evaluate((_e,view)=>process.stdin.emit('data',JSON.stringify({type:'state',view})+'\n'+JSON.stringify({type:'activate'})+'\n'),view);
  await expect(page.locator('main')).toHaveAttribute('data-revision',String(view.revision));
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(revision=>window.apparentPill.layout(revision),view.revision);
 };
 for(const theme of ['light','dark'])for(const width of [1200,320])for(const noteCount of [0,12]){
  await page.emulateMedia({colorScheme:theme,reducedMotion:'no-preference'});
  await application.evaluate(({screen},width)=>{const display={workArea:{x:0,y:0,width,height:800},scaleFactor:1};screen.getDisplayMatching=()=>display;screen.getDisplayNearestPoint=()=>display;},width);
  const recording={...state,noteCount,revision:++state.revision,actions:[...state.actions,...(noteCount?[{id:'notes',label:'Open notes',enabled:true,selected:false,primary:false}]:[])]};
  await publish(recording);
  const initial=await page.getByRole('button',{name:'Finish',exact:true}).boundingBox();
  await publish({...recording,transcript:{state:'streaming',text:'Please keep the recording controls steady. '.repeat(30)+'These are the newest words.'}});
  await expect(page.locator('.live-caption__line')).toContainText('These are the newest words.');
  await expect(page.locator('.live-caption__viewport')).toHaveAttribute('data-overflow','true');
  const final=await page.getByRole('button',{name:'Finish',exact:true}).boundingBox();
  assert.deepEqual(final,initial,'Streaming must not move Finish');
  assert.ok(final.x+final.width<=width,'Finish stays inside the smallest work area');
  assert.ok(await page.locator('main').evaluate(el=>el.getBoundingClientRect().width)<=width);
  const cursor=await page.locator('.live-caption__caret').boundingBox();
  const viewport=await page.locator('.live-caption__viewport').boundingBox();
  await expect.poll(async()=>{const r=await page.locator('.live-caption__caret').boundingBox();return Math.abs(r.x+r.width-(viewport.x+viewport.width));}).toBeLessThan(1);
  const palette=await page.locator('.live-caption').evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
  assert.deepEqual(palette,theme==='dark'?{background:'rgb(59, 46, 80)',color:'rgb(245, 240, 232)'}:{background:'rgb(183, 165, 216)',color:'rgb(2, 1, 2)'});
  if(process.platform==='linux'){
   const caption=await page.locator('.live-caption').boundingBox();
   const main=await page.locator('main').boundingBox();
   const points=[{x:caption.x+caption.width/2,y:caption.y+caption.height-2},{x:0,y:caption.y+caption.height-1},{x:caption.x+caption.width+20,y:caption.y+caption.height-2},{x:main.width-1,y:0}];
   assert.deepEqual(await application.evaluate((_e,points)=>points.map(point=>globalThis.liveInputShape.some(rect=>point.x>=rect.x&&point.x<rect.x+rect.width&&point.y>=rect.y&&point.y<rect.y+rect.height)),points),[true,false,false,false]);
  }
  if(process.env.APPARENT_LIVE_PROOF){await fs.mkdir(process.env.APPARENT_LIVE_PROOF,{recursive:true});await page.screenshot({path:path.join(process.env.APPARENT_LIVE_PROOF,`pill-${theme}-${width}-notes-${noteCount}.png`)});}
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.live-caption__caret').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.getByRole('button',{name:'Finish',exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Whiteboard',exact:true})).toBeFocused();
 }
 await publish({...state,transcript:{state:'failed',text:''},revision:++state.revision});
 await expect(page.locator('.live-caption').getByRole('status')).toHaveText('Live text unavailable');
 await publish({...state,phase:'processing',transcript:null,inputWaveform:null,actions:[],revision:++state.revision});
 await expect(page.locator('.live-caption')).toHaveCount(0);
 await publish({...state,transcript:{state:'starting',text:''},revision:++state.revision});
 await expect(page.locator('.live-caption__line')).toHaveText('');
});
