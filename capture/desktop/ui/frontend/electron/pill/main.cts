// @ts-nocheck -- preserved bounded Electron host; renderer and public view are typed.
'use strict';
const {app,BrowserWindow,ipcMain,session,screen,nativeTheme,Menu,clipboard} = require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const protocol=require('./protocol.cjs');
const geometry=require('./geometry.cjs');
if(!['linux','darwin'].includes(process.platform))process.exit(1);
const hyprland=process.platform==='linux' && (Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE) || (process.env.XDG_CURRENT_DESKTOP||'').toLowerCase().split(':').includes('hyprland'));
app.setName('Apparent recording controls');
app.setPath('userData',path.join(app.getPath('appData'),'apparent-pill'));
nativeTheme.themeSource='system';
const page=pathToFileURL(path.join(__dirname,'../../dist/pill/index.html')).href;
let sharingConfirmation=null;
let window,current=null,buffer='',pending=false,loaded=false,placed=false,activated=false,pendingPlace=null;
let lastInput=Date.now(),hovered=false,expected=null,rendererReady=false,readySent=false,renderDeadline=Date.now()+5000,pasteGesture=null,lastFrame='',lastRaise=0;
let visibleWidth=0,layoutPhase=null;
let capture='',pickerDismissed='',pickerFocused=false,keyboardCapture='';
let keyboardMode=false,createWindow=null,retiredWindows=[],admittedWindowId=null;
function reconcileKeyboardWindow(view){
  const next=!!view;
  if(process.platform!=='linux'||next===keyboardMode||!createWindow)return false;
  keyboardMode=next;
  const bounds=window.getBounds();retiredWindows.push(window);
  loaded=false;rendererReady=false;readySent=false;activated=false;admittedWindowId=null;
  renderDeadline=Date.now()+5000;keyboardCapture='';pickerFocused=false;
  createWindow(next,bounds);return true;
}
function focusPicker(focused){
  pickerFocused=focused;
  // Linux requires the constructor's activatable window role. Its runtime
  // setFocusable API does not convert the non-focusable recording surface.
  if(process.platform!=='linux')window.setFocusable(focused);
  if(focused)window.focus();else window.blur();
}
const {Controller}=require('./t3.cjs');
const destinations=new Controller(()=>{if(loaded&&window&&!window.isDestroyed()){
  const view=destinations.view();
  if(reconcileKeyboardWindow(view))return;
  if(!view&&pickerFocused)focusPicker(false);
  window.webContents.send('pill:destinations',view);void measurePicker();
}});
async function measurePicker(){if(current)await requestLayout(current.revision);}
let requestLayout=async()=>{};
const diagnostics=require('./diagnostics.cjs');
function diagnosticSnapshot(){
 const now=Date.now(),stateAge=current?Math.max(0,Math.min(86400000,now-lastInput)):null;
 return {pid:process.pid,phase:current?.phase??null,revision:current?.revision??null,rendererReady,activated,loaded,
   stateAgeMs:stateAge,renderReadinessDeadlineRemainingMs:Math.max(0,Math.min(5000,renderDeadline-now))};
}
function fail(reason,detail){diagnostics.writePillDiagnostic(reason,diagnosticSnapshot(),detail);app.exit(1);}
function note(reason,detail){diagnostics.writePillDiagnostic(reason,diagnosticSnapshot(),detail);}
process.on('uncaughtExceptionMonitor',()=>note('uncaught_exception'));
function position(bounds){
 const next={...window.getBounds(),...bounds};
 const area=screen.getDisplayMatching(next).workArea;
 expected={...next,...geometry.clamp(next,area)};window.setBounds(expected);
}
function applyPlacement(point){
  pendingPlace=point;
  if(!window)return;
  const physical={x:Math.round(point[0]),y:Math.round(point[1])};
  const anchor=process.platform==='linux'?screen.screenToDipPoint(physical):physical;
  const area=screen.getDisplayNearestPoint(anchor).workArea;
  const bounds=window.getBounds();
  position({x:Math.round(area.x+(area.width-(visibleWidth||bounds.width))/2),y:area.y+34});placed=true;
}
function emit(message){process.stdout.write(JSON.stringify(message)+'\n');}
function reportFrame(){
  if(!rendererReady || current?.phase!=='recording' || !window.isVisible())return;
  const b=window.getBounds(),origin=process.platform==='linux'?screen.dipToScreenPoint({x:b.x,y:b.y}):b;
  const scale=process.platform==='linux'?screen.getDisplayMatching(b).scaleFactor:1;
  const frame=[origin.x,origin.y,b.width*scale,b.height*scale],revision=current.revision,key=JSON.stringify({revision,frame});
  if(key!==lastFrame){lastFrame=key;emit({revision,frame});}
}
function publish(value){
  const next=protocol.view(value);
  if(current && next.revision<current.revision)throw Error('Old pill state');
  if(!current || next.revision!==current.revision)pending=false;
  if(current && next.revision!==current.revision){pasteGesture=null;sharingConfirmation=null;}
  if(!current || next.revision!==current.revision || next.phase!==current.phase){rendererReady=false;renderDeadline=Date.now()+5000;}
  if(next.phase==='hidden')layoutPhase=null;
  current=next;lastInput=Date.now();
  if(loaded){window.webContents.send('pill:state',current);visibility();}
}
function visibility(){
  if(rendererReady&&activated){
    for(const old of retiredWindows.splice(0)){if(!old.isDestroyed()){
      const oldId=Number(old.getMediaSourceId().split(':')[1]);old.destroy();
      if(Number.isSafeInteger(oldId))emit({retiredWindowId:oldId});
    }}
  }
  if(current?.phase==='hidden'||pickerDismissed&&pickerDismissed===capture){
    window.hide();for(const old of retiredWindows)if(!old.isDestroyed())old.hide();return;
  }
  if(!activated){window.hide();return;}
  if(rendererReady && current){
    if(!window.isVisible())window.showInactive();
  }
  if(rendererReady && window.isVisible() && destinations.view() && keyboardCapture!==capture){
    keyboardCapture=capture;focusPicker(true);
  }
}
function valid(event,args){
  if(!window || window.isDestroyed() || event.sender!==window.webContents ||
    event.senderFrame!==window.webContents.mainFrame || event.senderFrame.url!==page || args.length)throw Error('Forbidden pill bridge request');
}
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
  buffer+=chunk;
  if(Buffer.byteLength(buffer)>2000000){fail('invalid_parent_frame',{frameCode:'oversize'});return;}
  let end;
  while((end=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    try{
      const message=JSON.parse(line);
      if(message.type==='state'){
        publish(message.view);
        if(typeof message.capture==='string'&&message.capture.length<160){capture=message.capture;void destinations.update(capture,current.phase,message.t3Eligible===true).catch(()=>{});}
      }
      else if(message.type==='handoff-ready')void destinations.ready(message.capture,message.text).catch(()=>{});
      else if(message.type==='activate'){if(message.windowId!==undefined&&message.windowId!==admittedWindowId)continue;activated=true;if(loaded)visibility();emit({activated:true,windowId:admittedWindowId});}
      else if(message.type==='place' && Array.isArray(message.point) && message.point.length===2 && message.point.every(Number.isFinite)){
        applyPlacement(message.point);
      }else if(message.type==='position' && process.platform==='linux' && Array.isArray(message.point) && message.point.length===2 && message.point.every(Number.isFinite)){
        if(window && activated && rendererReady && window.isVisible() && message.revision===current?.revision && current.phase==='recording' && current.draggable){
          const point=screen.screenToDipPoint({x:Math.round(message.point[0]),y:Math.round(message.point[1])});
          // Electron owns mapping as well as geometry. A native X11 remap races
          // Chromium visibility and can orphan the surface in Hyprland.
          const before=window.getBounds();
          if(before.x!==point.x || before.y!==point.y){
            if(hyprland)window.hide();
            position(point);
            if(hyprland)window.showInactive();
          }
        }
      }else throw Error('Invalid parent message');
    }catch{fail('invalid_parent_frame',{frameCode:'malformed'});}
  }
});
process.stdin.on('end',()=>{if(buffer.length)note('invalid_parent_frame',{frameCode:'truncated'});else note('parent_stream_end');app.quit();});
process.stdin.on('error',()=>{note('parent_stream_error');app.quit();});
app.whenReady().then(()=>{
  let appliedShape=null,shapePaint=null,documentGeneration=0,inputRegions=null,layoutGeneration=0,layoutKey='';
  Menu.setApplicationMenu(null);
  if(process.platform==='darwin')app.setActivationPolicy('accessory');
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,reply)=>reply(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  session.defaultSession.webRequest.onBeforeRequest((details,reply)=>reply({cancel:!details.url.startsWith('file:')}));
  ipcMain.handle('pill:read',(event,...args)=>{valid(event,args);return current;});
  ipcMain.handle('pill:destinations',(event,...args)=>{valid(event,args);return destinations.view();});
  ipcMain.handle('pill:destination-action',async(event,key,action,id,...args)=>{
    valid(event,args);if(key!==capture||!['processing','completed'].includes(current?.phase))throw Error('Recording changed');
    try{
    if(action==='choose')await destinations.confirm(key,id);
    else if(action==='retry')await destinations.retry(key);
    else if(action==='cancel')await destinations.cancel(key);
    else if(action==='copy'){
      const text=destinations.text(key);await clipboard.writeText(text);
      if(await clipboard.readText()!==text)throw Error('Copy not confirmed');
    }
    else if(action==='setup'){if(destinations.view()?.phase!=='setup')throw Error('Setup unavailable');emit({revision:current.revision,action:'settings-agents'});}
    else if(action==='dismiss'){pickerDismissed=capture;window.hide();}
    else throw Error('Invalid destination action');
    return destinations.view();
    }catch{throw Error('Handoff action not confirmed');}
  });
  ipcMain.handle('pill:destination-focus',(event,focused,...args)=>{
    valid(event,args);if(typeof focused!=='boolean'||!destinations.view())throw Error('Picker unavailable');
    focusPicker(focused);
  });
  ipcMain.handle('pill:act',async(event,revision,action,drop=false,...args)=>{
    valid(event,args);
    if(pending)throw Error('Pill action pending');
    if(typeof drop!=='boolean' || drop && action!=='paste')throw Error('Invalid paste gesture');
    const confirming=action==='confirm-public-link'||action==='cancel-public-link';
    const message=protocol.command(current,revision,confirming?'copy-link':action);
    if(confirming&&sharingConfirmation!==revision)throw Error('Sharing confirmation expired');
    if(action==='cancel-public-link'){sharingConfirmation=null;return {cancelled:true};}
    if(action==='confirm-public-link'){sharingConfirmation=null;message.action='copy-public-link';}
    else if(action==='copy-link'&&!current.actions.some(a=>a.id==='copy-link'&&a.label==='Cancel upload')){
      sharingConfirmation=revision;return {confirmationRequired:true};
    } else sharingConfirmation=null;
    if(drop){
      if(!pasteGesture || pasteGesture.revision!==revision || Date.now()>pasteGesture.until)throw Error('Paste gesture expired');
      const dip=screen.getCursorScreenPoint();
      const point=process.platform==='linux'?screen.dipToScreenPoint(dip):dip;
      message.target=[point.x,point.y];
    }
    pasteGesture=null;
    pending=true;
    emit(message);
  });
  // Renderer never chooses native dimensions or screen coordinates.
  // Parent's bounded state defines content; main measures its own trusted document.
  async function measure(revision){
    if(!loaded || window.isDestroyed())return;
    const measuredWindow=window,document=documentGeneration;
    if(current?.phase!=='hidden' && Date.now()-lastInput>5000){fail('parent_state_timeout');return;}
    try{
      const area=screen.getDisplayMatching(window.getBounds()).workArea;
      const size=await window.webContents.executeJavaScript(`(() => {
        document.documentElement.style.setProperty('--pill-limit', '${area.width}px');
        const element=document.querySelector('main'),rect=element?.getBoundingClientRect();
        const regions=[...document.querySelectorAll('.destination-assembly,.destination-notification')].map(element=>{
          const r=element.getBoundingClientRect();return {x:r.x-rect.x,y:r.y-rect.y,width:r.width,height:r.height,radius:parseFloat(getComputedStyle(element).borderTopLeftRadius)||0};
        });
        return rect && {width:Math.ceil(rect.width),height:Math.ceil(rect.height),revision:Number(element.dataset.revision),regions};
      })()`);
      // A newer parent state may arrive while the renderer answers. Never apply
      // geometry measured for an obsolete document.
      if(window!==measuredWindow||document!==documentGeneration||!loaded||revision!==current?.revision || size?.revision!==revision || !Number.isFinite(size.width)||!Number.isFinite(size.height))return false;
      const bounds=window.getBounds();
      const width=Math.min(area.width,Math.max(100,Math.ceil(size.width)));
      const height=Math.min(area.height,Math.max(58,Math.ceil(size.height)));
      const before=window.getBounds();
      const resized=before.width!==width || before.height!==height;
      const nextVisibleWidth=current.phase==='recording' && current.noteCount===0?width-72:width;
      const nextLayoutKey=JSON.stringify([document,revision,width,height,size.regions]);
      if(nextLayoutKey!==layoutKey){layoutKey=nextLayoutKey;++layoutGeneration;}
      const measuredLayout=layoutGeneration;
      const repaintResize=process.platform==='linux' && resized && window.isVisible();
      if(repaintResize){window.setShape([{x:0,y:0,width:nextVisibleWidth,height}]);appliedShape=null;}
      const phaseChanged=layoutPhase!==current.phase;
      const oldCenterWidth=phaseChanged && visibleWidth>0?visibleWidth:before.width;
      const newCenterWidth=phaseChanged?nextVisibleWidth:width;
      // Keep layout resizes mapped. Hyprland can lose a transparent XWayland
      // surface during hide/setBounds/showInactive even when Electron reports
      // it visible. Update its bounds and input shape in place, then repaint.
      if(resized||phaseChanged)position({x:Math.round(before.x+(oldCenterWidth-newCenterWidth)/2),y:before.y,width,height});
      visibleWidth=nextVisibleWidth;layoutPhase=current.phase;
      inputRegions=size.regions?.length?size.regions:null;
      if(process.platform==='linux'){
        if(resized)window.webContents.invalidate();
        if(repaintResize)shapePaint=window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
        const pendingPaint=shapePaint;
        if(pendingPaint)await pendingPaint;
        if(window!==measuredWindow||window.isDestroyed()||document!==documentGeneration||measuredLayout!==layoutGeneration||!loaded||revision!==current?.revision)return false;
        if(shapePaint===pendingPaint)shapePaint=null;
        const scale=screen.getDisplayMatching(window.getBounds()).scaleFactor;
        const key=JSON.stringify([visibleWidth,height,scale,inputRegions]);
        if(key!==appliedShape){window.setShape(inputRegions?geometry.regionShape(inputRegions):geometry.shape(visibleWidth,height));appliedShape=key;}
        if(resized)window.webContents.invalidate();
      }
      return size.revision===current?.revision;
    }catch{
      if(window===measuredWindow&&document===documentGeneration&&loaded&&!window.isDestroyed())fail('layout_measurement_exception');
      return false;
    }
  }
  requestLayout=measure;
  const watchdog=setInterval(()=>{
    if(!rendererReady && Date.now()>renderDeadline){fail('render_readiness_timeout');return;}
    if(current?.phase!=='hidden' && Date.now()-lastInput>5000)fail('parent_state_timeout');
  },500);
  ipcMain.handle('pill:layout',async(event,revision,...args)=>{
    valid(event,args);
    if(!Number.isSafeInteger(revision) || revision!==current?.revision)return;
    const committed=current.phase==='hidden' || await measure(revision);
    if(committed && revision===current?.revision){
      // React invokes this after committing the authoritative snapshot. HTML load
      // alone must never retire the functioning previous presentation.
      rendererReady=true;
      if(!readySent){
        const windowId=Number(window.getMediaSourceId().match(/^window:(\d+):\d+$/)?.[1]);
        if(!Number.isSafeInteger(windowId) || windowId<=0 || windowId>0xffffffff){fail('invalid_native_window_identity');return;}
        if(process.platform==='darwin'){
          try{
            if(require('./native/window.node').preventActivation(windowId)!==true)throw Error('Native window setup refused');
          }catch{fail('native_window_setup_failed');return;}
        }
        if(process.platform==='linux')window.setTitle('Apparent Recording Controls '+windowId.toString(16));
        admittedWindowId=windowId;readySent=true;emit({ready:true,windowId});
      }
      visibility();
      reportFrame();
    }
  });
  ipcMain.handle('pill:begin-paste',(event,revision,...args)=>{
    valid(event,args);protocol.command(current,revision,'paste');
    if(pending)throw Error('Pill action pending');
    pasteGesture={revision,until:Date.now()+5000};
    window.setIgnoreMouseEvents(false);
  });
  ipcMain.handle('pill:cancel-paste',(event,...args)=>{valid(event,args);pasteGesture=null;});
  ipcMain.handle('pill:begin-drag',async(event,revision,...args)=>{
    valid(event,args);
    if(process.platform!=='linux' || revision!==current?.revision || current.phase!=='recording' || !current.draggable || pending)throw Error('Drag unavailable');
    const point=screen.getCursorScreenPoint(),bounds=window.getBounds();
    const lead=await window.webContents.executeJavaScript(`(() => {const r=document.querySelector('.lead')?.getBoundingClientRect();return r && {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
    if(revision!==current?.revision || !current.draggable || !lead || point.x<bounds.x+lead.x || point.y<bounds.y+lead.y || point.x>=bounds.x+lead.x+lead.width || point.y>=bounds.y+lead.y+lead.height)throw Error('Drag target changed');
    const physical=screen.dipToScreenPoint(point);
    emit({revision,action:'drag',target:[physical.x,physical.y]});
  });
  const pointerTimer=setInterval(()=>{
    if(!loaded || window.isDestroyed())return;
    const point=screen.getCursorScreenPoint(),bounds=window.getBounds();
    const inside=window.isVisible() && (inputRegions?geometry.containsRegions({x:point.x-bounds.x,y:point.y-bounds.y},inputRegions):geometry.contains(point,{...bounds,width:visibleWidth||bounds.width}));
    // A focused XWayland app can sit above the visually pinned pill in X11's
    // input stack. Raise this exact child surface without taking focus.
    if(process.platform==='linux' && inside && (!hovered || Date.now()-lastRaise>250)){
      window.moveTop();lastRaise=Date.now();
    }
    if(inside!==hovered){hovered=inside;emit({hovered});}
    if(pasteGesture && Date.now()>pasteGesture.until)pasteGesture=null;
    if(process.platform==='darwin')window.setIgnoreMouseEvents(!inside && !pasteGesture,{forward:true});
  },16);
  createWindow=(focusable,bounds)=>{
    const owned=new BrowserWindow({...(process.platform==='darwin'?{type:'panel',acceptFirstMouse:true}:{focusable}),width:640,height:58,show:false,frame:false,transparent:true,resizable:false,
    fullscreenable:false,skipTaskbar:true,hasShadow:false,alwaysOnTop:true,title:'Apparent recording controls',
    paintWhenInitiallyHidden:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,spellcheck:false,backgroundThrottling:false}});
    window=owned;
    ++documentGeneration;++layoutGeneration;layoutKey='';shapePaint=null;appliedShape=null;inputRegions=null;
    if(!bounds){visibleWidth=0;layoutPhase=null;}
    if(bounds)position(bounds);else if(pendingPlace)applyPlacement(pendingPlace);
  window.setAlwaysOnTop(true,'screen-saver');
  window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  window.setContentProtection(false);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  window.webContents.on('page-title-updated',event=>event.preventDefault());
  window.webContents.on('render-process-gone',(_event,details)=>{if(window!==owned)return;fail('renderer_gone',{
    rendererReason:details?.reason,exitCode:details?.exitCode});});
  window.webContents.on('did-start-loading',()=>{if(window!==owned)return;++documentGeneration;++layoutGeneration;layoutKey='';shapePaint=null;appliedShape=null;loaded=false;pending=false;rendererReady=false;pasteGesture=null;sharingConfirmation=null;renderDeadline=Date.now()+5000;});
  window.webContents.on('did-finish-load',()=>{
    if(window!==owned)return;loaded=true;
    if(reconcileKeyboardWindow(destinations.view()))return;
    if(!placed&&!bounds){const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      position({x:Math.round(area.x+(area.width-640)/2),y:area.y+34});}
    if(current)window.webContents.send('pill:state',current);
    visibility();
  });
  window.on('closed',()=>{if(window!==owned)return;note('window_closed');clearInterval(watchdog);clearInterval(pointerTimer);app.quit();});
  window.on('show',()=>{if(window===owned)reportFrame();});
  window.on('move',()=>{if(window===owned)reportFrame();});
  window.on('resize',()=>{if(window===owned)reportFrame();});
  // Hyprland assigns even override-redirect XWayland windows to a workspace.
  // Rust's existing native adapter pins only this exact child/window identity.
  if(process.platform==='linux'){
    for(const event of ['show','move','resize'])window.on(event,()=>{
      if(window!==owned)return;const visible=window.isVisible();
      // Hidden placement between captures must not spend native admission retries.
      if(activated && rendererReady && current && current.phase!=='hidden' && visible)
        emit({pin:true,phase:current.phase,activated,rendererReady,visible});
    });
  }
  window.on('move',()=>{
    if(window!==owned)return;const b=window.getBounds(),a=screen.getDisplayMatching(b).workArea;
    if(current?.draggable && expected && (b.x!==expected.x || b.y!==expected.y)){emit({moved:true});expected=b;}
    const {x,y}=geometry.clamp(b,a);
    if(x!==b.x||y!==b.y)position({x,y});
  });
    void owned.loadURL(page);
  };
  createWindow(false);
});
app.on('window-all-closed',()=>app.quit());
