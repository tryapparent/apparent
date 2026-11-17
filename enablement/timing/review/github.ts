// Bounded authenticated read-only snapshots. Never dispatch, retry or watch CI.
import {execFileSync} from 'node:child_process';

export type ReadGitHub = (args:string[])=>any;
const readGitHub:ReadGitHub = args=>JSON.parse(execFileSync('gh',args,{encoding:'utf8',maxBuffer:16*1024*1024,timeout:30_000}));

export function collectGitHub(repo:string, from:string, to:string, limit=12, read:ReadGitHub=readGitHub) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Expected GitHub owner/repository');
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw Error('CI run limit must be 1–40');
  const end=Date.parse(to), fields='databaseId,headSha,attempt,status,conclusion,createdAt,updatedAt,name';
  const lists=['queued','in_progress','waiting','completed'].map(status=>({status,rows:read(['run','list','--repo',repo,'--status',status,
    ...(status==='completed' ? ['--created',`>=${from}`] : []),'--limit','100','--json',fields])}));
  const candidates=new Map<number,any>();
  for (const {rows} of lists) for (const run of rows) if (Date.parse(run.createdAt)<=end) candidates.set(run.databaseId,run);
  const ordered=[...candidates.values()].sort((a,b)=>{
    const pending=(r:any)=>r.status!=='completed';
    return Number(pending(b))-Number(pending(a)) || (pending(a) ? Date.parse(a.createdAt)-Date.parse(b.createdAt) : Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  });
  // Reserve coverage for execution and completed step costs, not only a large queue.
  const selected:any[]=[];
  const take=(rows:any[],count:number)=>{for(const r of rows)if(selected.length<limit && count>0 && !selected.includes(r)){selected.push(r);count--;}};
  take(ordered.filter(r=>r.status!=='completed' && r.status!=='in_progress'),Math.max(1,Math.ceil(limit/2)));
  take(ordered.filter(r=>r.status==='in_progress'),Math.floor(limit/4));
  take(ordered.filter(r=>r.status==='completed'),Math.floor(limit/4));
  take(ordered,limit-selected.length);
  const errors:{runId:number;reason:string}[]=[],runs:any[]=[];
  for (const run of selected) {
    try {
      const jobs:any[]=[]; let expected=0,pages=0;
      do {
        const page=read(['api',`repos/${repo}/actions/runs/${run.databaseId}/attempts/${run.attempt}/jobs?per_page=100&page=${++pages}`]);
        if (!Array.isArray(page.jobs) || !Number.isInteger(page.total_count)) throw Error('Invalid jobs snapshot');
        jobs.push(...page.jobs); expected=page.total_count;
        if (!page.jobs.length) break;
      } while (jobs.length<expected && pages<10);
      runs.push({...run,jobs,snapshotCoverage:{pages,expectedJobs:expected,capturedJobs:jobs.length,complete:jobs.length>=expected}});
    } catch {errors.push({runId:run.databaseId,reason:'Authenticated snapshot read failed; no CI failure inferred. Check local gh access/API availability.'});}
  }
  return {runs,coverage:{repository:repo,eligibleRunsCaptured:candidates.size,selectedRuns:selected.length,
    runLimit:limit,listCaps:lists.map(l=>({status:l.status,captured:l.rows.length,possiblyTruncated:l.rows.length===100})),
    jobPages:runs.map(r=>({runId:r.databaseId,attempt:r.attempt,...r.snapshotCoverage})),
    runLimitReached:candidates.size>selected.length,errors,
    limitation:'Live snapshots, not historical state reconstruction. Old queued/running/waiting runs included regardless of creation age; completed-run discovery is creation-window bounded and can miss older runs completing in the window. Sampling reserves half for oldest queues, a quarter for running work and a quarter for recent completions, filling unused slots from pending work. Listing and run caps are explicit; this sample does not establish a repository-wide critical path or majority of threads.'}};
}
