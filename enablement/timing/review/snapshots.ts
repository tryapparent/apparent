// Supported T3/API snapshots in, references and timings out. Never execute history.

export function inspectThreads(snapshots: any[], from: number, to: number) {
  const rows = new Map<string, any>(); let invalid = 0;
  for (const raw of snapshots) {
    const s = raw?.structuredContent ?? raw;
    if (!s?.thread?.threadId || !Array.isArray(s.items)) {invalid++; continue;}
    const id = s.thread.threadId;
    const row = rows.get(id) ?? {threadId: id, items: new Map(), status: s.thread.status,
      pendingRequests: s.thread.pendingRequestCount, complete: false};
    row.status = s.thread.status; row.pendingRequests = s.thread.pendingRequestCount;
    row.complete ||= s.hasMore === false;
    for (const item of s.items) if (item && typeof item.itemId === 'string') row.items.set(item.itemId, item);
    rows.set(id, row);
  }
  const humanMessageRefs: any[] = [], waitCandidateRefs: any[] = [];
  const threads = [...rows.values()].map(row => {
    const items = [...row.items.values()].sort((a: any, b: any) => a.position - b.position);
    for (const i of items as any[]) {
      const time = Date.parse(i.updatedAt); if (time < from || time > to || !Number.isFinite(time)) continue;
      const ref = {threadId: row.threadId, itemId: i.itemId, position: i.position, at: i.updatedAt};
      const inherited = i.visibility === 'inherited' || (i.sourceThreadId && i.sourceThreadId !== row.threadId);
      const explicitAnswer = i.creationSource === 'server' && i.type === 'user_message' &&
        /^turn-item:message:async-answer(?::|%3A)runtime-request(?::|%3A)provider(?::|%3A)/.test(i.itemId);
      if (!inherited && i.createdBy === 'user' && (['web', 'mobile'].includes(i.creationSource) || explicitAnswer)) {
        humanMessageRefs.push({...ref, origin: explicitAnswer ? 'explicit-async-answer' : 'direct-ui',
          classification: 'requires-original-context-review'});
      }
    }
    const last = items.at(-1) as any;
    if (last?.createdBy === 'agent' && /waiting|await|pending|hold|blocked|running|unverified/i.test(last.text ?? ''))
      waitCandidateRefs.push({threadId: row.threadId, itemId: last.itemId, classification: 'not-a-stale-wait-verdict'});
    return {threadId: row.threadId, status: row.status, pendingRequests: row.pendingRequests,
      reachedTail: row.complete, hasRequestStart: (items[0] as any)?.position === 0, lastItemId: last?.itemId};
  });
  return {threads, humanMessageRefs, waitCandidateRefs, invalidSnapshots: invalid,
    limitation: 'UI authorship is evidence, not a verdict on judgment. Review original authorization, later steering, live work and exact completion routes.'};
}

// Only complete, allocated, step-backed executions can establish carry provenance.
// Normalize the REST/CLI aliases without using attempt-specific IDs as identity.
function executionIdentity(job: any): string | null {
  const start = Date.parse(job.started_at ?? job.startedAt), end = Date.parse(job.completed_at ?? job.completedAt);
  const runner = job.runner_id ?? job.runnerId;
  if (job.status !== 'completed' || !job.name || !(runner > 0) || !(start > 0) || end < start ||
      !Number.isFinite(end) || !job.steps?.length) return null;
  const steps = job.steps.map((s: any) => [s.number, s.name, s.status, s.conclusion,
    s.started_at ?? s.startedAt, s.completed_at ?? s.completedAt]);
  if (!steps.some((s: any[]) => Date.parse(s[4]) > 0 && Date.parse(s[5]) >= Date.parse(s[4]))) return null;
  return JSON.stringify([job.name, runner, start, end, job.conclusion, steps]);
}

