// A private, Rust-owned presentation transport. No capture commands or filesystem IPC.
const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const actions = new Set(['continue','back','later','close','change-shortcut','grant:screen-recording','grant:microphone','grant:accessibility','grant:speech-recognition','grant:camera','practice-paste','practice-pasted','practice-finish','pen:coral','pen:purple','pen:blue','pen:green']);
const steps = new Set(['welcome','how-it-works','permissions','shortcut','try-it','done']);
const phases = new Set(['start','whiteboard','board-ink','screen-ink','stop','preparing','copied','paste','locate','complete','retry','copy-failed']);
function project(v) {
  if(v?.type!=='state'||!steps.has(v.step)||!Array.isArray(v.rows)||v.rows.length>5||typeof v.ready!=='boolean')return null;
  const rows=[];
  for(const r of v.rows){if(!['screen-recording','microphone','accessibility','speech-recognition','camera'].includes(r.permission)||!['granted','denied','not-determined'].includes(r.status))return null;rows.push({permission:r.permission,status:r.status,required:r.required===true,reopening:r.reopening===true,relaunch:r.relaunch===true});}
  return {step:v.step,ready:v.ready,fix:v.fix===true,rows,index:v.index,count:v.count,shortcut:typeof v.shortcut==='string'?v.shortcut.slice(0,80):'',shortcutEditing:v.shortcutEditing===true,shortcutChosen:v.shortcutChosen===true,
    penPicker:v.penPicker===true,penSelected:v.penSelected===true,penError:v.penError===true,penRgb:Array.isArray(v.penRgb)&&v.penRgb.length===3&&v.penRgb.every(n=>Number.isInteger(n)&&n>=0&&n<=255)?v.penRgb:[255,59,48],
    practice:phases.has(v.practice)?v.practice:null,firstCaptureRequired:v.firstCaptureRequired===true,
    ...(Array.isArray(v.anchor)&&v.anchor.length===4&&v.anchor.every(Number.isFinite)?{anchor:v.anchor}:{})};
}
module.exports={project,actions};
if(!process.versions.electron) return;
app.setName('Apparent Onboarding Test');
if(process.env.APPARENT_UI_PROFILE)app.setPath('userData',process.env.APPARENT_UI_PROFILE);
let window,state=null,buffer='',page;
app.whenReady().then(()=>{
  app.dock?.hide();session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  window=new BrowserWindow({width:760,height:720,show:false,frame:false,transparent:true,resizable:false,backgroundColor:'#00000000',webPreferences:{preload:path.join(__dirname,'onboarding-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.removeMenu();page=pathToFileURL(path.join(__dirname,'../dist/index.html')).href+'?nativeOnboarding';
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());window.webContents.on('will-attach-webview',e=>e.preventDefault());
  const valid=e=>!window.isDestroyed()&&e.sender===window.webContents&&e.senderFrame===window.webContents.mainFrame&&e.senderFrame.url===page;
  ipcMain.handle('onboarding:state',(e,...args)=>{if(!valid(e)||args.length)throw Error('Forbidden state request');return state});
  ipcMain.handle('onboarding:action',(e,...args)=>{if(!valid(e)||args.length!==1||!actions.has(args[0]))throw Error('Forbidden onboarding action');process.stdout.write(JSON.stringify({action:args[0]})+'\n');return true});
  window.webContents.on('did-finish-load',()=>{if(state)present(state)});
  window.on('closed',()=>{process.stdout.write('{"action":"close"}\n');app.quit()});
  void window.loadURL(page);
  process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;if(buffer.length>131072){app.quit();return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const v=JSON.parse(line);if(v.type==='close'){app.quit();return;}if(v.type==='hide'){if(state?.step!=='try-it')window.hide();continue;}if(v.type==='show'){if(state)present(state);continue;}const next=project(v);if(next){state=next;present(next);}}catch{app.quit();return;}}});
  process.stdin.on('end',()=>app.quit());process.stdin.resume();
});
function present(v){
  if(!window||window.isDestroyed())return;
  if(v.shortcutEditing){window.hide();return;}
  const coach=v.step==='try-it';
  window.setAlwaysOnTop(coach,'floating');window.setSize(coach?380:760,coach?350:720,false);
  window.setVisibleOnAllWorkspaces(coach,{visibleOnFullScreen:coach});
  const target=v.anchor?screen.getDisplayMatching({x:Math.round(v.anchor[0]),y:Math.round(v.anchor[1]),width:Math.max(1,Math.round(v.anchor[2])),height:Math.max(1,Math.round(v.anchor[3]))}):screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area=target.workArea;
  const [x,y,w,h]=v.anchor||[area.x+area.width/2-150,area.y+35,300,50];
  let px,py;
  if(coach){const top=['whiteboard','stop','copied','paste','preparing','locate'].includes(v.practice);px=top?x+w/2-100:area.x+area.width-415;py=top?y+h+22:area.y+Math.round(area.height*.38);}
  else{px=area.x+Math.round((area.width-760)/2);py=area.y+Math.max(10,Math.round((area.height-720)/2));}
  window.setPosition(Math.max(area.x,Math.min(area.x+area.width-(coach?380:760),Math.round(px))),Math.max(area.y,Math.min(area.y+area.height-(coach?350:720),Math.round(py))),false);
  window.webContents.send('onboarding:state',v);if(coach)window.showInactive();else window.show();
}
