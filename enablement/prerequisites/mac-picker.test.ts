import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {panelScript, prepareStorageChange, type PickerDriver} from './mac-picker.ts';
import {isolatePickerRuntime} from './mac-runtime.ts';
import * as files from 'node:fs/promises';
function deferred<T>() {
 let resolve!: (value:T)=>void;
 const promise=new Promise<T>(done=>{resolve=done;});
 return {promise,resolve};
}
function fixture(patch: Partial<PickerDriver> = {}) {
 const calls={change:0,openGo:0,navigate:0,picker:0};
 const driver:PickerDriver={storageIdle:async()=>{},change:async()=>{calls.change++;},picker:async()=>{calls.picker++;return 'owned-picker';},openGo:async()=>{calls.openGo++;},goSheet:async()=> 'owned-go-sheet',enterPath:async()=>{},pathReady:async()=> 'owned path readback',wait:async()=>{},navigate:async()=>{calls.navigate++;},...patch};
 return {calls,driver};
}
test('the picker runtime gets a private distinct bundle identity without changing its source', async () => {
 const directory=await files.mkdtemp(join(tmpdir(),'picker-identity-'));
 try {
  const source=join(directory,'Electron.app'),home=join(directory,'home');
  await files.mkdir(join(source,'Contents/MacOS'),{recursive:true});
  await files.mkdir(home,{mode:0o700});
  const executable=join(source,'Contents/MacOS/Electron'),plist=join(source,'Contents/Info.plist');
  const original={CFBundleIdentifier:'com.github.Electron',CFBundleName:'Electron',CFBundleDisplayName:'Electron'};
  await files.writeFile(executable,'synthetic runtime bytes');
  await files.writeFile(plist,JSON.stringify(original));
  const calls:string[]=[];
  const native=async(file:string,args:string[])=>{
   if(file==='/usr/libexec/PlistBuddy') {
    const target=args[2],value=JSON.parse(await files.readFile(target,'utf8'));
    if(args[1]==='Print :CFBundleIdentifier')return {stdout:value.CFBundleIdentifier+'\n'};
    assert.ok(target.startsWith(home+'/picker-runtime-'),'Metadata writes stay in the private copy');
    const match=args[1].match(/^Set :(CFBundleIdentifier|CFBundleName|CFBundleDisplayName) ([A-Za-z0-9.-]+)$/);
    assert.ok(match);value[match[1]]=match[2];await files.writeFile(target,JSON.stringify(value));
    calls.push(match[1]);return {stdout:''};
   }
   assert.equal(file,'/usr/bin/codesign');
   if(args.at(-1)===source) {
    assert.deepEqual(args,['--verify','--deep','--strict',source]);
    calls.push('verify-source');return {stdout:''};
   }
   assert.ok(args.at(-1)!.startsWith(home+'/picker-runtime-'));
   calls.push(args.includes('--verify')?'verify':'sign');return {stdout:''};
  };
  const result=await isolatePickerRuntime(executable,home,native);
  assert.match(result.bundleId,/^com\.tryapparent\.storagefixture\.f[a-f0-9]{32}$/);
  assert.notEqual(result.bundleId,result.sourceBundleId);
  assert.equal(result.sourceExecutable,executable);assert.equal(result.signatureVerified,true);
  assert.equal(await files.readFile(result.executable,'utf8'),'synthetic runtime bytes');
  assert.deepEqual(JSON.parse(await files.readFile(plist,'utf8')),original);
  assert.deepEqual(calls,['verify-source','CFBundleIdentifier','CFBundleName','CFBundleDisplayName','sign','verify']);
  await files.chmod(home,0o755);
  await assert.rejects(isolatePickerRuntime(executable,home,async()=>{throw Error('Must refuse before native calls');}),/owned private/);
 } finally {await files.rm(directory,{recursive:true,force:true});}
});
test('a native signature failure refuses the isolated runtime instead of launching an unverified copy', async () => {
 const directory=await files.mkdtemp(join(tmpdir(),'picker-signature-'));
 try {
  const source=join(directory,'Electron.app'),home=join(directory,'home');
  await files.mkdir(join(source,'Contents/MacOS'),{recursive:true});await files.mkdir(home,{mode:0o700});
  const executable=join(source,'Contents/MacOS/Electron');
  await files.writeFile(executable,'unchanged source');await files.writeFile(join(source,'Contents/Info.plist'),'source metadata');
  const failure=Error('synthetic signature refusal');
  await assert.rejects(isolatePickerRuntime(executable,home,async(file,args)=>{
   if(file==='/usr/bin/codesign'&&args.includes('--sign'))throw failure;
   return {stdout:args[1].startsWith('Print')?'com.github.Electron\n':''};
  }),error=>error===failure);
  assert.equal(await files.readFile(executable,'utf8'),'unchanged source');
 } finally {await files.rm(directory,{recursive:true,force:true});}
});
test('unsigned source helpers are refused before copying or changing any runtime identity', async () => {
 const directory=await files.mkdtemp(join(tmpdir(),'picker-unsigned-'));
 try {
  const source=join(directory,'Electron.app'),home=join(directory,'home');
  await files.mkdir(join(source,'Contents/MacOS'),{recursive:true});await files.mkdir(home,{mode:0o700});
  const executable=join(source,'Contents/MacOS/Electron');
  await files.writeFile(executable,'unsigned source');
  const failure=Error('unsigned nested helper');
  const calls:string[]=[];
  await assert.rejects(isolatePickerRuntime(executable,home,async(file,args)=>{
   calls.push(file);assert.equal(file,'/usr/bin/codesign');
   assert.deepEqual(args,['--verify','--deep','--strict',source]);throw failure;
  }),error=>error===failure);
  assert.deepEqual(calls,['/usr/bin/codesign']);
  assert.deepEqual(await files.readdir(home),[],'No private runtime is prepared after source verification fails');
  assert.equal(await files.readFile(executable,'utf8'),'unsigned source');
 } finally {await files.rm(directory,{recursive:true,force:true});}
});
test('runtime isolation preserves strict window identity and adds native bundle and AX PID checks', () => {
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 assert.match(source,/executablePath: electronExecutable/);
 assert.match(source,/Contents\/Resources\/settings\/runtime\/Electron\.app\/Contents\/MacOS\/Electron/);
 assert.doesNotMatch(source,/realpath\(require\('electron'\)\)/,'The raw npm runtime may contain unsigned helpers');
 assert.match(source,/report\.fixtureRuntime = fixtureRuntime/);
 assert.match(source,/fixtureRuntime\.bundleId/);
 assert.match(source,/title=Apparent — UI foundation/);
 assert.match(source,/getTitle\(\) !== 'Apparent — UI foundation'/);
 assert.match(panelScript,/Owned Electron bundle identity differs/);
 assert.match(panelScript,/Owned AX process identifier differs/);
 assert.match(panelScript,/set observedPID to \(unix id of owned\) as integer/);
 assert.match(panelScript,/if observedPID is not targetPID then error "Owned AX process identifier differs; expectedPID="/);
 assert.doesNotMatch(panelScript,/Apparent Settings — About/,'The unrelated Settings window is never an admitted picker parent');
});
test('picker calls allow bounded AppKit startup but never exceed the original overall deadline', async () => {
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 const slice=(start:string,end:string)=>{
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.ok(from>=0&&to>from);return source.slice(from,to);
 };
 const create=new Function('run','Date','assert','env','deadline','electronChild','panelScript','home','electronExecutable','pickerCommandMs','fixtureRuntime',
  slice('  const budget =','  let home,')+slice('  const osa =','  const panel =')+
  slice('  const panel =','  const snapshot =')+slice('    const goPathOperation =','    const prepared =')+
  'return {osa,panel,goPathOperation};');
 let now=0;
 const calls:Array<{timeout:number;operation:string}>=[];
 const driver=create(async(_file:string,args:string[],options:{timeout:number})=>{
  calls.push({timeout:options.timeout,operation:args[4]});return {stdout:'owned picker\n'};
 },{now:()=>now},assert,{},95000,{exitCode:null,signalCode:null,pid:4801},'native script','/synthetic/home','/synthetic/electron',5000,{bundleId:'com.tryapparent.synthetic'});
 await driver.panel('cancel');
 await driver.goPathOperation('enter-go-path','/synthetic/path');
 assert.deepEqual(calls.map(call=>call.timeout),[5000,5000]);
 await driver.osa('other native control');
 assert.equal(calls.at(-1)!.timeout,3500,'Unrelated native controls keep their original cap');
 now=94500;await driver.panel('choose');await driver.goPathOperation('navigate-go','/synthetic/path');
 assert.deepEqual(calls.slice(-2).map(call=>call.timeout),[500,500]);
 now=95000;const before=calls.length;
 await assert.rejects(driver.panel('cancel'),/overall deadline exceeded/);
 await assert.rejects(driver.goPathOperation('navigate-go','/synthetic/path'),/overall deadline exceeded/);
 assert.equal(calls.length,before,'No native operation is sent after deadline expiry');
});
test('path entry and readback have separate bounded calls before one navigation', async () => {
 const order:string[]=[];
 let entered=false,observed=false,settled=false;
 const {driver}=fixture();
 Object.assign(driver,{
  enterPath:async(path:string)=>{assert.equal(path,'/synthetic/selected captures');order.push('enter');entered=true;},
  pathReady:async(path:string)=>{assert.ok(entered);assert.equal(path,'/synthetic/selected captures');order.push('readback');observed=true;return 'owned path readback';},
  wait:async(ms:number)=>{assert.ok(observed);assert.equal(ms,1000);order.push('autocomplete');settled=true;},
  navigate:async()=>{assert.ok(settled,'Return must not share the path-entry subprocess');order.push('navigate');},
 });
 const receipt={};
 await prepareStorageChange(driver,'/synthetic/selected captures',receipt);
 assert.deepEqual(order,['enter','readback','autocomplete','navigate']);
 assert.equal((receipt as Record<string,unknown>).pathEntered,true);
 assert.equal((receipt as Record<string,unknown>).pathReadback,'owned path readback');
});
test('each real Change waits for one native focus admission; failed or concurrent admission never clicks', async () => {
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 const start=source.indexOf('    const startNativeChange ='),end=source.indexOf('    const settleNativeChange =',start);
 assert.ok(start>0&&end>start);
 const create=new Function('assert','panel','change','budget','report',
  'let pendingNativeChange; let nativeChangeStarting=false;'+source.slice(start,end)+'return startNativeChange;');
 const focus=deferred<string>();let focuses=0,clicks=0;
 const report:{nativeChangeFocus?:string[]}={};
 const begin=create(assert,async(operation:string)=>{assert.equal(operation,'focus-change');focuses++;return focus.promise;},
  {click:async()=>{clicks++;}},(cap:number)=>cap,report);
 const pending=begin();await Promise.resolve();
 assert.equal(clicks,0,'CDP must not open a sheet while another app remains native-frontmost');
 await assert.rejects(async()=>begin(),/focus is already pending/);
 assert.equal(focuses,1);focus.resolve('owned native focus');await pending;
 assert.equal(clicks,1);assert.deepEqual(report.nativeChangeFocus,['owned native focus']);
 await assert.rejects(async()=>begin(),/already pending/);assert.equal(clicks,1);
 const failure=Error('owned focus refused');let refusedClicks=0;
 const refuse=create(assert,async()=>{throw failure;},{click:async()=>{refusedClicks++;}},(cap:number)=>cap,{});
 await assert.rejects(async()=>refuse(),error=>error===failure);assert.equal(refusedClicks,0);
});
test('unknown path entry or failed readback never replays entry or sends Return', async () => {
 for (const phase of ['entry','readback','autocomplete']) {
  let entries=0,reads=0,navigations=0;
  const failure=Object.assign(Error(`${phase} native deadline`),{signal:'SIGKILL'});
  const {driver}=fixture({
   enterPath:async()=>{entries++;if(phase==='entry')throw failure;},
   pathReady:async()=>{reads++;if(phase==='readback')throw failure;return 'owned path readback';},
   wait:async()=>{if(phase==='autocomplete')throw failure;},
   navigate:async()=>{navigations++;},
  });
  const receipt:Record<string,unknown>={};
  await assert.rejects(prepareStorageChange(driver,'/synthetic/path',receipt),error=>error===failure);
  assert.equal(entries,1);assert.equal(navigations,0);
  assert.equal(reads,phase==='entry'?0:1);
  assert.equal(receipt.pathEntered,phase==='entry'?undefined:true);
  assert.equal(receipt.pathReadback,phase==='autocomplete'?'owned path readback':undefined);
 }
});
test('native path entry, read-only readback and Return remain distinct owned operations', () => {
 const source=readFileSync('enablement/prerequisites/mac-picker.ts','utf8');
 const start=source.indexOf('        if operation is "enter-go-path" then');
 const read=source.indexOf('        else if operation is "inspect-go-path" then',start);
 const navigate=source.indexOf('        else if operation is "navigate-go" then',read);
 const end=source.indexOf('      else if operation is "open-go"',navigate);
 assert.ok(start>0&&read>start&&navigate>read&&end>navigate);
 assert.match(source.slice(start,read),/set value of pathField to \(item 2 of argv\)/);
 assert.doesNotMatch(source.slice(start,read),/key code|delay|value of pathField as text/);
 assert.match(source.slice(read,navigate),/Go to Folder path readback differs/);
 assert.doesNotMatch(source.slice(read,navigate),/set value|key code|delay/);
 const mutation=source.slice(navigate,end);
 assert.doesNotMatch(mutation,/set value|delay/);
 assert.match(mutation,/requireNativeFocus/);
 assert.match(mutation,/Go to Folder sheet disappeared before navigation/);
 assert.match(mutation,/Go to Folder path changed before navigation/);
 assert.equal(mutation.match(/key code 36/g)?.length,1);
});
test('query timing preserves the exact selector and stable source-line identities', () => {
 const source=readFileSync('enablement/prerequisites/mac-picker.ts','utf8');
 const original=source.slice(source.indexOf('const pickerScript = `')+'const pickerScript = `'.length,source.indexOf('\n`;')+1);
 const handler='\n-- Explicit script target: never ask System Events to supply the clock.\non axProbeElapsed(startedAt)\n  return (current date) - startedAt\nend axProbeElapsed\n';
 assert.ok(panelScript.endsWith(handler));
 const lines=panelScript.slice(0,-handler.length).split('\n');
 assert.equal(lines.filter(line=>line.trim()==='set axProbeStartedAt to current date').length,1);
 const stripped=lines.filter(line=>line.trim()!=='set axProbeStartedAt to current date'&&!line.trim().startsWith('log ("AX probe source-line=')).join('\n');
 assert.equal(stripped,original);
 let queries=0;
 for(let index=0;index<lines.length;index++) {
  const match=lines[index].match(/log \("AX probe source-line=(\d+) elapsedSeconds=" & \(my axProbeElapsed\(axProbeStartedAt\)\)\)/);
  if(!match)continue;
  queries++;
  assert.equal(lines[index+1],original.split('\n')[Number(match[1])-1]);
 }
 assert.ok(queries>20,'All existing query boundaries remain instrumented');
 const boundsLine=original.split('\n').findIndex(line=>line.trim()==='set xy to position of outerWindow')+1;
 assert.ok(boundsLine>0);
 assert.ok(panelScript.includes(`source-line=${boundsLine} elapsedSeconds=`));
 assert.doesNotMatch(panelScript.slice(panelScript.indexOf('on ownedApplication'),panelScript.indexOf('-- Explicit script target:')),/axProbeStartedAt/,
  'Native helper handlers cannot reference the run handler\'s local diagnostic clock');
});
test('the actual AppKit picker adapter compiles without running UI actions',{skip:process.platform!=='darwin'},()=>{
 const directory=mkdtempSync(join(tmpdir(),'apparent-dev-picker-syntax-'));
 try {execFileSync('/usr/bin/osacompile',['-o',join(directory,'picker.scpt'),'-e',panelScript],{stdio:'pipe'});}
 finally {rmSync(directory,{recursive:true,force:true});}
});
test('the actual Storage/Retention receipt precedes Change, and Go sheet readiness precedes path entry',async()=>{
 const storage=deferred<void>(),go=deferred<string>(),opened=deferred<void>();
 const {calls,driver}=fixture({storageIdle:()=>storage.promise,goSheet:()=>go.promise});
 driver.openGo=async()=>{calls.openGo++;opened.resolve();};
 const pending=prepareStorageChange(driver,'/synthetic/selected captures');
 await Promise.resolve();assert.equal(calls.change,0);assert.equal(calls.openGo,0);
 storage.resolve();await opened.promise;
 assert.equal(calls.change,1);assert.equal(calls.openGo,1);assert.equal(calls.navigate,0);
 go.resolve('owned-go-sheet');
 assert.deepEqual(await pending,{beforeGo:'owned-picker',goSheet:'owned-go-sheet',beforeChoose:'owned-picker'});
 assert.deepEqual(calls,{change:1,openGo:1,navigate:1,picker:2});
});
test('Storage readiness failure never issues a Change mutation',async()=>{
 const {calls,driver}=fixture({storageIdle:async()=>{throw Error('retention receipt not ready');}});
 await assert.rejects(prepareStorageChange(driver,'/synthetic/path'),/retention receipt/);
 assert.deepEqual(calls,{change:0,openGo:0,navigate:0,picker:0});
});
test('missing or ambiguous owned Go sheet fails without retrying the shortcut or entering data',async()=>{
 const receipt={};
 const {calls,driver}=fixture({goSheet:async()=>{throw Error('Owned Go to Folder sheet missing or ambiguous');}});
 await assert.rejects(prepareStorageChange(driver,'/synthetic/path',receipt),/missing or ambiguous/);
 assert.deepEqual(calls,{change:1,openGo:1,navigate:0,picker:1});
 assert.deepEqual(receipt,{beforeGo:'owned-picker',openGoReturned:true},'Completed native observations survive a later readiness failure');
});
test('an unknown navigation outcome is never replayed',async()=>{
 const {calls,driver}=fixture();
 driver.navigate=async()=>{calls.navigate++;throw Error('navigation outcome unknown');};
 await assert.rejects(prepareStorageChange(driver,'/synthetic/path'),/outcome unknown/);
 assert.deepEqual(calls,{change:1,openGo:1,navigate:1,picker:1});
});
test('path characters remain opaque data for the owned native adapter',async()=>{
 const path='/synthetic/selected captures/"café"';let received='';
 const {driver}=fixture({navigate:async value=>{received=value;}});
 await prepareStorageChange(driver,path);assert.equal(received,path);
});
test('the existing CommonJS driver can load the TypeScript helper using the installed Node runtime',()=>{
 const source="const h=require('./enablement/prerequisites/mac-picker.ts'); if(typeof h.prepareStorageChange!=='function'||typeof h.panelScript!=='string')process.exit(1);";
 execFileSync(process.execPath,['-e',source],{stdio:'pipe'});
});
test('the retained native receipt preserves direct and wrapped subprocess failure details',()=>{
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 const marker='    failure = error;\n';
 const markerAt=source.indexOf(marker);assert.ok(markerAt>=0);
 const start=markerAt+marker.length,end=source.indexOf('    if (page && Date.now() < deadline)',start);
 assert.ok(end>start);
 // Execute the actual receipt assignment without importing the native test or
 // starting its Mac-only processes. This is diagnostic coverage, not native proof.
 const receipt=new Function('error','report',source.slice(start,end)+'\nreturn report.error;');
 for(const metadata of [
  {code:null,signal:'SIGKILL',killed:true,stderr:'synthetic AX diagnostic'},
  {code:1,signal:null,killed:false,stderr:'synthetic permission refusal'},
 ]) {
  const failure=Object.assign(new Error('synthetic subprocess failure'),metadata);
  for(const error of [failure,new Error('readiness failed',{cause:failure})]) {
   const recorded=JSON.parse(JSON.stringify(receipt(error,{})));
   assert.equal(recorded.message,error.message);
   assert.deepEqual(recorded.subprocess,metadata);
  }
 }
});
test('native integration retains its consent, deadlines, persistence assertions and one-shot mutation adapter',()=>{
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 assert.match(source,/prepareStorageChange\(\{/);
 assert.match(source,/APPARENT_STORAGE_NATIVE_CI/);
 assert.match(source,/timeout: 120000/);assert.match(source,/Date\.now\(\) \+ 95000/);
 for(const contract of ['Saved location readback','Cancel changed config bytes','Cancel replaced config','Cancel rewrote config','Reset location readback'])assert.ok(source.includes(contract));
});
test('initial AX startup has a bounded allowance while controls and permission failures retain their limits',async()=>{
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 const slice=(start:string,end:string)=>{
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.ok(from>=0&&to>from,`Missing native fixture boundary: ${start}`);
  return source.slice(from,to);
 };
 // Execute the shipped fixture's helpers and initial assertion with an inert
 // subprocess boundary. This verifies budgets and refusal, not native macOS.
 const create=new Function('run','Date','assert','env','deadline',
  slice('  const budget =','  let home,')+slice('  const osa =','  const panel =')+
  'return {osa,preflight:async()=>{'+slice('    assert.equal(await osa(', '    report.accessibilityPreflight =')+'}};');
 let now=0,answer='true',failure:Error|undefined;
 const calls:Array<{file:string;args:string[];options:{timeout:number;killSignal:string;maxBuffer:number}}>=[];
 const driver=create(async(file:string,args:string[],options:typeof calls[number]['options'])=>{
  calls.push({file,args,options});if(failure)throw failure;return {stdout:answer+'\n'};
 },{now:()=>now},assert,{},95000);
 await driver.osa('synthetic control');assert.equal(calls.at(-1)!.options.timeout,3500);
 await driver.preflight();assert.equal(calls.at(-1)!.options.timeout,15000);
 assert.deepEqual(calls.at(-1)!.args,['-e','tell application "System Events" to get UI elements enabled']);
 now=94500;await driver.preflight();assert.equal(calls.at(-1)!.options.timeout,500);
 now=95000;const before=calls.length;
 await assert.rejects(driver.preflight(),/overall deadline exceeded/);assert.equal(calls.length,before);
 now=0;answer='false';await assert.rejects(driver.preflight(),/preflight unavailable/);
 failure=Error('synthetic unavailable System Events');
 await assert.rejects(driver.preflight(),/synthetic unavailable System Events/);
 for(const call of calls){assert.equal(call.file,'/usr/bin/osascript');assert.equal(call.options.killSignal,'SIGKILL');assert.equal(call.options.maxBuffer,32768);}
});

test('post-Choose app_busy uses one visible read after authoritative save, never a mutation replay',async()=>{
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 const start=source.indexOf('async function refreshBusyLocation('),end=source.indexOf('async function within(',start);
 assert.ok(start>=0&&end>start);
 const recover=new Function(source.slice(start,end)+';return refreshBusyLocation;')();
 for(const busy of [false,true]){
  const calls:string[]=[];
  assert.equal(await recover({idle:async()=>{calls.push('idle');},busy:async()=>{calls.push('observe');return busy;},refresh:async()=>{calls.push('visible-read');}}),busy);
  assert.deepEqual(calls,busy?['idle','observe','visible-read']:['idle','observe']);
 }
 let reads=0;
 await assert.rejects(recover({idle:async()=>{throw Error('still pending');},busy:async()=>true,refresh:async()=>{reads++;}}),/still pending/);
 await assert.rejects(recover({idle:async()=>{},busy:async()=>true,refresh:async()=>{reads++;throw Error('read failed');}}),/read failed/);
 assert.equal(reads,1,'failed reads are not retried');
 const save=source.indexOf("assert.equal(next.location.storage.savedPath, selected)");
 const recovery=source.indexOf('report.postChooseVisibleRefresh =');
 const visible=source.indexOf('await locationStatus.getByText(changed.location.storage.displayPath',recovery);
 assert.ok(save<recovery&&recovery<visible);
 const block=source.slice(recovery,visible);
 assert.doesNotMatch(block,/startNativeChange|panel\(|snapshot\(|change\.click|reset\.click/);
 assert.match(block,/refreshLocation\.click\(\{ timeout: budget\(\) \}\)/);
});

test('initial runtime recovery is one explicit read within the original shared startup deadline',async()=>{
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 const start=source.indexOf('async function initialRuntimeRead('),end=source.indexOf('async function within(',start);
 assert.ok(start>=0&&end>start);
 const admit=new Function('assert',source.slice(start,end)+';return initialRuntimeRead;')(assert);
 for(const initial of ['connected','app_unresponsive','app_busy','request_timeout','invalid_response']) {
  let now=0;const calls:Array<[string,number]>=[];
  const ports={now:()=>now,budget:(cap:number)=>Math.min(cap,95000-now),
   observe:async(remaining:()=>number)=>{assert.equal(remaining(),10000);now=3000;return initial;},
   pause:async(ms:number)=>{calls.push(['pause',ms]);now+=ms;},
   refresh:async(ms:number)=>{calls.push(['refresh',ms]);now+=100;},
   connected:async(ms:number)=>{calls.push(['connected',ms]);if(!['connected','app_unresponsive'].includes(initial))throw Error(initial);},
  };
  if(['connected','app_unresponsive'].includes(initial))assert.equal((await admit(ports)).refreshed,initial==='app_unresponsive');
  else await assert.rejects(admit(ports),new RegExp(initial));
  assert.deepEqual(calls,initial==='app_unresponsive'?[['pause',1000],['refresh',6000],['connected',5900]]:[['connected',7000]]);
 }
 let now=0,refreshes=0;
 const ports={now:()=>now,budget:(cap:number)=>Math.min(cap,95000-now),observe:async()=>{now=9500;return 'app_unresponsive';},
  pause:async()=>{throw Error('must not pause');},refresh:async()=>{refreshes++;},connected:async()=>{throw Error('must not accept');}};
 await assert.rejects(admit(ports),/Insufficient initial runtime recovery budget/);assert.equal(refreshes,0);
 now=0;
 await assert.rejects(admit({...ports,observe:async()=>{now=3000;return 'app_unresponsive';},pause:async()=>{now=10000;}}),/deadline exceeded/);
 assert.equal(refreshes,0,'An expired shared deadline never dispatches another read');
 now=0;const failure=Error('permission refusal');
 await assert.rejects(admit({...ports,observe:async()=>{throw failure;}}),error=>error===failure);
 assert.equal(refreshes,0);
 now=94500;
 await admit({...ports,observe:async(remaining:()=>number)=>{assert.equal(remaining(),500);return 'connected';},
  connected:async(timeout:number)=>{assert.equal(timeout,500);}});
 now=0;
 await assert.rejects(admit({...ports,observe:async()=>{now=3000;return 'app_unresponsive';},pause:async()=>{now+=1000;},
  refresh:async()=>{refreshes++;throw failure;}}),error=>error===failure);
 assert.equal(refreshes,1,'A failed visible read is not retried');
 const host=readFileSync('capture/desktop/ui/frontend/electron/main.cjs','utf8');
 assert.match(host,/Date\.now\(\) - lastRead < 1000/,'Fixture cooldown must match the shipped state-read cache');
});

test('bootstrap failure evidence distinguishes native windows from renderer readiness without page content',()=>{
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 const start=source.indexOf('function bootstrapFailure('),end=source.indexOf('async function within(',start);
 assert.ok(start>=0&&end>start);
 const observe=new Function(source.slice(start,end)+'\nreturn bootstrapFailure;')();
 const window=(id:number,destroyed=false)=>({id,isVisible:()=>true,webContents:{
  isDestroyed:()=>destroyed,isLoadingMainFrame:()=>{assert.equal(destroyed,false);return true;},
  isCrashed:()=>{assert.equal(destroyed,false);return false;},
  getOSProcessId:()=>{assert.equal(destroyed,false);return 123;},
  getURL:()=>{throw Error('must not inspect page content');},
 }});
 const result=observe({app:{isReady:()=>true},BrowserWindow:{getAllWindows:()=>[window(1),window(2,true),window(3)]}});
 assert.equal(result.ready,true);assert.equal(result.windowCount,3);assert.equal(result.windows.length,2);
 assert.deepEqual(result.windows[0],{id:1,visible:true,contentsDestroyed:false,loadingMainFrame:true,crashed:false,rendererPid:123});
 assert.deepEqual(result.windows[1],{id:2,visible:true,contentsDestroyed:true});
});

test('a native window after firstWindow timeout never converts the original failure into acceptance',async()=>{
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 const start=source.indexOf('    try {\n      page = await firstWindow;');
 const end=source.indexOf('    await bootstrap;\n    report.electron =',start);
 assert.ok(start>=0&&end>start);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const actual=new AsyncFunction('firstWindow','application','report','bootstrap','within','budget','bootstrapFailure',
  'let page;\n'+source.slice(start,end)+'\nreturn page;');
 for(const diagnosticFails of [false,true]) {
  const failure=new Error('original firstWindow timeout');
  const report:any={electronBootstrap:{}};
  const application={windows:()=>[],evaluate:async()=>{
   if(diagnosticFails)throw Error('diagnostic unavailable');
   return {ready:true,windows:[{id:1,visible:true}]};
  }};
  await assert.rejects(actual(Promise.reject(failure),application,report,Promise.resolve(),
   (promise:Promise<unknown>)=>promise,()=>1500,()=>{}),error=>error===failure);
  assert.equal(report.electronBootstrap.attachedWindowsAtFailure,0);
  if(diagnosticFails)assert.equal(report.electronBootstrap.failureObservationError,'diagnostic unavailable');
  else assert.equal(report.electronBootstrap.failure.windows[0].visible,true);
 }
});

test('bootstrap telemetry observes existing and future renderers with bounded content-free failures',()=>{
 const source=readFileSync('capture/desktop/ui/frontend/tests/mac-storage-native.cjs','utf8');
 const start=source.indexOf('function bootstrapObservation('),end=source.indexOf('function bootstrapFailure(',start);
 const observe=new Function(source.slice(start,end)+'\nreturn bootstrapObservation;')();
 const emitter=()=>{
  const handlers=new Map<string,Function>();
  return {on:(kind:string,callback:Function)=>handlers.set(kind,callback),
   once:(kind:string,callback:Function)=>handlers.set(kind,callback),
   emit:(kind:string,...args:unknown[])=>handlers.get(kind)?.(...args)};
 };
 const app={...emitter(),isReady:()=>true};
 const first={id:1,webContents:emitter()},second={id:2,webContents:emitter()};
 const result=observe({app,BrowserWindow:{getAllWindows:()=>[first]}});
 assert.deepEqual(result.windows,[1]);
 app.emit('browser-window-created',{},second);
 first.webContents.emit('did-fail-load',{},-7,'sensitive description','file:///private/sensitive',true);
 second.webContents.emit('dom-ready');
 app.emit('child-process-gone',{}, {type:'GPU',reason:'crashed',exitCode:9,serviceName:'private-service'});
 const events=(globalThis as any).__apparentStorageWindowProbe;
 assert.ok(events.some((entry:any)=>entry.kind==='did-fail-load'&&entry.code===-7&&entry.mainFrame===true));
 assert.ok(events.some((entry:any)=>entry.kind==='dom-ready'&&entry.id===2));
 assert.ok(events.some((entry:any)=>entry.kind==='child-process-gone'&&entry.type==='GPU'));
 assert.doesNotMatch(JSON.stringify(events),/sensitive|private-service/);
 for(let i=0;i<30;i++)second.webContents.emit('did-start-loading');
 assert.equal(events.length,16);
 delete (globalThis as any).__apparentStorageWindowProbe;
});
