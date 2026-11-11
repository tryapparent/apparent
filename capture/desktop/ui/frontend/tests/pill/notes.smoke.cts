// Real Electron renderer/host with a synthetic parent. Native notes are tested separately.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
test('saved notes extension preserves controls, themes and keyboard activation',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pill-notes-'));
 const app=await electron.launch({args:[path.resolve(__dirname,'host.cjs'),'--no-sandbox'],env:{...process.env,HOME:home,XDG_CONFIG_HOME:path.join(home,'config')}});
 t.after(async()=>{await app.close().catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
 const page=await app.firstWindow();
 let revision=0;
 const publish=async count=>{
 const state={revision:++revision,phase:'recording',clock:'00:12',label:'Recording',warning:null,notice:null,reducedMotion:false,draggable:true,inputLevel:.2,noteCount:count,
 actions:['cancel','whiteboard','finish',...(count?['notes']:[])].map(id=>({id,label:{whiteboard:'Whiteboard',finish:'Finish',cancel:'Cancel',notes:'Open notes'}[id],enabled:true,selected:false,primary:id==='finish'}))};
 await app.evaluate((_e,state)=>process.stdin.emit('data',JSON.stringify({type:'state',view:state})+'\n'),state);
 await expect(page.locator('main')).toHaveAttribute('data-revision',String(revision));
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(revision=>window.apparentPill.layout(revision),revision);
 };
 const rectangles=()=>page.locator('.controls button').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
 for(const theme of ['light','dark']){
 await page.emulateMedia({colorScheme:theme});
 await publish(0);
 await expect(page.locator('.pill-row')).toHaveCSS('background-color',theme==='dark'?'rgb(32, 27, 36)':'rgb(245, 240, 232)');
 await publish(0);const before=await rectangles();
 assert.equal(await page.locator('.pill-notes').count(),0);
 for(const count of [1,12,100,0]){
 await publish(count);assert.deepEqual(await rectangles(),before);
 if(count){
 await expect(page.getByRole('button',{name:`${count} saved ${count===1?'note':'notes'}. Open notes`,exact:true})).toBeVisible();
 const row=await page.locator('.pill-row').boundingBox(),layer=await page.locator('.pill-notes-layer').boundingBox();
 assert.equal(row.y,layer.y);assert.equal(row.height,layer.height);
 assert.equal(layer.x+layer.width-row.x-row.width,72);
 }
 if(process.env.APPARENT_NOTES_EVIDENCE)await page.screenshot({path:path.join(process.env.APPARENT_NOTES_EVIDENCE,`${theme}-${count}.png`)});
 }
 }
 await publish(12);await page.locator('.pill-notes').focus();
 assert.equal(await page.locator('.pill-notes').evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
 await page.keyboard.press('Enter');await expect(page.locator('.pill-notes')).toBeDisabled();
});
