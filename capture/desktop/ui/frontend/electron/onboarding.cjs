const {PracticeHost}=require(process.versions.electron?'../dist/onboarding-practice-host.cjs':'./onboarding/practice-host.ts');
const {transparentBackgroundColor}=require('@apparent/ui/window-theme');
const {parseAction}=require('./onboarding-protocol.cjs');
const {coachDimensions,coachPosition}=require(process.versions.electron?'../dist/onboarding-presentation.cjs':'./onboarding/presentation.ts');
const {completedSelection}=require(process.versions.electron?'../dist/onboarding-selection.cjs':'./onboarding/selection.ts');
// A private, Rust-owned presentation transport. No capture commands or filesystem IPC.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const actions = new Set(['continue','back','later','close','change-shortcut','grant:screen-recording','grant:microphone','grant:accessibility','grant:speech-recognition','grant:camera','practice-paste','practice-locate','practice-pasted','practice-finish','pen:coral','pen:purple','pen:blue','pen:green']);
const steps = new Set(['welcome','how-it-works','permissions','shortcut','try-it','done']);
const phases = new Set(['start','screen','whiteboard','board-ink','screen-ink','note','stop','preparing','copied','paste','locate','complete','retry','copy-failed']);
function project(v) {
  if(v?.type!=='state'||!steps.has(v.step)||!Array.isArray(v.rows)||v.rows.length>5||typeof v.ready!=='boolean')return null;
  const rows=[];
  for(const r of v.rows){if(!r||typeof r!=='object'||!['screen-recording','microphone','accessibility','speech-recognition','camera'].includes(r.permission)||!['granted','denied','not-determined'].includes(r.status))return null;rows.push({permission:r.permission,status:r.status,required:r.required===true,reopening:r.reopening===true,relaunch:r.relaunch===true});}
  const b=v.boardView;
  const boardView=b&&typeof b.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(b.id)&&Array.isArray(b.strokes)&&b.strokes.length<=500&&b.strokes.every(s=>Array.isArray(s)&&s.length<=2000&&s.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<1600&&p[1]>=0&&p[1]<1100))&&Array.isArray(b.color)&&b.color.length===3&&b.color.every(n=>Number.isInteger(n)&&n>=0&&n<=255)?{id:b.id,strokes:b.strokes,color:b.color}:null;
  return {tutorial:['skipped','watched','practiced'].includes(v.tutorial)?v.tutorial:null,step:v.step,ready:v.ready,fix:v.fix===true,rows,index:v.index,count:v.count,shortcut:typeof v.shortcut==='string'?v.shortcut.slice(0,80):'',shortcutEditing:v.shortcutEditing===true,shortcutChosen:v.shortcutChosen===true,shortcutTested:v.shortcutTested===true,shortcutSelectionReleased:v.shortcutSelectionReleased===true,boardView,
    penSaveId:typeof v.penSaveId==='string'?v.penSaveId:undefined,penPicker:v.penPicker===true,penSelected:v.penSelected===true,penError:v.penError===true,penRgb:Array.isArray(v.penRgb)&&v.penRgb.length===3&&v.penRgb.every(n=>Number.isInteger(n)&&n>=0&&n<=255)?v.penRgb:[255,59,48],
    platform:v.platform==='linux'?'linux':'macos',shortcutEditor:v.shortcutEditor&&typeof v.shortcutEditor==='object'?{recording:v.shortcutEditor.recording===true,externallyManaged:v.shortcutEditor.externallyManaged===true,error:typeof v.shortcutEditor.error==='string'?v.shortcutEditor.error.slice(0,240):null}:null,
    testInstance:v.testInstance===true,practice:phases.has(v.practice)?v.practice:null,firstCaptureRequired:v.firstCaptureRequired===true,
    ...(Array.isArray(v.practiceBoard)&&v.practiceBoard.length===4&&v.practiceBoard.every(Number.isFinite)&&v.practiceBoard[2]>0&&v.practiceBoard[3]>0?{practiceBoard:v.practiceBoard}:{}),
    ...(Array.isArray(v.anchor)&&v.anchor.length===4&&v.anchor.every(Number.isFinite)?{anchor:v.anchor}:{})};
}
// Screen coordinates supplied by this process's typed Whiteboard window only.
function setupDimensions(area,shortcut){return {width:Math.min(area.width,760),height:Math.min(area.height,shortcut?520:720)};}
function nativeRectangle(rect,toDip){
  if(!rect)return rect;
  const start=toDip({x:Math.round(rect[0]),y:Math.round(rect[1])});
  const end=toDip({x:Math.round(rect[0]+rect[2]),y:Math.round(rect[1]+rect[3])});
  return [start.x,start.y,Math.max(1,end.x-start.x),Math.max(1,end.y-start.y)];
}
// A renderer has no useful lifetime after its Rust parent disconnects.
// Keep the error listener installed while closing: write callbacks/errors can arrive later.
function parentChannel(output,onLost){
  let connected=true;
  const lost=error=>{if(!connected)return;connected=false;onLost(error)};
  output.on('error',lost);
  return {
    send(action){
      if(!connected)return false;
      try{output.write(JSON.stringify(typeof action==='string'?{action}:action)+'\n',error=>{if(error)lost(error)});return true;}
      catch(error){lost(error);return false;}
    },
    close(){connected=false},
  };
}
module.exports={project,actions,coachDimensions,setupDimensions,nativeRectangle,coachPosition,parentChannel};
if(!process.versions.electron) return;
const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const {removeCompositorBorder}=require('../dist/onboarding-hyprland.cjs');
if (process.env.APPARENT_DESKTOP_REPORTING === '1') {
  require('../dist/assets/reporting.cjs').install(app, kind => require('./runtime.cjs').reportException(require('node:os').homedir(), kind));
}
app.setName(process.env.APPARENT_TEST_INSTANCE==='1'?'apparent onboarding preview':'apparent onboarding');
app.setPath('userData',path.join(app.getPath('appData'),'apparent-onboarding'));
if(process.env.APPARENT_UI_PROFILE)app.setPath('userData',process.env.APPARENT_UI_PROFILE);
const practiceHost=new PracticeHost();
let practiceEnabled=false;
let window,state=null,buffer='',page,lastPlacement='',lastMode=null,closing=false,borderReady=false,borderPending=false,borderAttempts=0;
let connect;
const channel=parentChannel(process.stdout,error=>{
  const expected=['EPIPE','ECONNRESET','ERR_STREAM_DESTROYED','ERR_STREAM_WRITE_AFTER_END'].includes(error?.code);
  if(!expected)console.error('Onboarding parent channel failed:',error);
  shutdown(expected?0:1);
});
function shutdown(code=0){
  if(closing)return;
  closing=true;channel.close();connect?.close();
  if(code)app.exit(code);else app.quit();
}
app.whenReady().then(()=>{
  app.dock?.hide();session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  window=new BrowserWindow({width:760,height:720,show:false,frame:false,transparent:true,resizable:false,backgroundColor:transparentBackgroundColor,webPreferences:{preload:path.join(__dirname,'onboarding-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.setTitle(`Apparent onboarding ${process.pid}`);
  window.on('page-title-updated',event=>event.preventDefault());
  window.removeMenu();page=pathToFileURL(path.join(__dirname,process.argv.includes('--native-onboarding')?'../dist/index.html':'../dist/onboarding.html')).href+(process.argv.includes('--native-onboarding')?'?nativeOnboarding':'');
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());window.webContents.on('will-attach-webview',e=>e.preventDefault());
  const valid=e=>!window.isDestroyed()&&e.sender===window.webContents&&e.senderFrame===window.webContents.mainFrame&&e.senderFrame.url===page;
  const {ConnectSettings}=require('./connect.cjs');
  const {shell}=require('electron');
  connect=new ConnectSettings(require('node:os').homedir());
  let pendingConnect=false;
  const connectActions=new Set(['connect','allow','cancel','disable','open-browser']);
  ipcMain.handle('onboarding:connect',async(e,...args)=>{
    if(!valid(e)||state?.step!=='welcome'||state.penPicker||args.length!==1||!(args[0]===null||connectActions.has(args[0])))throw Error('Forbidden Connect request');
    if(pendingConnect)return {status:'error'};
    pendingConnect=true;
    try{
      const result=await connect.request(args[0]??undefined);
      if(closing||window.isDestroyed()||state?.step!=='welcome'||state.penPicker){connect.close();return {status:'cancelled'};}
      if(result.openUri!==undefined)await shell.openExternal(result.openUri);
      const {openUri,...safe}=result;return safe;
    }catch{return {status:'error'}}finally{pendingConnect=false;}
  });
  ipcMain.handle('onboarding:close-connect',(e,...args)=>{if(!valid(e)||args.length)throw Error('Forbidden Connect close');connect.close();});
  window.webContents.on('did-start-navigation',()=>connect.close());
  window.webContents.on('render-process-gone',()=>connect.close());
  ipcMain.handle('onboarding:state',(e,...args)=>{if(!valid(e)||args.length)throw Error('Forbidden state request');return state});
  ipcMain.handle('onboarding:action',(e,...args)=>{if(!valid(e)||args.length!==1)throw Error('Forbidden onboarding action');return channel.send(parseAction(args[0]))});
  window.webContents.on('render-process-gone',()=>shutdown(1));
  window.webContents.on('did-finish-load',()=>{if(state)present(state)});
  window.on('close',event=>{if(!closing&&state?.boardView){event.preventDefault();channel.send({action:'board',id:state.boardView.id,operation:'close'});}});
  window.on('closed',()=>{if(!closing)channel.send('close');shutdown()});
  void window.loadURL(page);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{
    if(closing)return;
    buffer+=chunk;
    if(buffer.length>16777216){shutdown(1);return;}
    let end;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      let v;
      try{v=JSON.parse(line)}catch{console.error('Invalid onboarding parent message');shutdown(1);return;}
      if(!v||typeof v!=='object'||Array.isArray(v)){shutdown(1);return;}
      if(v.type==='practice-batch'){
        try{const reply=practiceHost.accept(v);practiceEnabled=true;channel.send(reply);
          if(state){state={...state,practice:reply.stage};present(state);}}
        catch{shutdown(1);return;}
        continue;
      }
      if(v.type==='close'){shutdown();return;}
      if(v.type==='hide'){if(state?.step!=='try-it')window.hide();continue;}
      if(v.type==='show'){if(state)present(state,true);continue;}
      if(v.type==='desktop-shortcut'){
        if(state?.platform==='linux'&&v.keyCode===201&&v.key==='Copilot'&&Number.isInteger(v.modifiers)&&(v.modifiers&~6912)===0){
          window.webContents.send('onboarding:desktop-shortcut',{keyCode:201,modifiers:v.modifiers,key:'Copilot'});
        }
        continue;
      }
      const next=project(v);
      if(next){if(practiceEnabled)next.practice=practiceHost.state.stage;state=next;const accepted=completedSelection(next);if(accepted)channel.send(accepted);present(next);}
    }
  });
  process.stdin.on('end',()=>shutdown());process.stdin.on('error',error=>{console.error('Onboarding input failed:',error);shutdown(1)});process.stdin.resume();
});
function present(v,activate=false){
  if(closing||!window||window.isDestroyed())return;
  // Linux adapters report X11 pixels; Electron places windows in logical DIP.
  // macOS adapter coordinates are already points.
  if(process.platform==='linux')v={...v,anchor:nativeRectangle(v.anchor,p=>screen.screenToDipPoint(p)),practiceBoard:nativeRectangle(v.practiceBoard,p=>screen.screenToDipPoint(p))};
  const coach=v.step==='try-it'&&v.practice!==null&&v.practice!=='start';
  const board=!!v.boardView&&!!v.practiceBoard;
  const focal=v.practiceBoard||v.anchor;
  const target=focal?screen.getDisplayMatching({x:Math.round(focal[0]),y:Math.round(focal[1]),width:Math.max(1,Math.round(focal[2])),height:Math.max(1,Math.round(focal[3]))}):screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area=target.workArea;
  const shortcut=v.step==='shortcut'||(v.step==='try-it'&&!coach);
  const {width,height}=board?{width:Math.min(area.width,720),height:Math.min(area.height,540)}:coach?coachDimensions(area,v.practice):setupDimensions(area,shortcut);
  const mode=`${board}:${coach}:${width}:${height}`;
  if(lastMode!==mode){
    window.setAlwaysOnTop(coach||board,'floating');
    window.setHasShadow(!coach); // The coach card paints its own shaped shadow, not a rectangular window shadow.
    // X11 fixed-size constraints must change together, only when the mode changes.
    window.setMaximumSize(0,0);window.setMinimumSize(width,height);window.setMaximumSize(width,height);
    window.setSize(width,height,false);
    window.setVisibleOnAllWorkspaces(coach||board,{visibleOnFullScreen:coach||board});
    lastMode=mode;lastPlacement='';
  }
  if(board){
    if(lastPlacement!==v.boardView.id){const rect=v.practiceBoard;window.setPosition(Math.round(rect[0]),Math.round(rect[1]),false);window.focus();lastPlacement=v.boardView.id;}
  } else if(coach){
    const placement=coachPosition(area,v.anchor,v.practiceBoard,v.practice);
    // Reposition on stage/target changes; leave a user's manual adjustment alone between ticks.
    const key=JSON.stringify([v.practice,v.anchor,v.practiceBoard,area]);
    if(key!==lastPlacement){window.setPosition(placement.x,placement.y,false);lastPlacement=key;}
    const actual=window.getBounds();
    v={...v,coachArrow:placement.arrow,coachPointsUp:placement.pointsUp&&actual.x===placement.x&&actual.y===placement.y};
  } else {
    const key=JSON.stringify(['setup',height,area]);
    if(key!==lastPlacement){window.setPosition(area.x+Math.max(0,Math.round((area.width-width)/2)),area.y+Math.max(0,Math.round((area.height-height)/2)),false);lastPlacement=key;}
  }
  window.webContents.send('onboarding:state',v);
  if(!window.isVisible()||activate){if(coach)window.showInactive();else window.show();}
  if(!borderReady&&!borderPending&&borderAttempts<8){
    borderPending=true;borderAttempts++;
    void removeCompositorBorder(process.pid,window.getTitle()).then(()=>{borderReady=true},()=>{
      // Older Hyprland syntax is left unchanged. A later state tick can retry
      // mapping readiness; never change a different window as a fallback.
    }).finally(()=>{borderPending=false});
  }
}