export function inspectJobs(runs: any[], from: number, to: number) {
  const seen = new Set<string>(), jobs: any[] = []; let invalid = 0, unfinishedJobs = 0, unknownAllocationJobs = 0;
  const entries: any[] = [];
  for (const run of runs) {
    const runId = run?.runId ?? run?.databaseId;
    if (!Array.isArray(run?.jobs) || !runId || !/^[a-f0-9]{40}$/.test(run?.headSha ?? '') || !Number.isInteger(run.attempt)) {invalid++; continue;}
    for (const job of run.jobs) {
      if (!(job?.id ?? job?.databaseId)) {invalid++; continue;}
      const id = `${runId}:${run.attempt}:${job.id ?? job.databaseId}`;
      if (seen.has(id)) continue; seen.add(id);
      entries.push({run, runId, job, id});
    }
  }
  for (const {run, runId, job, id} of entries) {
    const start = Date.parse(job.started_at ?? job.startedAt), end = Date.parse(job.completed_at ?? job.completedAt);
    const created = Date.parse(job.created_at ?? job.createdAt);
    if (job.conclusion === 'skipped') continue;
    const terminal = job.status === 'completed' || !!job.conclusion;
    const priorExecution = terminal && Number.isFinite(created) && start > 0 && start < created;
    if (priorExecution) {
      const identity = executionIdentity(job);
      const originals = identity === null ? [] : entries.filter(e => e.runId === runId &&
        e.run.headSha === run.headSha && e.run.attempt < run.attempt &&
        Date.parse(e.job.created_at ?? e.job.createdAt) <= start && executionIdentity(e.job) === identity);
      // Keep the unique original reference and its queue, independent of input order.
      if (originals.length === 1) continue;
    }
    // REST supplies started_at == created_at even before runner allocation.
    // Status/runner identity must qualify that timestamp before calling it execution.
    const pending = ['queued', 'waiting', 'pending'].includes(job.status);
    const runner = job.runner_id ?? job.runnerId;
    const unallocated = pending || runner === 0;
    const unknownAllocation = !unallocated && runner === undefined &&
      job.conclusion != null && job.conclusion !== 'success' && !job.steps?.some((s: any) => s.status === 'completed');
    if (unknownAllocation) unknownAllocationJobs++;
    const startKnown = Number.isFinite(start) && start > 0;
    const endKnown = Number.isFinite(end) && end > 0 && (!Number.isFinite(created) || end >= created) &&
      (!Number.isFinite(start) || end >= start);
    const executionKnown = !priorExecution && !unallocated && !unknownAllocation && startKnown && endKnown;
    const runnerSeconds = unallocated ? 0 : executionKnown ? Math.max(0, Math.min(end, to) - Math.max(start, from)) / 1000 : null;
    const queueEnd = priorExecution ? NaN : pending ? to : unallocated ? (endKnown ? end : NaN) :
      !unknownAllocation && startKnown ? start : NaN;
    const queueSeconds = Number.isFinite(created) && created <= queueEnd ? Math.max(0, Math.min(queueEnd, to) - Math.max(created, from)) / 1000 : null;
    const unfinished = !terminal && !unallocated && !unknownAllocation && startKnown && start < to && !endKnown;
    if (unfinished) unfinishedJobs++;
    if (runnerSeconds === 0 && queueSeconds === 0 && !unfinished) continue;
    const waitingAtCutoff = !priorExecution && Number.isFinite(created) && created <= to && (pending || (unallocated && endKnown && end > to) || (!unallocated && startKnown && start > to));
    const runningAtCutoff = !unallocated && !unknownAllocation && startKnown && start <= to && (!endKnown || end > to) && !priorExecution;
    const stepRows = (!unallocated && !unknownAllocation && !priorExecution ? job.steps ?? [] : []).flatMap((s:any) => {
      if (s.conclusion === 'skipped') return [];
      const a = Date.parse(s.started_at ?? s.startedAt), b = Date.parse(s.completed_at ?? s.completedAt);
      if (!(a > 0) || a >= to || (Number.isFinite(b) && b > 0 && b < from)) return [];
      const complete = b > 0 && b >= a;
      if (!complete && s.status !== 'in_progress') return [];
      const seconds = Math.max(0,Math.min(complete ? b : to,to)-Math.max(a,from))/1000;
      return [{number:s.number,name:s.name,conclusion:s.conclusion,seconds,complete:complete && b <= to}];
    });
    jobs.push({id, runId, attempt: run.attempt, headSha: run.headSha, name: job.name,
      conclusion: job.conclusion, runnerSeconds, queueSeconds, status:job.status,
      labels:job.labels ?? [], runnerName:job.runner_name ?? job.runnerName ?? null,
      waitingAtCutoff,runningAtCutoff,
      executionAgeSeconds:runningAtCutoff ? (to-start)/1000 : null,
      queueAgeSeconds:waitingAtCutoff ? (to-created)/1000 : null,
      waitReason: waitingAtCutoff ? (job.waitingReason ?? (pending && job.status !== 'queued' ? 'Provider wait; runner/dependency/concurrency/approval cause not supplied' : 'No runner execution by cutoff; allocation/capacity cause requires provider evidence')) : null,
      steps:stepRows,
      ...(priorExecution ? {provenance: 'unknown-prior-execution'} : {})});
  }
  const group = (field:'queueSeconds'|'runnerSeconds', key:(j:any)=>string) => {
    const groups=new Map<string,number[]>();
    for (const j of jobs) if (j[field] !== null) {const label=key(j);groups.set(label,[...(groups.get(label) ?? []),j[field]]);}
    return [...groups].map(([label,seconds])=>{const totalSeconds=seconds.reduce((a,b)=>a+b,0);return {label,count:seconds.length,meanSeconds:totalSeconds/seconds.length,totalSeconds};}).sort((a,b)=>b.totalSeconds-a.totalSeconds);
  };
  const steps = jobs.flatMap(j=>j.steps.map((s:any)=>({...s,jobRef:j.id,runId:j.runId,attempt:j.attempt,headSha:j.headSha,jobName:j.name}))).sort((a,b)=>b.seconds-a.seconds);
  const stepGroups = new Map<string,any[]>();
  for (const step of steps) stepGroups.set(step.name,[...(stepGroups.get(step.name) ?? []),step]);
  const executionByStep = [...stepGroups].map(([label,rows])=>{const totalSeconds=rows.reduce((n,s)=>n+s.seconds,0);return {label,count:rows.length,meanSeconds:totalSeconds/rows.length,totalSeconds,incompleteRows:rows.filter(s=>!s.complete).length};}).sort((a,b)=>b.totalSeconds-a.totalSeconds);
  return {jobs: jobs.sort((a, b) => (b.runnerSeconds ?? 0) - (a.runnerSeconds ?? 0)), unfinishedJobs, unknownAllocationJobs, invalidSnapshots: invalid,
    analysis:{
      queueByRunner:group('queueSeconds',j=>j.labels.length ? j.labels.join(', ') : 'runner label unavailable: '+j.name),
      executionByJob:group('runnerSeconds',j=>j.name ?? 'job name unavailable'),
      executionByStep,
      longestWaitingJobs:jobs.filter(j=>j.waitingAtCutoff).sort((a,b)=>b.queueAgeSeconds-a.queueAgeSeconds),
      runningJobs:jobs.filter(j=>j.runningAtCutoff),longestSteps:steps.slice(0,30),
      missingStepJobs:jobs.filter(j=>(j.runnerSeconds ?? 0)>0 && !j.steps.length).map(j=>j.id),
      unknownQueueJobs:jobs.filter(j=>j.queueSeconds === null).map(j=>j.id),
      unknownExecutionJobs:jobs.filter(j=>j.runnerSeconds === null).map(j=>j.id),
      coverage:{runs:new Set(entries.map(e=>`${e.runId}:${e.run.attempt}`)).size,inputJobRows:entries.length,retainedJobRows:jobs.length},
      limitation:'Snapshot coverage only. Job creation-to-allocation does not distinguish workflow dependency, concurrency, approvals or runner capacity without provider evidence. Queue age is full age at cutoff; queue/execution totals are window-clipped. Steps overlap job spans; parallel jobs overlap each other. No critical-path sum or proof that a majority of threads await CI.'},
    limitation: 'Queue uses job creation to allocation, cancellation before allocation, or the cutoff; missing clocks/allocation stay unknown. Carried rows require a unique earlier step-backed execution to retain original attribution; unmatched prior execution has unknown provenance and timing. Terminal status never implies active work. Parallel runner seconds are not critical-path delay.'};
}
