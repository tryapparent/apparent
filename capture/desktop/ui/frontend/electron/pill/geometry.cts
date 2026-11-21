// @ts-nocheck -- preserved bounded Electron host; renderer and public view are typed.
'use strict';
function inset(y,width,height,radius=28){
 const r=Math.min(radius,width/2,height/2);
 const edge=Math.min(y+.5,height-y-.5);
 return edge>=r?0:Math.ceil(r-Math.sqrt(Math.max(0,r*r-(r-edge)**2)));
}
function shape(width,height){
 return Array.from({length:height},(_,y)=>{const x=inset(y,width,height);return {x,y,width:Math.max(1,width-2*x),height:1};});
}
function contains(point,bounds){
 const x=point.x-bounds.x,y=point.y-bounds.y;
 if(y<0||y>=bounds.height)return false;
 const edge=inset(Math.floor(y),bounds.width,bounds.height);
 return x>=edge&&x<bounds.width-edge;
}
// Separate notification capsules leave real click-through space between them.
// Regions come from main's own trusted document measurement, never an IPC size.
function regionShape(regions){
 return regions.flatMap(rect=>Array.from({length:Math.ceil(rect.height)},(_,row)=>{
  const edge=inset(row,rect.width,rect.height,rect.radius);
  return {x:Math.ceil(rect.x+edge),y:Math.floor(rect.y+row),width:Math.max(1,Math.floor(rect.width-2*edge)),height:1};
 }));
}
function containsRegions(point,regions){
 return regions.some(rect=>{
  const x=point.x-rect.x,y=point.y-rect.y;
  if(y<0||y>=rect.height)return false;
  const edge=inset(Math.floor(y),rect.width,rect.height,rect.radius);
  return x>=edge&&x<rect.width-edge;
 });
}
function clamp(bounds,area){
 return {x:Math.min(Math.max(bounds.x,area.x),area.x+Math.max(0,area.width-bounds.width)),
 y:Math.min(Math.max(bounds.y,area.y),area.y+Math.max(0,area.height-bounds.height))};
}
function measureContents(contents,limit,reserve){
 return contents.executeJavaScript(`(() => {
   document.documentElement.style.setProperty('--pill-limit', '${limit}px');
   const element=document.querySelector('main'),rect=element?.getBoundingClientRect();
   if (!rect) return null;
   if (${reserve} !== null && element.dataset.phase==='recording')
     document.documentElement.style.setProperty('--pill-recording-reserve', '${reserve}px');
   const live = document.querySelector('.pill[data-live=true]');
   const selector = live ? '.pill-row,.live-caption,.pill-notes-layer' : '.destination-assembly,.destination-notification,.public-share-confirmation';
   const regions=live || document.querySelector('.destination-assembly')?[...document.querySelectorAll(selector)].map(element=>{
     const r=element.getBoundingClientRect();return {x:r.x-rect.x,y:r.y-rect.y,width:r.width,height:r.height,radius:parseFloat(getComputedStyle(element).borderTopLeftRadius)||0};
   }):[];
   return {width:Math.ceil(rect.width),height:Math.ceil(rect.height),revision:Number(element.dataset.revision),regions};
 })()`);
}
module.exports={shape,contains,regionShape,containsRegions,clamp,measureContents};
