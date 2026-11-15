import {decodeMovieFrames} from '@apparent/engine-sdk';
import {linkSync,mkdirSync,rmSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {phoneCandidatePlan,uniqueCandidates} from './phone-policy.ts';

const abort = new AbortController();
process.once('SIGTERM',()=>abort.abort());
try {
  const [executable,movie,directory,duration,...extra] = process.argv.slice(2);
  if (!executable || !movie || !directory || extra.length || !/^\d{1,16}$/.test(duration??'')) throw Error();
  const plan=phoneCandidatePlan(Number(duration)), deadline=Date.now()+300_000;
  const result:{requestIndex:number;requestedMs:number;actualMovieMs:number;width:number;height:number;file:string}[]=[];
  let previous:number|undefined;
  for(let start=0;start<plan.times.length;start+=480) {
    const batch=join(directory,`batch-${start}`); mkdirSync(batch,{mode:0o700});
    try {
      const remaining=deadline-Date.now(); if(remaining<=0)throw Error();
      const frames=await decodeMovieFrames({executable,movie,outputDirectory:batch,timesMs:plan.times.slice(start,start+480),
        maxEdge:plan.maxEdge,timeoutMs:remaining,signal:abort.signal});
      for(const frame of uniqueCandidates(frames,previous)) {
        const index=result.length, name=`frame-${String(index).padStart(3,'0')}.rgba`;
        // Exclusive publication into this job's private output, never a bundle.
        linkSync(frame.file,join(directory,name)); unlinkSync(frame.file);
        result.push({requestIndex:index,requestedMs:frame.actualMs,actualMovieMs:frame.actualMs,
          width:frame.width,height:frame.height,file:name});
        previous=frame.actualMs;
      }
    } finally {rmSync(batch,{recursive:true,force:true});}
  }
  process.stdout.write(JSON.stringify({version:1,frames:result})+'\n');
} catch {
  process.stderr.write('Record could not decode phone movie candidates\n');
  process.exitCode=1;
}
