import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const owner=fileURLToPath(new URL('..',import.meta.url));
const builtModules=['foreground','handoff','index','shares','mcp-wire','mcp-files','mcp-bundle','mcp-endpoint','mcp-cli'];
const builtFiles=builtModules.flatMap(name=>[name+'.d.ts',name+'.js']).sort();
function run(command:string,args:string[],cwd:string,env=process.env):string {
  return execFileSync(command,args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
}
async function fixture(t:test.TestContext) {
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'connect-package-'));
  await fs.chmod(root,0o700);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source');await fs.mkdir(source);
  for(const name of ['src','scripts','package.json','tsconfig.json','README.md']) {
    await fs.cp(path.join(owner,name),path.join(source,name),{recursive:true});
  }
  await fs.symlink(path.join(owner,'node_modules'),path.join(source,'node_modules'));
  return {root,source};
}

test('build removes stale generated modules and refuses redirected output',async t=>{
  const {root,source}=await fixture(t),dist=path.join(source,'dist');
  await fs.mkdir(dist);await fs.writeFile(path.join(dist,'obsolete.js'),'obsolete');
  await fs.writeFile(path.join(dist,'obsolete.d.ts'),'obsolete');
  run('npm',['run','build'],source);
  assert.deepEqual((await fs.readdir(dist)).sort(),builtFiles);
  await fs.rm(dist,{recursive:true});
  const external=path.join(root,'external');await fs.mkdir(external);
  await fs.writeFile(path.join(external,'sentinel'),'preserve');
  await fs.symlink(external,dist);
  assert.throws(()=>run('npm',['run','build'],source));
  assert.equal(await fs.readFile(path.join(external,'sentinel'),'utf8'),'preserve');
});

