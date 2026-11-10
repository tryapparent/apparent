import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron,expect} from '@playwright/test';
const base={revision:1,phase:'recording',clock:'00:12',label:'Recording',warning:null,reducedMotion:false,draggable:false,
 actions:[{id:'finish',label:'Finish',enabled:true,selected:false,primary:true}]};
test('Hyprland hover follows native cursor facts rather than stale XWayland coordinates', {skip:process.platform!=='linux'}, async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pill-cursor-'));
 const application=await electron.launch({args:['--ozone-platform=x11','--force-device-scale-factor=2',fileURLToPath(new URL('./host.cjs',import.meta.url))],
  env:{...process.env,XDG_CONFIG_HOME:path.join(root,'config'),HYPRLAND_INSTANCE_SIGNATURE:'synthetic-hover-contract'}});
 t.after(async()=>{await application.close().catch(()=>{});await fs.rm(root,{recursive:true,force:true});});
 const page=await application.firstWindow(),sent: {hovered?: boolean}[]=[];let buffer='';
 application.process().stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){try{sent.push(JSON.parse(buffer.slice(0,end)));}catch{}buffer=buffer.slice(end+1);}});
 await application.evaluate((_e,state)=>process.stdin.emit('data',JSON.stringify({type:'state',view:state})+'\n'+JSON.stringify({type:'activate'})+'\n'),base);
 await expect(page.getByRole('button',{name:'Finish',exact:true})).toBeVisible();
 const points=await application.evaluate(({BrowserWindow,screen})=>{
  const b=BrowserWindow.getAllWindows()[0].getBounds(),inside={x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};
  // Model the actual pre-fix native diagnostic: XWayland retains the in-window
  // point while the compositor has already observed a move onto Wayland.
  screen.getCursorScreenPoint=()=>inside;
  return {inside:screen.dipToScreenPoint(inside),outside:screen.dipToScreenPoint({x:inside.x,y:b.y+b.height+50})};
 });
 async function cursor(point: {x:number;y:number}|null){await application.evaluate((_e,point)=>process.stdin.emit('data',JSON.stringify({type:'cursor',point:point?[point.x,point.y]:null})+'\n'),point);}
 const hovered=()=>sent.filter(message=>typeof message.hovered==='boolean').at(-1)?.hovered;
 await cursor(points.inside);await expect.poll(hovered).toBe(true);
 await cursor(points.outside);await expect.poll(hovered).toBe(false);
 await cursor(points.inside);await expect.poll(hovered).toBe(true);
 await expect.poll(hovered).toBe(false); // No fresh native sample: expire hover.
 await cursor(points.inside);await expect.poll(hovered).toBe(true);
 await cursor(null);await expect.poll(hovered).toBe(false);
 assert.equal(await page.evaluate('typeof window.apparentPill.cursor'),'undefined');
 await expect(page.getByRole('button',{name:'Finish',exact:true})).toBeEnabled();
});
