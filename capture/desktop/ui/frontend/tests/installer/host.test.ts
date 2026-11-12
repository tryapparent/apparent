import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs, {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const host = path.resolve(import.meta.dirname,'../../electron/installer/main.cts');
const code = ts.transpileModule(readFileSync(host,'utf8'), {fileName:host,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const directory = '/Fixture/Install Apparent.app/Contents/Resources/installer-ui/electron/installer';
const expected = '/Fixture/Install Apparent.app/Contents/MacOS/Installer';
function load(adapter:string, linked=false) {
  let started = 0;
  const context = {__dirname:directory,exports:{},process:{platform:'darwin',argv:['electron','host',`--installer-adapter=${adapter}`]},
    require:(name:string)=>{
      if(name==='electron')return{app:{setName:()=>{},whenReady:()=>{started++;return{then:()=>{}};},on:()=>{}}};
      if(name==='node:fs')return{realpathSync:(file:string)=>file,lstatSync:(file:string)=>{assert.equal(file,expected);return{isFile:()=>!linked,isSymbolicLink:()=>linked};}};
      if(name==='node:child_process')return{execFile:()=>{throw Error('No native execution permitted in host guard test');}};
      return require(name);
    }};
  return {run:()=>vm.runInNewContext(code,context),started:()=>started};
}
test('installer host rejects an arbitrary absolute adapter before startup',()=>{
  const fixture=load('/tmp/other-executable');
  assert.throws(fixture.run,/bundled Mac adapter/);assert.equal(fixture.started(),0);
});
test('installer host admits only its fixed regular bundled adapter',()=>{
  const fixture=load(expected);fixture.run();assert.equal(fixture.started(),1);
  const link=load(expected,true);assert.throws(link.run,/regular bundled executable/);assert.equal(link.started(),0);
});
test('installer actual host binds requests to its page and closes only after successful native Open', async()=>{
  let ready:()=>Promise<void>, invoke:(event:any,request:any)=>Promise<any>, close:(event:any)=>void;
  let quit=false,blocked=false;
  const frame={url:''};
  const contents={mainFrame:frame,setWindowOpenHandler:()=>{},on:()=>{}};
  const calls:any[]=[];
  class Window {
    webContents=contents;
    removeMenu(){}
    on(name:string,callback:any){if(name==='close')close=callback;}
    async loadURL(url:string){frame.url=url;}
  }
  const electron={app:{setName:()=>{},dock:{setIcon:(file:string)=>{if(file.endsWith('.icns'))throw Error('Failed to load image from path');}},whenReady:()=>({then:(callback:any)=>{ready=callback;}}),on:()=>{},
    quit:()=>{quit=true;close({preventDefault:()=>{blocked=true;}});}},BrowserWindow:Window,
    ipcMain:{handle:(_channel:string,handler:any)=>{invoke=handler;}},
    session:{defaultSession:{setPermissionRequestHandler:()=>{},setPermissionCheckHandler:()=>{}}}};
  const context={__dirname:directory,exports:{},process:{platform:'darwin',argv:['electron','host',`--installer-adapter=${expected}`]},
    require:(name:string)=>{
      if(name==='electron')return electron;
      if(name==='node:fs')return{realpathSync:(file:string)=>file,lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false})};
      if(name==='node:child_process')return{execFile:(binary:string,args:string[],_options:any,callback:any)=>{
        assert.equal(binary,expected);assert.equal(args[0],'--request');const request=JSON.parse(args[1]);calls.push(request);
        callback(null,JSON.stringify(request.action==='open'?{opened:true}:{needsReplacement:false}));
      }};
      return require(name);
    }};
  vm.runInNewContext(code,context);await ready!();
  const event={sender:contents,senderFrame:frame};
  await assert.rejects(invoke!({...event,senderFrame:{url:frame.url}},{action:'status'}),/Forbidden/);
  await assert.rejects(invoke!(event,{action:'install',source:'/tmp/other.app'}),/Invalid/);
  assert.equal(calls.length,0);
  const status=await invoke!(event,{action:'status'});assert.equal(status.needsReplacement,false);
  await invoke!(event,{action:'open'});
  assert.equal(quit,true);assert.equal(blocked,false,'successful Open must release the busy close guard');
  assert.deepEqual(calls,[{action:'status'},{action:'open'}]);
});

// Use the real filesystem to cover macOS parent-path aliases, not only mocked paths.
for (const route of ['bundled', 'parent-alias', 'foreign', 'missing', 'linked-bundle', 'linux']) {
  test(`installer startup validates the bundled adapter: ${route}`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apparent-installer-launch-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const contents = path.join(root, 'Install Apparent.app/Contents');
    const dirname = path.join(contents, 'Resources/installer-ui/electron/installer');
    fs.mkdirSync(dirname, {recursive: true});
    fs.mkdirSync(path.join(contents, 'MacOS'));
    const bundled = path.join(contents, 'MacOS/Installer');
    fs.writeFileSync(bundled, 'bundled executable fixture');
    fs.symlinkSync(contents, path.join(root, 'alias'));
    const foreign = path.join(root, 'foreign');
    fs.writeFileSync(foreign, 'foreign executable fixture');
    if (route === 'linked-bundle') {
      fs.unlinkSync(bundled);
      fs.symlinkSync(foreign, bundled);
    }
    const adapter = route === 'parent-alias' ? path.join(root, 'alias/MacOS/Installer')
      : route === 'foreign' ? foreign : bundled;
    let admitted = false;
    const execute = () => vm.runInNewContext(code, {
      exports: {}, __dirname: dirname,
      process: {platform: route === 'linux' ? 'linux' : 'darwin',
        argv: route === 'missing' ? ['electron', dirname] : ['electron', dirname, `--installer-adapter=${adapter}`]},
      require: (name: string) => name === 'electron' ? {
        app: {setName: () => {admitted = true;}, whenReady: () => new Promise(() => {}), on: () => {}},
      } : require(name),
    });
    if (route === 'bundled' || route === 'parent-alias') {
      execute();
      assert.ok(admitted, 'the bundled executable is accepted through an equivalent parent path');
    } else {
      assert.throws(execute);
      assert.equal(admitted, false, 'invalid startup never reaches Electron initialization');
    }
  });
}
