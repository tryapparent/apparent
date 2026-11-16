import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** Real packaged phone assembly at the maximum default allocation. */
export function qualifyAssembly(binary:string,root:string,env:NodeJS.ProcessEnv,ffmpeg:(args:string[])=>unknown) {
  const input=join(root,'assembly-limits.apparent'),out=join(root,'assembly-limits-out.apparent');
  mkdirSync(input,{mode:0o700});
  const movie=join(input,'recording.mp4'),metadata=join(input,'apparent.json');
  ffmpeg(['-f','lavfi','-i','testsrc2=size=96x64:rate=2:duration=140',
    '-c:v','libx264','-threads','1','-pix_fmt','yuv420p',movie]);
  chmodSync(movie,0o600);
  writeFileSync(metadata,JSON.stringify({version:1,id:'synthetic-assembly-limits',createdAtMs:0,
    durationMs:140000,source:'iphone',device:{name:'Synthetic file',capture:'mirror',width:96,height:64},
    target:{mode:'display',displayId:0,frame:{x:0,y:0,width:96,height:64,scale:1}},
    transcript:{source:'test',text:'',segments:[]},strokes:[],events:[],cursor:[],keyframes:[],
    contactSheet:'unused.png',video:'recording.mp4',videoOffsetMs:0,
    marks:Array.from({length:14},(_,i)=>({id:`f${i+1}`,shape:'flag',strokes:[],
      t0:i*10000,t1:i*10000,boxNorm:[0,0,1,1],description:'flagged this moment'}))}),{mode:0o600});
  const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const before=[hash(movie),hash(metadata)];
  execFileSync(binary,['reprocess',input,'--out',out],{env,timeout:60_000,stdio:'pipe'});
  const bundle=JSON.parse(readFileSync(join(out,'apparent.json'),'utf8'));
  assert.equal(bundle.keyframes.length,12);
  assert(bundle.keyframes.every((frame:{reason:string})=>frame.reason==='mark'));
  assert.deepEqual(bundle.keyframes.map((frame:{t:number})=>frame.t),Array.from({length:12},(_,i)=>i*10000));
  const pixels=execFileSync('ffmpeg',['-v','error','-nostdin','-i',join(out,bundle.keyframes[0].file),
    '-f','rawvideo','-pix_fmt','rgba','-'],{timeout:10_000,maxBuffer:1024*1024});
  assert.equal(pixels.length,96*64*4);
  assert(new Set(pixels).size>32,'selected frame must contain decoded producer pixels');
  assert.deepEqual([hash(movie),hash(metadata)],before);
  return join(out,bundle.contactSheet);
}
