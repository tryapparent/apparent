/** Real executable seam; this is not installed-root/package acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
const executable=process.env.APPARENT_TEST_RECIPIENT_EXECUTABLE;
test('real recipient decrypts grouped evidence without requesting media; full fetch includes WAV',{
  skip:executable?false:'requires explicit genuine recipient executable; not package proof',timeout:60_000,
},async()=>{
  assert.ok(executable && isAbsolute(executable));
  const {groupedFixture}=await import('./grouped-fixture.ts');
  const work=mkdtempSync(join(tmpdir(),'recipient-grouped-'));
  const config=join(work,'config.json');writeFileSync(config,'{"cloud":{"enabled":false,"uploadConsent":false}}',{mode:0o600});
  const id='0123456789abcdef0123456789abcdef';
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=','base64');
  let fixture:Awaited<ReturnType<typeof groupedFixture>>;
  const downloads:string[]=[],errors:string[]=[];
  const server=createServer(async(req,res)=>{
    try{
      let body='';for await(const part of req)body+=part;
      const path=new URL(req.url!,'http://fixture').pathname;
      res.setHeader('content-type','application/json');
      if(path==='/v1/device/start'){
        const start=JSON.parse(body);assert.equal(start.scope,'read');
        fixture=await groupedFixture(origin,id,start.encryptionKey,{
          'apparent.json':Buffer.from(JSON.stringify({id,audio:'audio.wav',keyframes:[],contactSheet:'contact-sheet.png'})),
          'summary.md':Buffer.from('Synthetic grouped recipient proof'),'contact-sheet.png':png});
        res.end(JSON.stringify({deviceCode:'synthetic-device',userCode:'TEST',verificationUri:`${origin}/device`,expiresIn:30,interval:1}));
      }else if(path==='/v1/device/poll')res.end(JSON.stringify({status:'approved',scope:'read',accessToken:'synthetic-read',refreshToken:'synthetic-refresh',expiresIn:3600,refreshExpiresIn:86400,grantId:'synthetic-grant'}));
      else if(path==='/v1/encryption/peers')res.end(JSON.stringify(fixture.peers));
      else if(path===`/v1/captures/${id}`)res.end(JSON.stringify(fixture.manifest));
      else if(path.startsWith(`/v1/captures/${id}/files/`)){
        const asset=path.slice(`/v1/captures/${id}/files/`.length);downloads.push(asset);
        assert.ok(fixture.transport[asset]);res.end(fixture.transport[asset]);
      }else{res.statusCode=404;res.end('{}');}
    }catch(error){errors.push(String(error));res.statusCode=500;res.end('{}');}
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const invoke=(operation:object)=>new Promise<void>((done,reject)=>{
    const child=spawn(executable,[],{cwd:work,env:{...process.env,APPARENT_CONFIG:config},stdio:['pipe','pipe','pipe']});
    let output='',stderr='';let limit=false;
    const timer=setTimeout(()=>{limit=true;child.kill('SIGKILL');},20_000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>100_000){limit=true;child.kill('SIGKILL');}});
    child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>100_000){limit=true;child.kill('SIGKILL');}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',(code,signal)=>{clearTimeout(timer);try{
      assert.equal(limit,false);assert.equal(signal,null);assert.equal(code,0,output);assert.equal(stderr,'');
      assert.ok(JSON.parse(output.trim().split('\n').at(-1)!).result);done();
    }catch(error){reject(error);}});
    child.stdin.end(JSON.stringify({protocol:1,operation}));
  });
  try{
    await invoke({kind:'login',server:origin,browser:false});
    for(const evidenceOnly of [true,false]){
      downloads.length=0;const out=join(work,evidenceOnly?'evidence.apparent':'full.apparent');
      await invoke({kind:'fetch',id,out,wait:0,evidence_only:evidenceOnly});
      for(const [path,bytes] of Object.entries(fixture!.plain)){
        if(evidenceOnly && path==='audio.wav')assert.equal(existsSync(join(out,path)),false);
        else assert.deepEqual(readFileSync(join(out,path)),bytes);
      }
      assert.equal(existsSync(join(out,'.evidence-only.json')),evidenceOnly);
      assert.ok(downloads.some(path=>path.startsWith('evidence/')));
      assert.equal(downloads.some(path=>path.startsWith('media/')),!evidenceOnly);
    }
    assert.deepEqual(errors,[]);
  }finally{await new Promise<void>(done=>server.close(()=>done()));rmSync(work,{recursive:true,force:true});}
});