test('packed consumer installs and runs without Rust, compilers or source resolution',async t=>{
  const {root,source}=await fixture(t);
  const result=JSON.parse(run('npm',['pack','--json','--pack-destination',root],source))[0];
  assert.deepEqual(result.files.map((file:{path:string})=>file.path).sort(),
    ['README.md',...builtFiles.map(name=>'dist/'+name),'package.json'].sort());
  const policy=path.join(source,'dist/handoff.js');
  const pointer=execFileSync(process.execPath,[policy],{input:JSON.stringify({job:{id:'a'.repeat(32),status:'pending'}})+'\n',encoding:'utf8'});
  assert.equal(JSON.parse(pointer),'apparent inspect '+'a'.repeat(32)+'\n');
  const bin=path.join(root,'deny');await fs.mkdir(bin);
  for(const name of ['cargo','rustc','electron','tsc','esbuild']) {
    await fs.writeFile(path.join(bin,name),'#!/bin/sh\necho forbidden-build-tool >&2\nexit 99\n',{mode:0o700});
  }
  const env={...process.env,PATH:bin+path.delimiter+process.env.PATH};
  const consumer=path.join(root,'consumer');await fs.mkdir(consumer);
  const producer=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
  const locked=JSON.parse(await fs.readFile(path.join(owner,'package-lock.json'),'utf8'));
  const archive=path.join(root,result.filename);
  const manifest={name:'packed-consumer',version:'0.0.0',private:true,type:'module',dependencies:{[producer.name]:`file:${archive}`}};
  await fs.writeFile(path.join(consumer,'package.json'),JSON.stringify(manifest));
  // npm ci seeds tarballs, not registry metadata. Reuse its exact runtime lock
  // so a fresh cache can install offline without resolving dependency ranges.
  const runtime=Object.fromEntries(Object.entries(locked.packages)
    .filter(([name,entry])=>name!==''&&!(entry as {dev?:boolean}).dev));
  await fs.writeFile(path.join(consumer,'package-lock.json'),JSON.stringify({
    name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages:{
      '':manifest,...runtime,[`node_modules/${producer.name}`]:{
        version:producer.version,resolved:`file:${archive}`,integrity:result.integrity,
        dependencies:producer.dependencies,engines:producer.engines,bin:producer.bin,
      },
    },
  }));
  // Scripts deliberately enabled: a hidden consumer build must fail.
  run('npm',['ci','--offline','--ignore-scripts=false','--no-audit','--no-fund'],consumer,env);
  run(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {generateAgeIdentity,encryptAge,decryptAge,signEnvelope,verifyEnvelope} from '@apparent/connect-crypto';
    const identity=await generateAgeIdentity(),original=new Uint8Array([0,1,255]);
    assert.deepEqual(await decryptAge(await encryptAge(original,[identity.recipient]),identity.identity),original);
    const seed=new Uint8Array(32).fill(7);
    const signed={version:1,context:{origin:'https://example.test',accountId:'a',captureId:'c',senderGrantId:'s'},chunks:[]};
    assert.equal((await signEnvelope(seed,signed)).length,128);
    assert.equal(await verifyEnvelope(new Uint8Array(32),signed,'00'.repeat(64)),false);
  `],consumer,env);
  const endpointCli=path.join(consumer,'node_modules/@apparent/connect-crypto/dist/mcp-cli.js');
  assert.match(run(process.execPath,[endpointCli,'--help'],consumer,env),/endpoint runs offline/);
  const endpointBin=path.join(consumer,'node_modules/.bin/apparent-connect-mcp');
  assert.match(run(process.execPath,[endpointBin,'--help'],consumer,env),/endpoint runs offline/);
  const endpointState=path.join(await fs.realpath(root),'endpoint');
  const setup=JSON.parse(run(process.execPath,[endpointBin,'init','--state',endpointState],consumer,env));
  assert.equal(setup.tool,'connect_relay_open');
  assert.deepEqual(Object.keys(setup.arguments.recipient).sort(),['crv','kty','x','y']);
  assert.ok(!JSON.stringify(setup).includes('AGE-SECRET-KEY'));
  assert.equal((await fs.stat(path.join(endpointState,'endpoint.json'))).mode&0o777,0o600);
  const installedPolicy=path.join(consumer,'node_modules/@apparent/connect-crypto/dist/handoff.js');
  for(const status of ['pending','ready','failed','expired']) {
    const output=execFileSync(process.execPath,[installedPolicy],{cwd:consumer,env,input:JSON.stringify({job:{id:'a'.repeat(32),status}})+'\n',encoding:'utf8'});
    assert.equal(JSON.parse(output),['pending','ready'].includes(status)?'apparent inspect '+'a'.repeat(32)+'\n':null);
  }
  const unavailable=execFileSync(process.execPath,[installedPolicy],{cwd:consumer,env,input:'{"operation":"fetchFailure","kind":"unavailable"}\n',encoding:'utf8'});
  assert.match(JSON.parse(unavailable), /Capture unavailable.*API origin.*fresh handoff/);
  const help=execFileSync(process.execPath,[installedPolicy],{cwd:consumer,env,input:'{"operation":"alternatives"}\n',encoding:'utf8'});
  assert.match(JSON.parse(help),/scp -r/);
  await fs.writeFile(path.join(consumer,'consumer.mts'),`
    import {generateAgeIdentity,encryptAge,type Asset} from '@apparent/connect-crypto';
    const asset:Asset={path:'summary.md',size:1,sha256:'synthetic'};
    await encryptAge(new Uint8Array(asset.size),[(await generateAgeIdentity()).recipient]);
  `);
  await fs.writeFile(path.join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{
    target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext',lib:['ES2023'],types:[],strict:true,noEmit:true}}));
  // The explicitly supplied development compiler checks declarations only.
  run(process.execPath,[path.join(owner,'node_modules/typescript/bin/tsc')],consumer,env);
  run(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {spawn} from 'node:child_process';
    import {createInterface} from 'node:readline';
    const origin='https://connect.example.test';
    const child=spawn(process.execPath,[process.argv[1],origin],{stdio:['pipe','pipe','pipe']});
    const lines=createInterface({input:child.stdout});
    let result;
    lines.on('line',line=>{
      const message=JSON.parse(line);
      if(message.operation==='page') child.stdin.write(JSON.stringify({ok:true,body:{shares:[{id:'a'.repeat(32),captureId:'c'.repeat(32),url:origin+'/s/'+'b'.repeat(64),status:'active',createdAt:'2026-11-10T00:00:00.000Z',expiresAt:'2026-11-17T00:00:00.000Z',title:'Synthetic'}],nextCursor:null}})+'\\n');
      else {result=message.result;child.stdin.end();}
    });
    const [code]=await new Promise(resolve=>child.once('exit',(code,signal)=>resolve([code,signal])));
    assert.equal(code,0);
    assert.equal(result.shares.length,1);
    assert.equal(result.nextCursor,null);
  `,path.join(consumer,'node_modules/@apparent/connect-crypto/dist/shares.js')],consumer,env);
});
