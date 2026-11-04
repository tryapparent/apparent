/** Real installed-package acceptance. No fixture executable or synthetic pins accepted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { stage, type StagePin } from '../stage.ts';
import { targets } from '../seal.ts';

const image = process.env.APPARENT_TEST_APPIMAGE;
const source = process.env.APPARENT_TEST_PACKAGE_SOURCE;
const imageDigest = process.env.APPARENT_TEST_APPIMAGE_SHA256;
const requested = Boolean(image || source || imageDigest);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const linuxTarget = (arch:string) => ({x64:'x86_64-unknown-linux-gnu',arm64:'aarch64-unknown-linux-gnu'}[arch]);
function completion(status:number|null, signal:NodeJS.Signals|null, limit:string|undefined,
  expected:'success'|'failure'|'cancel-at-approval', interrupted:boolean) {
  assert.equal(limit,undefined,'process hit an acceptance harness limit');
  if(expected==='cancel-at-approval') {
    assert.ok(interrupted,'must reach actual packaged approval before interrupt');
    assert.ok(signal==='SIGINT' || (signal===null && status!==null && status!==0),'expected cancellation exit');
  } else {
    assert.equal(signal,null,'unexpected signal is not rejection evidence');
    assert.notEqual(status,null,'missing exit status is not rejection evidence');
    assert.equal(status===0,expected==='success','unexpected command exit');
  }
}
test('package acceptance distinguishes process rejection from harness termination',()=>{
  assert.equal(linuxTarget('x64'),'x86_64-unknown-linux-gnu');
  assert.equal(linuxTarget('arm64'),'aarch64-unknown-linux-gnu');
  assert.equal(linuxTarget('other'),undefined);
  const rejected=spawnSync(process.execPath,['-e','process.exit(7)']);
  completion(rejected.status,rejected.signal,undefined,'failure',false);
  const timedOut=spawnSync(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:50});
  assert.throws(()=>completion(timedOut.status,timedOut.signal,'timeout','failure',false));
  const overflow=spawnSync(process.execPath,['-e',"process.stdout.write('x'.repeat(1000000))"],{maxBuffer:100});
  assert.ok(overflow.error);
  assert.throws(()=>completion(overflow.status,overflow.signal,'output-limit','failure',false));
  assert.throws(()=>completion(null,'SIGKILL',undefined,'failure',false));
});

test('source-bound AppImage invokes its genuine bundled recipient and preserves local inspection', {
  skip: requested ? false : 'requires frozen AppImage, reviewed package source and image checksum; not adapter proof',
  timeout: 180_000,
}, async () => {
  assert.equal(process.platform, 'linux', 'AppImage proof requires Linux');
  assert.ok(image && isAbsolute(image), 'APPARENT_TEST_APPIMAGE must be absolute');
  assert.match(source ?? '', /^[a-f0-9]{40}$/, 'APPARENT_TEST_PACKAGE_SOURCE must identify reviewed assembly source');
  assert.match(imageDigest ?? '', /^[a-f0-9]{64}$/, 'image checksum must come from the source-bound package receipt');
  assert.equal(hash(readFileSync(image)), imageDigest, 'frozen package bytes changed');
  const map = JSON.parse(execFileSync('git', ['show', `${source}:connect/delivery/recipient/pins.json`], {encoding:'utf8'}));
  assert.equal(map.schema, 1); assert.equal(map.adopted, true, 'package source must contain complete reviewed adoption');
  for (const target of targets) assert.equal(map.pins[target]?.target, target, 'all four real pins required');
  const target = linuxTarget(process.arch);
  assert.ok(target && targets.includes(target), 'unsupported host architecture');
  const pin: StagePin = map.pins[target];
  const work = mkdtempSync(join(tmpdir(), 'recipient-appimage-proof-'));
  chmodSync(work, 0o700);
  const config = join(work, 'config.json');
  const commands: {args:string[]; status:number|null; signal:NodeJS.Signals|null; limit?:string; stdout:string; stderr:string}[] = [];
  const children = new Set<ReturnType<typeof spawn>>();
  const run = (executable:string, args:string[], expected:'success'|'failure'|'cancel-at-approval'='success') => new Promise<string>((resolveRun, reject) => {
    const child = spawn(executable, args, {cwd:work, detached:true,
      env:{...process.env, APPARENT_CONFIG:config, APPIMAGE_EXTRACT_AND_RUN:'1'}, stdio:['ignore','pipe','pipe']});
    children.add(child);
    let stdout='', stderr='';
    let limit:string|undefined;
    let phase:'ordinary'|'awaiting-approval'|'interrupted'=expected==='cancel-at-approval'?'awaiting-approval':'ordinary';
    const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
    const timer = setTimeout(()=>{limit='timeout';kill();}, 30_000);
    child.stdout.on('data', chunk => {
      stdout+=chunk;if(stdout.length>2_000_000){limit='output-limit';kill();}
      if(phase==='awaiting-approval' && stdout.includes('CANCEL-CODE')) {
        phase='interrupted';try{process.kill(-child.pid!, 'SIGINT');}catch{}
      }
    });
    child.stderr.on('data', chunk => { stderr+=chunk; if(stderr.length>2_000_000){limit='output-limit';kill();} });
    child.once('error', error => {clearTimeout(timer);children.delete(child);reject(error);});
    child.once('close', (status,signal) => {
      clearTimeout(timer);children.delete(child);commands.push({args,status,signal,limit,stdout,stderr});
      try {
        completion(status,signal,limit,expected,phase==='interrupted');
        resolveRun(stdout);
      } catch(error){reject(error);}
    });
  });
  const id='0123456789abcdef0123456789abcdef';
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=','base64');
  const bundle={version:1,id,createdAtMs:0,durationMs:0,
    target:{mode:'display',displayId:0,frame:{x:0,y:0,width:1,height:1,scale:1}},
    transcript:{source:'synthetic',text:'Synthetic packaged recipient proof',segments:[]},
    strokes:[],marks:[],events:[],keyframes:[],contactSheet:'contact-sheet.png'};
  const files:Record<string,Buffer>={'apparent.json':Buffer.from(JSON.stringify(bundle)),
    'summary.md':Buffer.from('Synthetic packaged recipient proof\n'),'contact-sheet.png':png};
  let tamper=false, requests=0;
  let readerKey:import('./grouped-fixture.ts').EndpointKey;
  let grouped:Awaited<ReturnType<typeof import('./grouped-fixture.ts').groupedFixture>>|undefined;
  const downloads:string[]=[];
  let loginOutcome:'approve'|'await-cancellation'='approve';
  const server=createServer(async (request,response) => {
    try {
      let body='';for await(const chunk of request)body+=chunk;
      const route=new URL(request.url!,'http://fixture').pathname;
      response.setHeader('content-type','application/json');
      if(route==='/v1/device/start') {
        const start=JSON.parse(body);assert.equal(start.scope,'read');
        if(loginOutcome==='approve')readerKey=start.encryptionKey;
        response.end(JSON.stringify({deviceCode:'synthetic-device-private',userCode:loginOutcome==='approve'?'TEST-CODE':'CANCEL-CODE',verificationUri:`${origin}/device`,expiresIn:30,interval:1}));
      } else if(route==='/v1/device/poll') {
        response.end(JSON.stringify(loginOutcome==='approve'?{status:'approved',scope:'read',accessToken:'synthetic-read-private',refreshToken:'synthetic-refresh-private',expiresIn:3600,refreshExpiresIn:86400,grantId:'synthetic-grant'}:{status:'pending'}));
      } else if(route===`/v1/captures/${id}`) {
        assert.equal(request.headers.authorization,'Bearer synthetic-read-private');requests++;
        response.end(JSON.stringify(grouped?.manifest ?? {id,status:'ready',files:Object.entries(files).map(([path,bytes])=>({path,size:bytes.length,sha256:hash(bytes)}))}));
      } else if(route==='/v1/encryption/peers') {
        assert.ok(grouped);response.end(JSON.stringify(grouped.peers));
      } else if(route.startsWith(`/v1/captures/${id}/files/`)) {
        const path=route.slice(`/v1/captures/${id}/files/`.length);
        const bytes=(grouped?.transport ?? files)[path];assert.ok(bytes);downloads.push(path);
        response.end(tamper && path==='summary.md'?Buffer.from('tampered'):bytes);
      } else {response.statusCode=404;response.end('{}');}
    } catch(error) { response.statusCode=500;response.end('{}');serverErrors.push(String(error)); }
  });
  const serverErrors:string[]=[];
  await new Promise<void>(ready=>server.listen(0,'127.0.0.1',ready));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let passed=false;
  try {
    // Authenticate the actual pinned component, including final producer admission.
    const pinFile=join(work,'pin.json');writeFileSync(pinFile,JSON.stringify(pin));
    stage(pinFile,target,join(work,'verified-producer'));
    writeFileSync(config,JSON.stringify({unknown:{preserved:42},secret:'synthetic-config-private',
      experiments:{hostedEncryption:false},cloud:{enabled:false,uploadConsent:false}}),{mode:0o600});
    await run(image,['connect','login','--server',origin,'--no-browser']);
    const status=JSON.parse(await run(image,['connect','status']));
    assert.equal(status.readSignedIn,true);assert.equal(status.enabled,false);assert.equal(status.uploadConsent,false);
    // Preserve legacy plaintext retrieval before exercising distinct encrypted groups.
    const full=join(work,'full.apparent');
    await run(image,['fetch',id,'--out',full,'--wait','0']);
    for(const [path,bytes] of Object.entries(files))assert.deepEqual(readFileSync(join(full,path)),bytes);
    assert.equal(JSON.parse(await run(image,['inspect',id,'--json'])).id,id);
    assert.equal(JSON.parse(await run(image,['inspect',full,'--json'])).id,id);
    await run(image,['fetch',id,'--out',full,'--wait','0'],'failure');
    assert.deepEqual(readFileSync(join(full,'apparent.json')),files['apparent.json']);
    tamper=true;const invalid=join(work,'invalid.apparent');
    await run(image,['fetch',id,'--out',invalid,'--wait','0'],'failure');assert.equal(existsSync(invalid),false);tamper=false;
    const {groupedFixture}=await import('./grouped-fixture.ts');
    const encryptedMetadata=Buffer.from(JSON.stringify({...bundle,audio:'audio.wav'}));
    grouped=await groupedFixture(origin,id,readerKey!,{...files,'apparent.json':encryptedMetadata});
    // Remove the earlier legacy inspect output so the real bare-ID route downloads anew.
    const evidence=join(work,`${id}.evidence.apparent`);rmSync(evidence,{recursive:true});downloads.length=0;
    assert.equal(JSON.parse(await run(image,['inspect',id,'--json'])).id,id);
    for(const [path,bytes] of Object.entries(grouped.plain)) {
      if(path==='audio.wav')assert.equal(existsSync(join(evidence,path)),false);
      else assert.deepEqual(readFileSync(join(evidence,path)),bytes);
    }
    assert.equal(JSON.parse(readFileSync(join(evidence,'.evidence-only.json'),'utf8')).media,'not downloaded');
    assert.ok(downloads.some(path=>path.startsWith('evidence/')));
    assert.ok(downloads.every(path=>!path.startsWith('media/')),'evidence inspection must not request media');
    downloads.length=0;const recording=join(work,'recording.apparent');
    await run(image,['fetch',id,'--media','--out',recording,'--wait','0']);
    for(const [path,bytes] of Object.entries(grouped.plain))assert.deepEqual(readFileSync(join(recording,path)),bytes);
    assert.equal(existsSync(join(recording,'.evidence-only.json')),false);
    assert.ok(downloads.some(path=>path.startsWith('media/')),'complete fetch must request authenticated media');
    const beforeCancellation=readFileSync(config);loginOutcome='await-cancellation';
    await run(image,['connect','login','--server',origin,'--no-browser'],'cancel-at-approval');
    assert.deepEqual(readFileSync(config),beforeCancellation);loginOutcome='approve';
    await run(image,['connect','status']);
    const saved=JSON.parse(readFileSync(config,'utf8'));assert.equal(saved.unknown.preserved,42);
    assert.equal(saved.cloud.enabled,false);assert.equal(saved.cloud.uploadConsent,false);
    for(const secret of ['synthetic-read-private','synthetic-refresh-private','synthetic-device-private','synthetic-config-private'])assert.ok(!JSON.stringify(commands).includes(secret));
    // Exercise rejection with the real extracted root, not a substitute CLI.
    await run(image,['--appimage-extract']);
    const root=join(work,'squashfs-root/usr/bin/apparent');
    const component=join(work,'squashfs-root/usr/bin/recipient/apparent-connect-recipient');
    const receipt=join(work,'squashfs-root/usr/bin/recipient/manifest.json');
    const original=readFileSync(component), originalReceipt=readFileSync(receipt);
    assert.equal(hash(original),pin.sha256);assert.equal(hash(readFileSync(join(work,'verified-producer/apparent-connect-recipient'))),pin.sha256);
    renameSync(component,component+'.held');
    try {await run(root,['connect','status'],'failure');}finally{renameSync(component+'.held',component);}
    writeFileSync(component,Buffer.concat([original,Buffer.from('tamper')]));
    try {await run(root,['connect','status'],'failure');}finally{writeFileSync(component,original);}
    writeFileSync(receipt,JSON.stringify({...JSON.parse(originalReceipt.toString()),protocol:2}));
    try {await run(root,['connect','status'],'failure');}finally{writeFileSync(receipt,originalReceipt);}
    await run(root,['connect','status']);
    assert.deepEqual(serverErrors,[]);assert.ok(requests>=3);
    passed=true;
  } finally {
    for(const child of children){try{process.kill(-child.pid!,'SIGKILL');}catch{}}
    await new Promise<void>(done=>server.close(()=>done()));
    writeFileSync(join(work,'evidence.json'),JSON.stringify({source,image:resolve(image),imageDigest,target,recipientDigest:pin.sha256,passed,commands},null,2),{mode:0o600});
    // Failed evidence is retained privately; successful bundle text/image remain inspectable.
    console.log(`Packaged acceptance evidence: ${work}/evidence.json`);
    rmSync(join(work,'verified-producer'),{recursive:true,force:true});
  }
});
