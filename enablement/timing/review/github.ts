// Bounded authenticated read-only snapshots. Never dispatch, retry or watch CI.
import {execFileSync} from 'node:child_process';

export type ReadGitHub = (args:string[])=>any;
const readGitHub:ReadGitHub = args=>JSON.parse(execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024,timeout:30_000}));

type ExactAttempt = {runId:number; attempt:number; headSha:string};
type ExactStatus = 'metadata-unavailable' | 'identity-mismatch' | 'after-cutoff' |
  'jobs-unavailable' | 'jobs-incomplete' | 'captured';
type ListedRun = {databaseId:number; attempt:number; headSha:string; status:string;
  conclusion:string | null; name:string; createdAt:string; updatedAt:string};
type AttemptMetadata = {id:number; run_attempt:number; head_sha:string; status:string;
  conclusion:string | null; name:string; created_at:string; updated_at:string};

function parseExactAttempt(value:string):ExactAttempt {
  const parts=value.match(/^([1-9][0-9]*)\/([1-9][0-9]*)\/([a-f0-9]{40})$/i);
  if (parts) {
    const runId=Number(parts[1]), attempt=Number(parts[2]);
    if (Number.isSafeInteger(runId) && Number.isSafeInteger(attempt))
      return {runId,attempt,headSha:parts[3].toLowerCase()};
  }
  throw Error('Expected --ci-exact-attempt RUN_ID/ATTEMPT/FULL_HEAD_SHA');
}

export function collectGitHub(repo:string, from:string, to:string, limit=12, read:ReadGitHub=readGitHub, exact?:string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Expected GitHub owner/repository');
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw Error('CI run limit must be 1–40');
  const end=Date.parse(to), fields='databaseId,headSha,attempt,status,conclusion,createdAt,updatedAt,name';
  const request=exact === undefined ? undefined : parseExactAttempt(exact);
  const exactAttempt=request && {...request,status:'metadata-unavailable' as ExactStatus};
  const isExactRoute=(run:ListedRun)=>!!request && run.databaseId===request.runId && run.attempt===request.attempt;
  const runPath=(runId:number,attempt:number)=>`repos/${repo}/actions/runs/${runId}/attempts/${attempt}`;
  const lists=['queued','in_progress','waiting','completed'].map(status=>({status,rows:read(['run','list','--repo',repo,'--status',status,
    ...(status==='completed' ? ['--created',`>=${from}`] : []),'--limit','100','--json',fields])}));
  const candidates=new Map<number,ListedRun>();
  for (const {rows} of lists) for (const run of rows) if (Date.parse(run.createdAt)<=end) candidates.set(run.databaseId,run);
  const ordered=[...candidates.values()].filter(r=>!isExactRoute(r)).sort((a,b)=>{
    const pending=(r:ListedRun)=>r.status!=='completed';
    return Number(pending(b))-Number(pending(a)) || (pending(a) ? Date.parse(a.createdAt)-Date.parse(b.createdAt) : Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  });
  // Reserve coverage for execution and completed step costs, not only a large queue.
  const selected:ListedRun[]=[];
  const ordinaryLimit=limit-(request ? 1 : 0);
  const take=(rows:ListedRun[],count:number)=>{for(const r of rows)if(selected.length<ordinaryLimit && count>0 && !selected.includes(r)){selected.push(r);count--;}};
  take(ordered.filter(r=>r.status!=='completed' && r.status!=='in_progress'),Math.max(1,Math.ceil(ordinaryLimit/2)));
  take(ordered.filter(r=>r.status==='in_progress'),Math.floor(ordinaryLimit/4));
  take(ordered.filter(r=>r.status==='completed'),Math.floor(ordinaryLimit/4));
  take(ordered,ordinaryLimit-selected.length);
  const ordinarySelected=selected.length;
  if (exactAttempt) {
    const {runId,attempt,headSha}=exactAttempt;
    let run:AttemptMetadata | undefined;
    try {
      run=read(['api',runPath(runId,attempt)]);
    } catch {}
    if (run) {
      const created=Date.parse(run.created_at);
      if (run.id!==runId || run.run_attempt!==attempt || run.head_sha!==headSha)
        exactAttempt.status='identity-mismatch';
      else if (created>end)
        exactAttempt.status='after-cutoff';
      else if (Number.isFinite(created)) {
        selected.unshift({databaseId:runId,attempt,headSha,status:run.status,conclusion:run.conclusion,
          createdAt:run.created_at,updatedAt:run.updated_at,name:run.name});
        exactAttempt.status='jobs-unavailable';
      }
    }
  }
  const errors:{runId:number;reason:string}[]=[],runs:any[]=[];
  for (const run of selected) {
    try {
      const jobs:any[]=[]; let expected=0,pages=0;
      do {
        const page=read(['api',`${runPath(run.databaseId,run.attempt)}/jobs?per_page=100&page=${++pages}`]);
        if (!Array.isArray(page.jobs) || !Number.isInteger(page.total_count)) throw Error('Invalid jobs snapshot');
        jobs.push(...page.jobs); expected=page.total_count;
        if (!page.jobs.length) break;
      } while (jobs.length<expected && pages<10);
      runs.push({...run,jobs,snapshotCoverage:{pages,expectedJobs:expected,capturedJobs:jobs.length,complete:jobs.length>=expected}});
      if (exactAttempt && isExactRoute(run))
        exactAttempt.status=jobs.length>=expected ? 'captured' : 'jobs-incomplete';
    } catch {errors.push({runId:run.databaseId,reason:'Authenticated snapshot read failed; no CI failure inferred. Check local gh access/API availability.'});}
  }
  return {runs,coverage:{repository:repo,eligibleRunsCaptured:candidates.size,selectedRuns:ordinarySelected+(request ? 1 : 0),
    runLimit:limit,listCaps:lists.map(l=>({status:l.status,captured:l.rows.length,possiblyTruncated:l.rows.length===100})),
    jobPages:runs.map(r=>({runId:r.databaseId,attempt:r.attempt,...r.snapshotCoverage})),
    runLimitReached:ordered.length>ordinarySelected,errors,...(exactAttempt ? {exactAttempt} : {}),
    limitation:'Live snapshots, not historical state reconstruction. Old queued/running/waiting runs included regardless of creation age; completed-run discovery is creation-window bounded and can miss older runs completing in the window. Sampling reserves half for oldest queues, a quarter for running work and a quarter for recent completions, filling unused slots from pending work. Listing and run caps are explicit; this sample does not establish a repository-wide critical path or majority of threads.'}};
}
