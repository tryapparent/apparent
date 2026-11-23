// Disposable native-test runtime identity, never an installed product mutation.
import {cp, lstat, mkdtemp, readFile, realpath, rename, stat} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import assert from 'node:assert/strict';

type NativeCommand = (file:string,args:string[])=>Promise<{stdout:string}>;
export async function isolatePickerRuntime(sourceExecutable:string, home:string, run:NativeCommand) {
 const root=await lstat(home);
 if(!root.isDirectory()||root.isSymbolicLink()||root.uid!==process.getuid!()||(root.mode&0o077)!==0)
  throw Error('Picker runtime requires an owned private fixture directory');
 const source=await realpath(sourceExecutable),sourceBundle=resolve(source,'../../..');
 if(!sourceBundle.endsWith('.app')||relative(sourceBundle,source)!=='Contents/MacOS/Electron')
  throw Error('Picker runtime source must be an Electron application bundle');
 // Use the installed runtime's inside-out signatures. Raw npm Electron may
 // contain unsigned helper apps, which cannot support parent-only re-signing.
 await run('/usr/bin/codesign',['--verify','--deep','--strict',sourceBundle]);
 const hash=async(file:string)=>createHash('sha256').update(await readFile(file)).digest('hex');
 const sourceSha256=await hash(source);
 const readIdentity=async(plist:string)=>(await run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',plist])).stdout.trim();
 const sourceBundleId=await readIdentity(join(sourceBundle,'Contents/Info.plist'));
 const directory=await mkdtemp(join(home,'picker-runtime-'));
 const bundle=join(directory,'StorageFixture.app');
 await cp(sourceBundle,bundle,{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true});
 const copiedExecutable=join(bundle,'Contents/MacOS/Electron'),plist=join(bundle,'Contents/Info.plist');
 for(const file of [copiedExecutable,plist]) {
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink())throw Error('Picker runtime identity files must be regular copies');
 }
 const nonce=randomUUID().replaceAll('-','');
 const bundleId=`com.tryapparent.storagefixture.f${nonce}`,name=`ApparentStorageFixture-${nonce}`;
 // Both launched apps otherwise retain the executable name Electron. Isolate
 // the copy's process name too, to avoid name-based AX reference collisions;
 // never relax the subsequent exact-PID check.
 const executableName=`StorageFixture-${nonce}`,executable=join(bundle,'Contents/MacOS',executableName);
 await rename(copiedExecutable,executable);
 for(const [key,value] of [['CFBundleIdentifier',bundleId],['CFBundleName',name],['CFBundleDisplayName',name],['CFBundleExecutable',executableName]])
  await run('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${value}`,plist]);
 // Only the copied parent identity changed. Nested binaries keep their verified
 // signatures; preserve the parent's entitlements and flags when signing it.
 await run('/usr/bin/codesign',['--force','--sign','-','--preserve-metadata=entitlements,flags',bundle]);
 await run('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
 if(await readIdentity(plist)!==bundleId||bundleId===sourceBundleId)throw Error('Picker runtime identity was not isolated');
 if(await hash(source)!==sourceSha256)throw Error('Source Electron executable changed during fixture preparation');
 return {executable,bundleId,sourceExecutable:source,sourceBundleId,sourceSha256,
  executableSha256:await hash(executable),signatureVerified:true};
}

export function storageFixtureAssertions(config: string, sentinel: string, sentinelText: string, selected: string, unknown: unknown) {
  return async (savedPath: string | null) => {
    const raw = JSON.parse(await readFile(config, 'utf8'));
    if (savedPath === null) assert.equal(Object.hasOwn(raw, 'capturesDir'), false);
    else assert.equal(raw.capturesDir, savedPath);
    assert.deepEqual(raw.storageNativeFixture, unknown);
    assert.equal(raw.experiments.electronCaptureLocation, false);
    assert.equal(await readFile(sentinel, 'utf8'), sentinelText);
    await assert.rejects(stat(join(selected, 'existing-file.txt')), {code: 'ENOENT'});
    return {capturesDir: savedPath, keyAbsent: !Object.hasOwn(raw, 'capturesDir'),
      unknownFieldsPreserved: true, experimentPreserved: true, existingFileUnchanged: true, existingFileNotMoved: true};
  };
}

export async function storageFixtureHashes(root: string) {
  const files = ['electron/main.cjs', 'electron/preload.cjs', 'electron/storage-preload.cjs',
    'electron/runtime.cjs', 'src/storage.tsx', 'dist/index.html', 'dist/settings.html'];
  return Object.fromEntries(await Promise.all(files.map(async file => [
    file, createHash('sha256').update(await readFile(join(root, file))).digest('hex'),
  ])));
}
