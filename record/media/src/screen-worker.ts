import {decodeMovieFrames} from '@apparent/engine-sdk';
import {linkSync,mkdirSync,rmSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {uniqueCandidates} from './phone-policy.ts';
import {screenCandidatePage,screenBundleTime} from './screen-policy.ts';

const abort=new AbortController();process.once('SIGTERM',()=>abort.abort());
try {
  const [executable,movie,directory,duration,offset,purpose,cursor,budget,...extra]=process.argv.slice(2);
  if(!executable||!movie||!directory||extra.length||!/^\d{1,16}$/.test(duration??'')||!/^\d{1,16}$/.test(offset??'')||
    !/^\d{1,6}$/.test(budget??''))throw Error();
  const remaining=Number(budget);if(remaining<1||remaining>300_000)throw Error();
  const page=screenCandidatePage(Number(duration),Number(offset),purpose,cursor);
  const batch=join(directory,'native');mkdirSync(batch,{mode:0o700});
  const result:{requestIndex:number;requestedMs:number;actualMovieMs:number;width:number;height:number;file:string}[]=[];
  let previous=page.previous;
  try {
    const frames=await decodeMovieFrames({executable,movie,outputDirectory:batch,timesMs:page.times,
      maxEdge:page.maxEdge,timeoutMs:remaining,signal:abort.signal});
    for(const frame of uniqueCandidates(frames,previous)) {
      const index=result.length,name=`frame-${String(index).padStart(3,'0')}.rgba`;
      linkSync(frame.file,join(directory,name));unlinkSync(frame.file);
      result.push({requestIndex:index,requestedMs:screenBundleTime(frame.actualMs,page.offset),actualMovieMs:frame.actualMs,
        width:frame.width,height:frame.height,file:name});
      previous=frame.actualMs;
    }
  } finally {rmSync(batch,{recursive:true,force:true});}
  const nextCursor=page.nextStart===null?null:JSON.stringify({start:page.nextStart,previous});
  process.stdout.write(JSON.stringify({reply:{version:1,frames:result},nextCursor})+'\n');
} catch {process.stderr.write('Record could not decode screen movie candidates\n');process.exitCode=1;}
