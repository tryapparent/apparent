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
      if (i.createdBy === 'user' && ['web', 'mobile'].includes(i.creationSource)) {
        humanMessageRefs.push({...ref, classification: 'requires-original-context-review'});
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

export function inspectJobs(runs: any[], from: number, to: number) {
  const seen = new Set<string>(), jobs: any[] = []; let invalid = 0, unfinishedJobs = 0;
  for (const run of runs) {
    const runId = run?.runId ?? run?.databaseId;
    if (!Array.isArray(run?.jobs) || !runId || !/^[a-f0-9]{40}$/.test(run?.headSha ?? '') || !Number.isInteger(run.attempt)) {invalid++; continue;}
    for (const job of run.jobs) {
      if (!(job?.id ?? job?.databaseId)) {invalid++; continue;}
      const id = `${runId}:${run.attempt}:${job.id ?? job.databaseId}`;
      if (seen.has(id)) continue; seen.add(id);
      const start = Date.parse(job.started_at ?? job.startedAt), end = Date.parse(job.completed_at ?? job.completedAt);
      const created = Date.parse(job.created_at ?? job.createdAt);
      if (job.conclusion === 'skipped') continue;
      const executionKnown = Number.isFinite(start) && Number.isFinite(end) && end >= start;
      const runnerSeconds = executionKnown ? Math.max(0, Math.min(end, to) - Math.max(start, from)) / 1000 : null;
      const queueEnd = Number.isFinite(start) ? start : ['queued', 'waiting', 'pending'].includes(job.status) ? to : NaN;
      const queueSeconds = Number.isFinite(created) && created <= queueEnd ? Math.max(0, Math.min(queueEnd, to) - Math.max(created, from)) / 1000 : null;
      const unfinished = Number.isFinite(start) && start < to && !Number.isFinite(end);
      if (unfinished) unfinishedJobs++;
      if (!runnerSeconds && !queueSeconds && !unfinished) continue;
      jobs.push({id, runId, attempt: run.attempt, headSha: run.headSha, name: job.name,
        conclusion: job.conclusion, runnerSeconds, queueSeconds});
    }
  }
  return {jobs: jobs.sort((a, b) => (b.runnerSeconds ?? 0) - (a.runnerSeconds ?? 0)), unfinishedJobs, invalidSnapshots: invalid,
    limitation: 'Queue uses job creation, not workflow creation; missing queue times stay unknown. Parallel runner seconds are not critical-path delay.'};
}
