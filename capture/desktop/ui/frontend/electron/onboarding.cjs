// A private, Rust-owned presentation transport. No capture commands or filesystem IPC.
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
    testInstance:v.testInstance===true,practice:phases.has(v.practice)?v.practice:null,firstCaptureRequired:v.firstCaptureRequired===true,
    ...(Array.isArray(v.practiceBoard)&&v.practiceBoard.length===4&&v.practiceBoard.every(Number.isFinite)&&v.practiceBoard[2]>0&&v.practiceBoard[3]>0?{practiceBoard:v.practiceBoard}:{}),
    ...(Array.isArray(v.anchor)&&v.anchor.length===4&&v.anchor.every(Number.isFinite)?{anchor:v.anchor}:{})};
}
// Screen coordinates supplied by this process's typed Whiteboard window only.
function coachPosition(area,anchor,board,phase){
  const width=380,height=350,gap=18;
  const clamp=([x,y])=>[Math.round(Math.max(area.x,Math.min(area.x+area.width-width,x))),Math.round(Math.max(area.y,Math.min(area.y+area.height-height,y)))];
  const [x,y,w,h]=anchor||[area.x+area.width/2-150,area.y+35,300,50];
  const candidates=[[x+w/2-width/2,y+h+gap]];
  if(board){const [bx,by,bw,bh]=board;candidates.unshift([bx+bw+gap,by+Math.max(0,(bh-height)/2)],[bx-width-gap,by+Math.max(0,(bh-height)/2)],[bx,by+bh+gap]);}
  if(!anchor&&!board)candidates.unshift([area.x+area.width-width-24,area.y+area.height*.38]);
  const overlaps=([px,py],rect)=>rect&&px<rect[0]+rect[2]+8&&px+width>rect[0]-8&&py<rect[1]+rect[3]+8&&py+height>rect[1]-8;
  const options=candidates.map(clamp);
  const position=options.find(p=>!overlaps(p,board)&&!overlaps(p,anchor))||options[0];
  return {x:position[0],y:position[1],arrow:Math.max(45,Math.min(width-45,x+w/2-position[0])),pointsUp:!board&&['whiteboard','stop','copied','locate'].includes(phase)};
}
module.exports={project,actions,coachPosition};
if(!process.versions.electron) return;
const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
app.setName('Apparent Onboarding Test');
if(process.env.APPARENT_UI_PROFILE)app.setPath('userData',process.env.APPARENT_UI_PROFILE);
let window,state=null,buffer='',page,lastPlacement='';
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
  const focal=v.practiceBoard||v.anchor;
  const target=focal?screen.getDisplayMatching({x:Math.round(focal[0]),y:Math.round(focal[1]),width:Math.max(1,Math.round(focal[2])),height:Math.max(1,Math.round(focal[3]))}):screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area=target.workArea;
  if(coach){
    const placement=coachPosition(area,v.anchor,v.practiceBoard,v.practice);
    // Reposition on stage/target changes; leave a user's manual adjustment alone between ticks.
    const key=JSON.stringify([v.practice,v.anchor,v.practiceBoard,area]);
    if(key!==lastPlacement){window.setPosition(placement.x,placement.y,false);lastPlacement=key;}
    const actual=window.getBounds();
    v={...v,coachArrow:placement.arrow,coachPointsUp:placement.pointsUp&&actual.x===placement.x&&actual.y===placement.y};
  } else {
    lastPlacement='';window.setPosition(area.x+Math.max(0,Math.round((area.width-760)/2)),area.y+Math.max(0,Math.round((area.height-720)/2)),false);
  }
  window.webContents.send('onboarding:state',v);if(coach)window.showInactive();else window.show();
}
