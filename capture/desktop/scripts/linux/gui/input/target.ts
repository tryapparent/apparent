export const target = `<!doctype html><meta charset="utf-8"><title>Apparent input qualification</title>
<style>body{margin:0;background:#eee;font:24px sans-serif}main{padding:80px;height:100vh;box-sizing:border-box}pre{font-size:16px}</style>
<main>Draw a stroke here, then Shift-click. <input id="typed" aria-label="Native typing target"><pre id="status">Waiting for native input</pre></main>
<script>window.events=[];for(const type of ['pointerdown','pointermove','pointerup','click','keydown','keyup'])
addEventListener(type,e=>{window.events.push({type:e.type,pointerId:e.pointerId,button:e.button,buttons:e.buttons,
clientX:e.clientX,clientY:e.clientY,key:e.key,code:e.code,keyCode:e.keyCode,shiftKey:e.shiftKey,isTrusted:e.isTrusted});
document.querySelector('#status').textContent=JSON.stringify(window.events.slice(-8),null,2)});</script>`;
