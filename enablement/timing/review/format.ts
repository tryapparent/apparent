// Artifact presentation only, not an application surface or an automated diagnosis.
const number = (n: number) => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw Error('Invalid measured number');
  return n.toFixed(3).replace(/\.?0+$/, '') || '0';
};
const escape = (s: unknown) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function markdown(data: any): string {
  const lines = [`# Enablement timing`, '', `${data.census.window.from} → ${data.census.window.to}`, '',
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
  const groups = data.processGroups.length ? data.processGroups : data.census.categories.map((g: any) => ({label: g.label, ...g.arithmetic}));
  const max = Math.max(1, ...groups.map((g: any) => g.totalSeconds));
  const rows = groups.slice(0, 8).map((g: any) => `<div class="row"><span>${escape(g.label)}</span><div class="track"><div class="bar" style="width:${number(100 * g.totalSeconds / max)}%"></div></div><span>${number(g.count)} × ${number(g.meanSeconds)}s = ${number(g.totalSeconds)}s</span></div>`).join('');
  return `<!doctype html><html><head><style>body{margin:0;font-family:var(--font-sans);color:var(--foreground)}p{font-size:13px;color:var(--muted-foreground)}.row{display:grid;grid-template-columns:140px 1fr 200px;gap:10px;align-items:center;margin:14px 0;font-size:12px}.track,.bar{height:16px;border-radius:4px}.track{background:var(--secondary)}.bar{background:var(--chart-1)}@media(max-width:500px){.row{grid-template-columns:100px 1fr}.row>span:last-child{grid-column:1/3}}</style></head><body><p>${escape(data.census.window.from)} → ${escape(data.census.window.to)}<br>${data.processGroups.length ? 'Recovered process spans' : 'Tool envelopes'}; cumulative across parallel sessions, not critical-path delay or proven waste. Counts × rounded means may differ slightly from displayed totals.</p>${rows}<p>Coverage is partial. Polling and hosted jobs overlap these measurements and must not be added.</p></body></html>`;
}
