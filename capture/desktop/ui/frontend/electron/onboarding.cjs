const {parseAction,lines}=require('./onboarding-protocol.cjs');
const {app,BrowserWindow,ipcMain,session}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
app.whenReady().then(()=>{
 session.defaultSession.setPermissionRequestHandler((a,b,reply)=>reply(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 const w=new BrowserWindow({width:620,height:660,webPreferences:{preload:path.join(__dirname,'onboarding-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const page=pathToFileURL(path.join(__dirname,'../dist/onboarding.html')).href;
 w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 w.webContents.on('will-navigate',e=>e.preventDefault());
 w.webContents.on('will-attach-webview',e=>e.preventDefault());
 session.defaultSession.webRequest.onBeforeRequest((details,reply)=>reply({cancel:!details.url.startsWith(pathToFileURL(path.join(__dirname,'../dist/')).href)}));
 const states=new Map();
 ipcMain.handle('onboarding:action',(e,action)=>{
  if(e.sender!==w.webContents||e.senderFrame!==w.webContents.mainFrame||e.senderFrame.url!==page) throw Error('Forbidden onboarding command');
  process.stdout.write(JSON.stringify(parseAction(action))+'\n');
 });
 w.webContents.on('did-finish-load',()=>{for(const v of states.values())w.webContents.send('onboarding:view',v)});
 const receive=lines(v=>{if(!v||typeof v!=='object')return;if(['state','shortcut','shortcut-editor'].includes(v.type)){states.set(v.type,v);w.webContents.send('onboarding:view',v)}if(v.type==='hide')w.hide();if(v.type==='show'){w.show();w.focus()}if(v.type==='close')app.quit()});
 process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{try{receive(chunk)}catch{app.exit(1)}});
 process.stdin.on('end',()=>app.quit());w.on('close',()=>process.stdout.write('{"action":"close"}\n'));
 w.webContents.on('render-process-gone',()=>app.exit(1));w.webContents.on('did-fail-load',()=>app.exit(1));void w.loadURL(page);
});app.on('window-all-closed',()=>app.quit());
