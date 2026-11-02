/* Interactive design only. No native capture, clipboard access, upload or agent send. */
window.apparentDesktopPractice = function ({ shortcut, color, frog, frogAir, onComplete, onBack }) {
  document.getElementById('desktop-practice')?.remove();
  const root=document.createElement('section');root.id='desktop-practice';root.tabIndex=-1;
  root.setAttribute('aria-label','Guided desktop practice preview');document.body.append(root);
  let phase='start',strokes=[],screenStrokes=[],drawing=null,board=false,timer,ticker,frogTimer,recordingStart=0;
  const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count=()=>({start:1,whiteboard:2,draw:3,screen:4,stop:5,saving:5,copied:6,paste:6,pasted:6,menu:7,latest:7,done:8}[phase]);
  const coach=(title,text,position,extra='')=>`<aside class="desktop-coach ${position}" role="status">${frog?`<img src="${frog}" class="coach-frog" alt="Frog guide">`:''}<span class="coach-kicker">Your first capture <span>${count()} / 8</span></span><h2>${title}</h2><p>${text}</p>${extra}</aside>`;
  function render(){
    const previous=root.querySelector('.coach-frog')?.getBoundingClientRect();clearTimeout(frogTimer);
    root.innerHTML=`<div class="desktop-menubar"><strong>apparent</strong><span>File</span><span>View</span><div class="desktop-menu-right"><button aria-label="Apparent menu" id="desktop-menu-icon" ${['menu','latest','done'].includes(phase)?'':'disabled'}>a</button><span>◒</span><span>Mon 10:24</span></div></div>
      <div class="desktop-disclosure">Interactive desktop concept · recording, clipboard and agent handoff are simulated</div>
      <div class="desktop-background-window"><div class="desktop-document-chrome"><i></i><i></i><i></i><span>A little idea</span></div><h2>Make something<br>worth pointing at.</h2><p>Your work stays in view while Apparent guides you.</p><div class="desktop-document-note">One small change can tell the whole story.</div></div>
      ${['whiteboard','draw','screen','stop'].includes(phase)?`<div class="desktop-recording-pill" aria-label="Recording controls"><span class="desktop-record-dot"></span><span id="desktop-elapsed">0:${String(Math.floor((Date.now()-recordingStart)/1000)).padStart(2,'0')}</span><button id="desktop-whiteboard" aria-pressed="${board}">▧ Whiteboard</button><button id="desktop-finish" ${phase==='stop'?'':'disabled'}>Finish ■</button></div>`:''}
      ${board&&phase==='draw'?`<div class="desktop-whiteboard"><div class="desktop-board-title"><span>● ● ●</span> Apparent Whiteboard</div><div class="desktop-board-toolbar"><span>▧ WHITEBOARD</span><button id="desktop-clear">Clear</button></div><canvas width="1000" height="580" data-kind="board" aria-label="Practice whiteboard"></canvas></div>`:''}
      ${['screen','stop'].includes(phase)?'<canvas class="desktop-screen-ink" width="1440" height="1000" data-kind="screen" aria-label="Draw directly on the screen"></canvas>':''}
      ${phase==='start'?coach('Start your first capture.',`Press <kbd>${escape(shortcut)}</kbd> to start recording.`,'coach-start',`<button id="desktop-key-alternative" class="desktop-key-button" aria-label="Preview pressing the recording shortcut">${escape(shortcut)} <span>Start your first capture</span></button>`):''}
      ${phase==='whiteboard'?coach('Open Whiteboard.','Click Whiteboard in the recording controls.','coach-pill'):''}
      ${phase==='draw'?coach('Draw on the whiteboard.','Try a circle, an arrow, or a quick sketch.','coach-draw'):''}
      ${phase==='screen'?coach('Draw on your screen.','Hold Shift and circle something in the window.','coach-screen','<div class="guide-keycap"><kbd>⇧ Shift</kbd><span>hold + draw</span></div>'):''}
      ${phase==='stop'?coach('Finish your capture.',`Press <kbd>${escape(shortcut)}</kbd> again. Your sketch and screen marks stay together.`,'coach-pill coach-finish'):''}
      ${phase==='saving'?coach('Preparing your capture…','Recording has stopped. Your marks and context are being brought together.','coach-start'):''}
      ${['copied','paste','pasted'].includes(phase)?'<div class="desktop-copied-pill" role="status"><span>✓</span> Copied <small>practice preview</small></div>':''}
      ${phase==='copied'?coach('Copied. Try pasting it.','Paste the capture into your agent to share your marks and screen context.','coach-copied','<button class="guide-primary" id="desktop-open-agent">Open practice agent →</button>'):''}
      ${['paste','pasted'].includes(phase)?`<div class="desktop-agent"><div class="desktop-document-chrome"><i></i><i></i><i></i><span>Your agent · practice only</span></div><div class="desktop-agent-body"><div class="agent-spark">✳</div><h2>What shall we make better?</h2>${phase==='paste'?'<div class="desktop-agent-composer" tabindex="0" role="textbox" aria-label="Practice agent composer"><span>Paste your capture here…</span><kbd>⌘ V</kbd></div><button class="guide-primary" id="desktop-paste">Paste practice capture</button>':`<div class="desktop-agent-attachment"><div class="agent-capture-thumb"><canvas width="1000" height="580" data-kind="board" aria-label="Pasted whiteboard sketch"></canvas></div><div><strong>apparent · first capture</strong><p>Your whiteboard sketch + screen drawing</p><span>Context, marks and timing · all together</span></div></div><div class="desktop-agent-sent"><span>✓ Pasted into this practice conversation.</span><small>Nothing was sent to a real agent.</small></div>`}</div></div>`:''}
      ${phase==='paste'?coach('Paste your capture.','Press ⌘ V in the practice conversation, or click Paste practice capture.','coach-agent'):''}
      ${phase==='pasted'?coach('Your feedback is together.','Your marks and screen context are in the same message. Next, find Apparent in the menu bar.','coach-agent','<button class="guide-primary" id="desktop-find-app">Find Apparent ↗</button>'):''}
      ${phase==='menu'?coach('Find Apparent here.','Click the Apparent icon in your menu bar.','coach-menu'):''}
      ${phase==='latest'?`<div class="desktop-app-menu" role="menu"><div class="desktop-menu-heading">apparent</div><button role="menuitem" id="desktop-latest">Open Latest Capture <span>↗</span></button><button role="menuitem" disabled>Record <span>${escape(shortcut)}</span></button><hr><button role="menuitem" disabled>Settings…</button></div>${coach('Open your latest capture.','Choose Open Latest Capture to find what you just made.','coach-latest')}`:''}
      ${phase==='done'?`<div class="desktop-latest-capture"><div class="desktop-board-title">Latest capture · Quick Look preview</div><div class="desktop-capture-image"><canvas width="1000" height="580" data-kind="board" aria-label="Your saved drawing"></canvas></div><div class="desktop-capture-info"><strong>Your first capture</strong><span>Whiteboard + screen mark · practice</span><button id="desktop-handoff">Finish practice ✓</button></div></div>${coach('Ready for your next idea.','You can record, draw, paste, and find your captures. Nice first hop.','coach-done')}`:''}
      <button class="desktop-tour-back" id="desktop-tour-back">← Back to setup</button><span class="desktop-tour-count">${count()} / 8</span>`;
    const on=(id,fn)=>root.querySelector('#'+id)?.addEventListener('click',fn);
    on('desktop-key-alternative',start);on('desktop-whiteboard',()=>{if(phase==='whiteboard'){board=true;phase='draw';render()}});on('desktop-finish',finish);
    on('desktop-clear',()=>{strokes=[];render()});on('desktop-open-agent',()=>{phase='paste';render()});on('desktop-paste',paste);
    on('desktop-find-app',()=>{phase='menu';render()});on('desktop-menu-icon',()=>{phase='latest';render()});on('desktop-latest',()=>{phase='done';render()});
    on('desktop-tour-back',()=>{cleanup();root.remove();onBack()});on('desktop-handoff',()=>{cleanup();root.remove();onComplete()});
    for(const canvas of root.querySelectorAll('canvas')){
      const screen=canvas.dataset.kind==='screen',paths=screen?screenStrokes:strokes,ctx=canvas.getContext('2d');
      function paint(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.strokeStyle=color;ctx.lineWidth=screen?5:6;ctx.lineCap='round';ctx.lineJoin='round';for(const path of paths){ctx.beginPath();path.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke()}}
      paint();if((!screen&&phase==='draw')||(screen&&phase==='screen')){
        const point=e=>{const r=canvas.getBoundingClientRect();return[(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height]};
        canvas.onpointerdown=e=>{if(screen&&!e.shiftKey)return;canvas.setPointerCapture(e.pointerId);drawing=[point(e)];paths.push(drawing);paint()};
        canvas.onpointermove=e=>{if(drawing&&drawing.length<1000){drawing.push(point(e));paint()}};
        canvas.onpointerup=()=>{drawing=null;if(paths.some(p=>p.length>3)){phase=screen?'stop':'screen';board=false;render()}};canvas.onpointercancel=()=>drawing=null;
      }
    }
    const sprite=root.querySelector('.coach-frog');
    if(sprite&&previous&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const next=sprite.getBoundingClientRect(),dx=previous.left-next.left,dy=previous.top-next.top;if(frogAir)sprite.src=frogAir;sprite.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:`translate(${dx*.5}px,${dy*.5-70}px) rotate(-8deg)`,offset:.5},{transform:'translate(0,0)'}],{duration:650,easing:'cubic-bezier(0.2,0,0,1)'});frogTimer=setTimeout(()=>{if(sprite.isConnected)sprite.src=frog},650)}
    root.classList.remove('ink-active');root.focus({preventScroll:true});
    if(phase==='paste')root.querySelector('.desktop-agent-composer').focus({preventScroll:true});
  }
  function cleanup(){clearTimeout(timer);clearTimeout(frogTimer);clearInterval(ticker)}
  function start(){if(phase==='start'){recordingStart=Date.now();phase='whiteboard';render();ticker=setInterval(()=>{const el=root.querySelector('#desktop-elapsed');if(el)el.textContent='0:'+String(Math.floor((Date.now()-recordingStart)/1000)).padStart(2,'0')},250)}}
  function finish(){if(phase!=='stop')return;clearInterval(ticker);board=false;phase='saving';render();timer=setTimeout(()=>{if(root.isConnected){phase='copied';render()}},1100)}
  function paste(){if(phase==='paste'){phase='pasted';render()}}
  root.addEventListener('keydown',e=>{
    if(e.key==='Shift'&&phase==='screen')root.classList.add('ink-active');
    if(phase==='paste'&&(e.metaKey||e.ctrlKey)&&e.code==='KeyV'){e.preventDefault();e.stopPropagation();paste();return}
    const keys=[e.metaKey?'⌘':'',e.ctrlKey?'⌃':'',e.altKey?'⌥':'',e.shiftKey?'⇧':'',e.code.startsWith('Key')?e.code.slice(3):e.key.toUpperCase()].filter(Boolean).join(' ');
    if(keys.replaceAll(' ','')===shortcut.replaceAll(' ','')){e.preventDefault();e.stopPropagation();if(phase==='start')start();else if(phase==='stop')finish()}
  });
  root.addEventListener('keyup',e=>{if(e.key==='Shift')root.classList.remove('ink-active')});root.addEventListener('focusout',e=>{if(!root.contains(e.relatedTarget))root.classList.remove('ink-active')});
  render();
};
