/** Producer-normalized text through real phone, screen-finalization and recovery callers. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function qualifyTranscript(options: {
  binary: string; sourceBundle: string; root: string; home: string; runtimeDirectory: string;
}) {
  const {binary, sourceBundle, root, home, runtimeDirectory} = options;
  const directory=join(root,'transcript-proof');mkdirSync(directory,{mode:0o700});
  const movie=join(directory,'source.mp4');
  execFileSync('ffmpeg',['-v','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=96x64:rate=2:duration=20',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=20','-c:v','libx264','-threads','1',
    '-pix_fmt','yuv420p','-c:a','aac',movie],{timeout:60_000});chmodSync(movie,0o600);
  const wav=join(directory,'audio.wav');
  execFileSync('ffmpeg',['-v','error','-nostdin','-i',movie,'-ac','1','-ar','16000',wav],{timeout:30_000});chmodSync(wav,0o600);
  const words=[[0,'Make'],[1000,'this'],[2000,'smaller'],[2100,','],[3000,'and'],[4000,'move'],
    [7000,'that.'],[10500,'Next'],[11000,'part.'],[15000,'Final'],[16000,'words.']]
    .map(([t,text])=>({t0:Number(t),t1:Number(t)+100,text:String(text)}));
  const transcript={version:1,estimated:false,text:'Make this smaller, and move that. Next part. Final words.',words,
    segments:[{t0:0,t1:7100,text:'Make this smaller, and move that.'},
      {t0:10500,t1:11100,text:'Next part.'},{t0:15000,t1:16100,text:'Final words.'}]};
  const transcriber=join(directory,'transcriber.ts'),config=join(directory,'config.json');
  writeFileSync(transcriber,`console.log(JSON.stringify(${JSON.stringify(transcript)}));\n`,{mode:0o600});
  writeFileSync(config,JSON.stringify({transcriber:'command',transcribeTimeoutSeconds:10,
    transcribeCommand:[process.execPath,'--experimental-strip-types',transcriber,'{audio}']}),{mode:0o600});
  const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const preserved=[movie,wav,transcriber,config].map(path=>[path,hash(path)] as const);
  const rows=[];
  for(const route of ['phone','screen','recovery']) {
    const input=join(directory,route+'-input.apparent'),output=join(directory,route+'-output.apparent');
    cpSync(sourceBundle,input,{recursive:true,errorOnExist:true,force:false});chmodSync(input,0o700);
    cpSync(movie,join(input,'recording.mp4'));chmodSync(join(input,'recording.mp4'),0o600);
    cpSync(wav,join(input,'audio.wav'));chmodSync(join(input,'audio.wav'),0o600);
    const manifest=JSON.parse(readFileSync(join(input,'apparent.json'),'utf8'));
    manifest.durationMs=20000;manifest.source=route==='phone'?'iphone':'screen';
    manifest.device=route==='phone'?{name:'Synthetic file',capture:'mirror',width:96,height:64}:undefined;
    manifest.target={mode:'display',displayId:0,frame:{x:0,y:0,width:96,height:64,scale:1}};
    manifest.video='recording.mp4';manifest.audio='audio.wav';manifest.videoOffsetMs=0;manifest.strokes=[];manifest.events=[];manifest.cursor=[];
    manifest.marks=[1000,4000,7000,10000,13000,16000].map((t,i)=>({id:`f${i+1}`,shape:'flag',strokes:[],t0:t,t1:t,
      boxNorm:[0,0,1,1],description:'flagged this moment'}));
    writeFileSync(join(input,'apparent.json'),JSON.stringify(manifest),{mode:0o600});
    if(route!=='phone')manifest.marks=[];
    writeFileSync(join(input,'apparent.json'),JSON.stringify(manifest),{mode:0o600});
    const before=[hash(join(input,'apparent.json')),hash(join(input,'recording.mp4')),hash(join(input,'audio.wav'))];
    execFileSync(binary,['reprocess',input,'--out',output,'--transcriber','command',...(route==='screen'?['--bench','1']:[])],
      {timeout:90_000,stdio:'pipe',env:{...process.env,HOME:home,CFFIXED_USER_HOME:home,APPARENT_CONFIG:config,
        APPARENT_MODELS_DIR:join(home,'unused-models'),XDG_CONFIG_HOME:join(home,'config'),XDG_DATA_HOME:join(home,'data'),
        XDG_CACHE_HOME:join(home,'cache'),XDG_RUNTIME_DIR:runtimeDirectory,DISPLAY:'',WAYLAND_DISPLAY:'',
        DBUS_SESSION_BUS_ADDRESS:'',APPIMAGE_EXTRACT_AND_RUN:'1'}});
    const result=JSON.parse(readFileSync(join(output,'apparent.json'),'utf8'));
    assert.match(result.transcript.source,/^command:/);assert.equal(result.transcript.text,transcript.text);
    const said=result.keyframes.map((frame:{said?:string})=>frame.said??null);
    assert(result.keyframes.length>=2,'the changed movie must exercise allocation across multiple real frames');
    if(route==='phone') {
      assert.deepEqual(result.keyframes.map((frame:{t:number})=>frame.t),[1000,4000,7000,10000,13000,16000]);
      assert.deepEqual(said,['Make this smaller,','and move','that.','Next part.',null,'Final words.']);
    }
    assert.equal(said.filter(Boolean).join(' '),transcript.text,'words must appear once, in order, across real frames');
    const summary=readFileSync(join(output,'summary.md'),'utf8');
    for(const text of said.filter(Boolean))assert(summary.includes(text));
    assert.deepEqual([hash(join(input,'apparent.json')),hash(join(input,'recording.mp4')),hash(join(input,'audio.wav'))],before);
    rows.push({route,said,transcript:result.transcript,keyframes:result.keyframes,
      frameHashes:result.keyframes.map((frame:{file:string})=>hash(join(output,frame.file))),
      sheet:join(output,result.contactSheet),sheetHash:hash(join(output,result.contactSheet)),summary});
  }
  for(const [path,before] of preserved)assert.equal(hash(path),before,'source or isolated config was changed');
  return rows;
}
