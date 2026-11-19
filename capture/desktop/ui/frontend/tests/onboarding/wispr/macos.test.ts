import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,copyFile,chmod} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {macWispr,WisprOnboarding,savedWisprExperiment} from '../../../electron/onboarding/wispr.ts';

// Opt in only on an isolated Mac. Never terminate an existing Wispr process.
test('AppKit detects and normally quits only the synthetic dictation bundles, and respects refusal',{
  skip:process.platform!=='darwin'||process.env.APPARENT_WISPR_NATIVE_TEST!=='1',timeout:90000,
},async()=>{
  const controller=new AbortController();
  assert.deepEqual(await macWispr('read',controller.signal,[]),{status:'closed'},'an existing app forbids this fixture');
  const dir=await mkdtemp(path.join(os.tmpdir(),'wispr-native-'));
  let child:ChildProcess|undefined;
  try{
    const source=path.join(dir,'fixture.swift');
    await writeFile(source,`import AppKit
import Foundation
final class Delegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) { print("ready"); fflush(stdout) }
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    return CommandLine.arguments.contains("--refuse") ? .terminateCancel : .terminateNow
  }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let delegate = Delegate()
app.delegate = delegate
app.run()
`);
    const binary=path.join(dir,'fixture');
    execFileSync('/usr/bin/xcrun',['swiftc',source,'-o',binary],{timeout:60000});
    const makeBundle=async(id:string)=>{
      const app=path.join(dir,id+'.app'),executable=path.join(app,'Contents/MacOS/fixture');
      await mkdir(path.dirname(executable),{recursive:true});
      await copyFile(binary,executable);
      await chmod(executable,0o755);
      await writeFile(path.join(app,'Contents/Info.plist'),`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`);
      return executable;
    };
    const wispr=await makeBundle('com.electron.wispr-flow');
    const superwhisper=await makeBundle('com.superduper.superwhisper');
    const start=async(executable:string,refuse=false)=>{
      child=spawn(executable,refuse?['--refuse']:[],{stdio:['ignore','pipe','pipe']});
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Native fixture did not start')),10000);
        child!.once('error',reject);child!.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited before ready'));});
        child!.stdout!.once('data',()=>{clearTimeout(timer);resolve();});
      });
    };
    await start(wispr);
    assert.deepEqual(await macWispr('read',controller.signal,[]),{status:'running',apps:['wisprFlow']});
    const home=path.join(dir,'home');await mkdir(path.join(home,'.config/apparent'),{recursive:true});
    const config=path.join(home,'.config/apparent/config.json');await writeFile(config,'{}');
    const service=new WisprOnboarding(()=>({platform:'macos',step:'shortcut',wisprFlowEnabled:true}),()=>savedWisprExperiment(home),macWispr);
    assert.deepEqual(await service.request('quit'),{status:'disabled'});
    assert.equal(child!.exitCode,null,'default-off must leave the owned fixture running');
    await writeFile(config,'{"experiments":{"onboardingWisprFlow":true}}');
    assert.deepEqual(await service.request('read'),{status:'running',apps:['wisprFlow']});
    assert.deepEqual(await service.request('quit'),{status:'closed'});
    if(child!.exitCode===null)await new Promise(resolve=>child!.once('exit',resolve));
    assert.deepEqual(await macWispr('read',controller.signal,[]),{status:'closed'});
    await start(superwhisper);
    assert.deepEqual(await service.request('read'),{status:'running',apps:['superwhisper']});
    assert.deepEqual(await service.request('quit'),{status:'closed'});
    if(child!.exitCode===null)await new Promise(resolve=>child!.once('exit',resolve));
    await start(superwhisper,true);
    assert.deepEqual(await service.request('read'),{status:'running',apps:['superwhisper']});
    assert.deepEqual(await service.request('quit'),{status:'refused'});
    assert.equal(child!.exitCode,null,'normal quit must not force a refusing app to exit');
  }finally{
    // Cleanup is scoped to the fixture PID we spawned, never a bundle-wide kill.
    if(child&&child.exitCode===null){const exited=new Promise(resolve=>child!.once('exit',resolve));child.kill('SIGTERM');await exited;}
    controller.abort();await rm(dir,{recursive:true,force:true});
  }
});
