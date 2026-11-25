// Artifact presentation only, not an application surface or an automated diagnosis.
const number = (n: number) => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw Error('Invalid measured number');
  return n.toFixed(3).replace(/\.?0+$/, '') || '0';
};
const escape = (s: unknown) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function markdown(data: any): string {
  const actionLines: string[] = [];
  const ci = data.jobs?.analysis;
  actionLines.push('## Largest measured costs', '');
  for (const [clock,row] of [
    ['CI queue',ci?.queueByRunner[0]],['CI execution',ci?.executionByJob[0]],
    ['CI step',ci?.executionByStep?.[0]],['Local observed process',data.census.actionRanking?.processes?.candidate]
  ] as const) if(row) actionLines.push(`- ${clock}: ${row.label}: ${number(row.count)} × ${number(row.meanSeconds)}s = ${number(row.totalSeconds)}s.`);
  actionLines.push('', 'These clocks overlap and are not additive. Largest measured cost is not automatically avoidable delay or a proven critical path.', '');
  for (const ranking of Object.values(data.census.actionRanking ?? {}) as any[]) {
    const best = ranking.candidate;
    actionLines.push(`## Most time-consuming identified action (${ranking.clock})`, '');
    const observed = ranking.largestObserved;
    if (observed) actionLines.push(`Largest observed operation group: ${observed.label}: ${number(observed.count)} × ${number(observed.meanSeconds)}s = ${number(observed.totalSeconds)}s.`, '');
    actionLines.push(best ? `${best.label}: ${number(best.count)} × ${number(best.meanSeconds)}s = ${number(best.totalSeconds)}s.` : 'No identifiable action has complete timing evidence.');
    actionLines.push(ranking.winnerEstablished ? 'Largest action established within this captured clock and coverage.' : '**Overall winner unresolved:** mixed/unresolved time could contain a larger action; do not claim the candidate is the overall bottleneck.');
    actionLines.push(`Mixed/unresolved total: ${number(ranking.unresolvedSeconds)}s.`, '', ranking.limitation, '',
      '| Operation(s) in the measured envelope | Calls/spans | Mean seconds | Total seconds | Attribution |', '|---|---:|---:|---:|---|');
    for (const row of ranking.ranked) actionLines.push(`| ${row.label.replaceAll('|','/')} | ${row.count} | ${number(row.meanSeconds)} | ${number(row.totalSeconds)} | ${row.unresolved ? 'mixed/unresolved' : 'identified'} |`);
    actionLines.push('', 'Largest unresolved source references (inspect original context):', '');
    for (const row of ranking.ranked.filter((r:any)=>r.unresolved).slice(0,5)) for (const s of row.sources) actionLines.push(`- ${row.label}: ${s.sourceRef?.file ?? 'source unavailable'}:${s.sourceRef?.line ?? '?'} (call ${s.id})`);
    actionLines.push('');
    if (ranking.coverage) actionLines.push(`Unclassified command purposes: ${ranking.coverage.unclassifiedRows}/${ranking.coverage.completeRows} rows, ${number(ranking.coverage.unclassifiedSeconds)}s. This is separate from known mixed-operation envelopes and waits without a recovered origin.`, '');
  }
  if (data.pushTiming) {
    const {coverage, verification, toolWaits} = data.pushTiming;
    actionLines.push('## Linked push timing', '',
      `Receipt coverage: ${coverage.candidates} candidate IDs, ${coverage.unlinked} unlinked, ${coverage.launchOnly} launch-only, ${coverage.openVerification} verification without observed exit, ${coverage.observedResults} tool-observed results.`, '');
    for (const [label, row] of [['Pre-push selector and verification', verification], ['Linked tool waits (tool clock)', toolWaits]] as const)
      actionLines.push(row.count ? `- ${label}: ${number(row.count)} × ${number(row.meanSeconds)}s = ${number(row.totalSeconds)}s.` : `- ${label}: no measured intervals.`);
    actionLines.push('', 'Tool waits overlap verification and the existing tool-envelope table. The installed runner does not expose admission, transport or process-group exit timestamps.', '');
  }
  actionLines.push('## CI queue, execution and current holds', '');
  if (!ci) actionLines.push('**CI coverage missing:** supply exact run/attempt/SHA job snapshots with `--jobs`. An overall development bottleneck conclusion is incomplete without checking CI.', '');
  else {
    actionLines.push(`Captured ${ci.coverage.runs} run/attempt snapshots; ${ci.coverage.inputJobRows} input jobs, ${ci.coverage.retainedJobRows} relevant rows.`, '',ci.limitation,'');
    if (data.jobs.collection) actionLines.push(`GitHub discovery coverage: ${JSON.stringify(data.jobs.collection)}`, '');
    for (const [name,rows] of [['Queue by requested runner',ci.queueByRunner],['Execution by job',ci.executionByJob],['Step costs by total (includes observed incomplete spans)',ci.executionByStep ?? []]] as const) {
      actionLines.push(`### ${name}`, '', '| Work | Count | Mean seconds | Total seconds |', '|---|---:|---:|---:|');
      for (const row of rows) actionLines.push(`| ${String(row.label).replaceAll('|','/').replaceAll('\n',' ')} | ${row.count} | ${number(row.meanSeconds)} | ${number(row.totalSeconds)} |`);
      actionLines.push('');
    }
    actionLines.push('### Longest waits at cutoff', '');
    for (const j of ci.longestWaitingJobs.slice(0,10)) actionLines.push(`- ${j.id}, SHA ${j.headSha}, ${j.name}; labels ${j.labels.join(', ') || 'unavailable'}: queue age ${number(j.queueAgeSeconds)}s; window queue ${j.queueSeconds === null ? 'unknown' : number(j.queueSeconds)+'s'}. ${j.waitReason}.`);
    if (!ci.longestWaitingJobs.length) actionLines.push('No waiting jobs in the captured snapshots at this cutoff. This is not a repository-wide queue census.');
    actionLines.push('', '### Jobless workflow snapshots: age only, live state unknown', '',
      'No job rows were captured for these records. Live admission wait, runner demand and critical-path delay are unknown. Snapshot age is time since workflow creation, not measured waiting occupancy or cost. Records remain in the bounded sample; run/list caps can leave other workflows unexamined.', '');
    const jobless = ci.joblessSnapshots ?? ci.preJobWaits ?? [];
    const age = (n: number | null | undefined) => n == null ? 'unknown' : number(n)+'s';
    for (const r of jobless) actionLines.push(`- run ${r.runId}, attempt ${r.attempt}, SHA ${r.headSha}, ${r.name}: observed status ${r.status}, snapshot age ${age(r.ageSeconds)}, in-window age ${age(r.windowAgeSeconds ?? r.windowSeconds)}. Job-page coverage: ${r.snapshotCoverage ? JSON.stringify(r.snapshotCoverage) : 'unknown'}.`);
    if (!jobless.length) actionLines.push('No jobless workflow snapshots captured. This is not a repository-wide census.');
    actionLines.push('', '### Longest executing steps (setup/build/test/native details)', '');
    for (const s of ci.longestSteps.slice(0,15)) actionLines.push(`- ${s.jobRef}, SHA ${s.headSha}, step ${s.number} ${s.name}: ${number(s.seconds)}s${s.complete ? '' : ' (incomplete at cutoff)'}.`);
    actionLines.push('', `Active execution rows: ${ci.runningJobs.map((j:any)=>j.id+' ('+number(j.executionAgeSeconds)+'s since allocation)').join(', ') || 'none captured'}. Jobs missing step detail: ${ci.missingStepJobs.join(', ') || 'none among retained known execution rows'}.`,
      `Unknown queue clocks: ${ci.unknownQueueJobs.join(', ') || 'none among retained rows'}. Unknown completed execution clocks: ${ci.unknownExecutionJobs.join(', ') || 'none among retained rows'}.`, '');
  }
  const lines = [`# Enablement timing`, '', `${data.census.window.from} → ${data.census.window.to}`, '',
    ...actionLines,
    'Measured tool-envelope totals (parallel calls overlap; not CPU time or avoidable delay).', '',
    '| Category | Complete calls | Mean seconds/call | Total seconds |', '|---|---:|---:|---:|'];
  for (const g of data.census.categories) {
    const a = g.arithmetic;
    lines.push(`| ${String(g.label).replaceAll('|', '/').replaceAll('\n', ' ')} | ${number(a.count)} | ${number(a.meanSeconds)} | ${number(a.totalSeconds)} |`);
  }
  lines.push('', 'Each row is count × mean = total before display rounding. Missing/censored calls are separate in the JSON.', '',
    '## Recovered asynchronous process spans', '', '| Category | Spans | Mean seconds/span | Total seconds | p95 |', '|---|---:|---:|---:|---:|');
  for (const g of data.processGroups) lines.push(`| ${g.label} | ${g.count} | ${number(g.meanSeconds)} | ${number(g.totalSeconds)} | ${number(g.p95Seconds)} |`);
  lines.push('', 'These spans end at terminal observation and may include admission or delayed reading. Do not add them to tool envelopes, polling or hosted jobs.', '',
    '## Evidence still requiring judgment', '',
    `Direct human message references: ${data.threads?.humanMessageRefs.length ?? 'not collected'}.`,
    `Potential wait references: ${data.threads?.waitCandidateRefs.length ?? 'not collected'}; not stale-wait findings.`,
    `Hosted job snapshots: ${data.jobs?.jobs.length ?? 'not collected'}.`, '',
    'Inspect original requests, later steering, available facts and source consumers before labeling a relay unnecessary or code unmaintainable. Large files, naming similarity and test fan-out alone are leads.', '',
    'Use the decision schema in review/policy.ts for the combined shortlist. Empty findings are valid.', '');
  return lines.join('\n');
}
export function chart(data: any): string {
  const groups = data.census.actionRanking?.processes?.ranked?.length ? data.census.actionRanking.processes.ranked : data.processGroups.length ? data.processGroups : data.census.categories.map((g: any) => ({label: g.label, ...g.arithmetic}));
  const max = Math.max(1, ...groups.map((g: any) => g.totalSeconds));
  const rows = groups.slice(0, 8).map((g: any) => `<div class="row"><span>${escape(g.label)}</span><div class="track"><div class="bar" style="width:${number(100 * g.totalSeconds / max)}%"></div></div><span>${number(g.count)} × ${number(g.meanSeconds)}s = ${number(g.totalSeconds)}s</span></div>`).join('');
  const queue = data.jobs?.analysis?.queueByRunner ?? [], queueMax = Math.max(1,...queue.map((g:any)=>g.totalSeconds));
  const queueRows = queue.slice(0,8).map((g:any)=>`<div class="row"><span>${escape(g.label)}</span><div class="track"><div class="bar" style="width:${number(100*g.totalSeconds/queueMax)}%;background:var(--chart-2)"></div></div><span>${number(g.count)} × ${number(g.meanSeconds)}s = ${number(g.totalSeconds)}s</span></div>`).join('');
  return `<!doctype html><html><head><style>body{margin:0;font-family:var(--font-sans);color:var(--foreground)}p{font-size:13px;color:var(--muted-foreground)}.row{display:grid;grid-template-columns:140px 1fr 200px;gap:10px;align-items:center;margin:14px 0;font-size:12px}.track,.bar{height:16px;border-radius:4px}.track{background:var(--secondary)}.bar{background:var(--chart-1)}@media(max-width:500px){.row{grid-template-columns:100px 1fr}.row>span:last-child{grid-column:1/3}}</style></head><body><p>${escape(data.census.window.from)} → ${escape(data.census.window.to)}<br>${data.processGroups.length ? 'Recovered process spans' : 'Tool envelopes'}; cumulative across parallel sessions, not critical-path delay or proven waste. Counts × rounded means may differ slightly from displayed totals.</p>${rows}${queueRows ? '<p>CI allocation queue by requested runner (separate scale; overlaps process waits)</p>'+queueRows : '<p>CI queue coverage not supplied.</p>'}<p>Coverage is partial. Polling and hosted jobs overlap these measurements and must not be added.</p></body></html>`;
}
