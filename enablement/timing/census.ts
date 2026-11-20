/** Read-only Codex rollout census. Tool intervals are not subprocess/CPU timings. */
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { createHash, randomBytes } from 'node:crypto'
import { resolve, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {operations, operationFamily, unresolvedOperation} from './operations.ts'
import {YieldedPolls} from './yielded-polls/index.ts'

type Row = { timestamp?: string; type?: string; payload?: Record<string, any> }
export type Call = { id: string; session: string; workspace: string; tool: string; category: string;
  operations?: string[];
  waitedOperations?: string[];
  fingerprint: string; start: number; end?: number; asynchronous: boolean; batched: boolean;
  processObservedEnd?: number; sourceRef?: {file: string; line: number} }
const salt = randomBytes(32)
const hash = (s: string) => createHash('sha256').update(salt).update(s).digest('hex').slice(0, 16)
const within = (path: string, root: string) => path === root || path.startsWith(root + sep)
export const acceptsWorkspace = (cwd: string, root: string, excluded?: string) => !!cwd &&
  within(resolve(cwd), resolve(root)) && (!excluded || !within(resolve(cwd), resolve(excluded)))

export function describe(tool: string, source: string) {
  const inspected = operations(tool, source);
  const aliases: Record<string,string> = {'process wait':'poll/wait','verification/push':'push/verification',
    'Rust build/test':'rust/build','JavaScript/package build/test':'js/test-build-install'};
  const category = inspected.operations.length === 1 ? aliases[inspected.operations[0]] ?? inspected.operations[0] : 'mixed operations';
  const normalized = source.replace(/\/tmp\/apparent-dev-[\w./-]+/g, '<job>')
    .replace(/\/home\/[^\s"'`]+\/worktrees\/scrawl\/t3-[\w-]+/g, '<worktree>')
  return { category, ...inspected, fingerprint: hash(tool + '\n' + normalized) }
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(v => typeof v?.text === 'string' ? v.text : '').join('\n')
  return ''
}

export async function readRollout(path: string, accept: (workspace: string) => boolean) {
  const calls = new Map<string, Call>()
  const processes = new Map<string, Call>()
  const cells = new Map<string, Call>()
  const pollTargets = new Map<string, string>()
  const yieldedPolls = new YieldedPolls()
  let session = '', workspace = '', malformed = 0, orphanResults = 0, lineNumber = 0
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of lines) {
    lineNumber++
    let row: Row
    try { row = JSON.parse(line) } catch { yieldedPolls.invalidateStored(); malformed++; continue }
    if (!row || typeof row !== 'object' || (row.payload != null && (typeof row.payload !== 'object' || Array.isArray(row.payload)))) {
      yieldedPolls.invalidateStored()
      malformed++; continue
    }
    const p = row.payload ?? {}
    if (row.type === 'session_meta') {
      yieldedPolls.invalidateStored()
      session = String(p.id ?? p.session_id ?? '')
      workspace = String(p.cwd ?? '')
      if (!accept(workspace)) { lines.close(); break }
    }
    if (!session || row.type !== 'response_item') continue
    const original = p.internal_chat_message_metadata_passthrough?.create_time
    const time = typeof original === 'number' && Number.isFinite(original) ? original * 1000 : Date.parse(row.timestamp ?? '')
    if (!Number.isFinite(time)) { yieldedPolls.invalidateStored(); continue }
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      if (typeof p.call_id !== 'string' || calls.has(p.call_id)) { yieldedPolls.invalidateStored(); continue }
      const tool = [p.namespace, p.name].filter(Boolean).join('.')
      const source = String(p.arguments ?? p.input ?? '')
      const inspected = describe(tool,source);
      const poll = inspected.operations.includes('process wait') && /write_stdin/.test(tool + source) && source.match(/session_id["\s]*:\s*(\d+)/)
      if (poll) pollTargets.set(p.call_id, poll[1])
      const cell = /(?:^|\.)wait$/.test(tool) && source.match(/cell_id["\s]*:\s*"([\w:.-]+)"/);
      const owner = poll ? processes.get(poll[1]) : cell ? cells.get(cell[1]) : undefined;
      const waitedOperations = owner?.waitedOperations ?? owner?.operations;
      const call = { id: p.call_id, session, workspace, tool, start: time,
        ...inspected, ...(waitedOperations ? {waitedOperations} : {}), asynchronous: false, sourceRef: {file: path, line: lineNumber} }
      calls.set(call.id, call)
      yieldedPolls.start(call, source, p.type, processes)
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const call = calls.get(p.call_id)
      if (!call) { yieldedPolls.invalidateStored(); orphanResults++; continue }
      if (call.end !== undefined) { yieldedPolls.invalidateStored(); continue }
      // A returned session/cell means this interval ends before the underlying work.
      const output = outputText(p.output)
      call.asynchronous = /session_id["\s]*[:=]\s*\d+|Session ID:|Script running with cell ID|Process running with session ID/.test(output)
      if (time >= call.start) call.end = time
      const processId = output.match(/session_id["\s]*[:=]\s*(\d+)|Process running with session ID\s*(\d+)/)
      if (processId && !call.operations?.includes('process wait') && call.category !== 'poll/wait' && !call.batched) {
        const sessionId = processId[1] ?? processId[2]
        yieldedPolls.launch(call, sessionId, p.output, processes.get(sessionId))
        processes.set(sessionId, call)
      }
      const cellId = output.match(/Script running with cell ID\s+([\w:.-]+)/);
      yieldedPolls.finish(call, p.type, p.output, cellId?.[1], !!cellId && cells.has(cellId[1]))
      if (cellId) cells.set(cellId[1],call);
      const target = pollTargets.get(p.call_id)
      const launched = target && processes.get(target)
      if (launched && /exit_code["\s]*:\s*-?\d+|Process exited with code\s*-?\d+/.test(output))
        launched.processObservedEnd ??= time
    }
  }
  return { calls: [...calls.values()], malformed, orphanResults }
}

export function summarize(calls: Call[], from: number, to: number) {
  // Provider rollovers can copy stable call IDs into different history files.
  const merged = new Map<string, Call>()
  for (const call of calls) {
    const old = merged.get(call.id)
    if (!old) { merged.set(call.id, {...call}); continue }
    const earliest = old.start <= call.start ? old : call
    const ends = [old.end, call.end].filter((t): t is number => t !== undefined && t >= earliest.start)
    const processEnds = [old.processObservedEnd, call.processObservedEnd].filter((t): t is number => t !== undefined && t >= earliest.start)
    merged.set(call.id, {...earliest, end: ends.length ? Math.min(...ends) : undefined,
      processObservedEnd: processEnds.length ? Math.min(...processEnds) : undefined,
      waitedOperations: earliest.waitedOperations ?? old.waitedOperations ?? call.waitedOperations,
      asynchronous: old.asynchronous || call.asynchronous, batched: old.batched || call.batched})
  }
  const unique = [...merged.values()]
  // Old unmatched records do not establish a still-running operation in this window.
  const selected = unique.filter(c => c.start < to && (c.end ?? to) > from &&
    (c.end !== undefined || c.start >= from))
  const attributableWait = (c:Call) => c.operations?.includes('process wait') && c.waitedOperations &&
    !c.waitedOperations.some(unresolvedOperation) && operationFamily(c.waitedOperations).length === 1;
  const operationLabel = (c: Call) => attributableWait(c) ? 'waiting/status for '+operationFamily(c.waitedOperations!).join(' + ') : c.operations ? operationFamily(c.operations).join(' + ') : c.category;
  const unresolved = (c: Call) => !attributableWait(c) && (!c.operations || operationFamily(c.operations).length !== 1 || operationFamily(c.operations).some(unresolvedOperation));
  const rank = (rows: Call[], process: boolean) => {
    const groups = new Map<string,Call[]>();
    for (const c of rows) {const label = operationLabel(c); groups.set(label,[...(groups.get(label) ?? []),c]);}
    const duration = (c: Call) => Math.max(0,Math.min((process ? c.processObservedEnd : c.end) ?? to,to)-Math.max(c.start,from))/1000;
    const ranked = [...groups].map(([label,rows]) => {
      const totalSeconds = rows.reduce((n,c)=>n+duration(c),0);
      return {label, unresolved:rows.some(unresolved), count:rows.length, meanSeconds:totalSeconds/rows.length,totalSeconds,
        sources:rows.slice().sort((a,b)=>duration(b)-duration(a)).slice(0,3).map(c=>({id:c.id,sourceRef:c.sourceRef}))};
    }).sort((a,b)=>b.totalSeconds-a.totalSeconds);
    const candidate = ranked.find(g=>!g.unresolved) ?? null;
    const unresolvedSeconds = ranked.filter(g=>g.unresolved).reduce((n,g)=>n+g.totalSeconds,0);
    const unclassifiedRows = rows.filter(c=>!c.operations || c.operations.some(v=>v==='unknown' || v.includes('purpose unresolved')));
    return {clock:process ? 'observed-process-span' : 'tool-envelope',ranked,largestObserved:ranked[0] ?? null,candidate,unresolvedSeconds,
      coverage:{completeRows:rows.length,unclassifiedRows:unclassifiedRows.length,unclassifiedSeconds:unclassifiedRows.reduce((n,c)=>n+duration(c),0)},
      winnerEstablished:!!candidate && candidate.totalSeconds > unresolvedSeconds,
      limitation:'Mixed envelopes are not divided across nested operations. Unresolved time is an upper bound on a competing action; waits do not identify their underlying workload. Process endpoints include delayed observation. Clocks overlap; do not add.'};
  };
  function group(key: (c: Call) => string) {
    const groups = new Map<string, Call[]>()
    for (const c of selected) groups.set(key(c), [...(groups.get(key(c)) ?? []), c])
    return [...groups].map(([label, rows]) => {
      const complete = rows.filter(c => c.end !== undefined)
      const ms = (c: Call) => Math.max(0, Math.min(c.end ?? to, to) - Math.max(c.start, from))
      const short = complete.filter(c => !c.asynchronous && c.end! - c.start < 300_000)
      const totalSeconds = complete.reduce((n, c) => n + ms(c), 0) / 1000
      return { label, calls: rows.length, sessions: new Set(rows.map(c => c.session)).size,
        completed: complete.length, incomplete: rows.length - complete.length,
        asynchronous: rows.filter(c => c.asynchronous).length, batched: rows.filter(c => c.batched).length,
        activeAtCutoff: rows.filter(c => c.end === undefined || c.end > to).length,
        completedToolSeconds: Math.round(complete.reduce((n, c) => n + ms(c), 0) / 1000),
        arithmetic: {count: complete.length, meanSeconds: complete.length ? totalSeconds / complete.length : 0, totalSeconds},
        shortCompletedCalls: short.length,
        shortToolSeconds: Math.round(short.reduce((n, c) => n + ms(c), 0) / 1000),
        incompleteObservedSeconds: Math.round(rows.filter(c => c.end === undefined).reduce((n, c) => n + ms(c), 0) / 1000) }
    }).sort((a, b) => b.arithmetic.totalSeconds - a.arithmetic.totalSeconds || b.calls - a.calls)
  }
  const intervals = selected.map(c => [Math.max(from, c.start), Math.min(to, c.end ?? to)])
    .sort((a, b) => a[0] - b[0])
  let union = 0, end = from
  for (const [a, b] of intervals) { union += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b) }
  return { window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    observedSessions: new Set(selected.map(c => c.session)).size, calls: selected.length,
    unmatchedBeforeWindow: unique.filter(c => c.end === undefined && c.start < from).length,
    observedToolUnionSeconds: union / 1000,
    categories: group(c => c.category), tools: group(c => c.tool),
    actionRanking: {
      envelopes:rank(selected.filter(c=>c.end !== undefined),false),
      processes:rank(unique.filter(c=>c.processObservedEnd !== undefined && c.start < to && c.processObservedEnd > from),true)},
    repeatedWrappers: group(c => c.category + ':' + c.fingerprint).filter(g => g.calls > 1),
    longest: selected.filter(c => c.end !== undefined).sort((a, b) => (b.end! - b.start) - (a.end! - a.start)).slice(0, 30)
      .map(c => ({id: c.id, tool: c.tool, category: c.category, sourceRef: c.sourceRef,
        seconds: (Math.min(c.end!, to) - Math.max(c.start, from)) / 1000})),
    correlatedProcesses: unique.filter(c => c.processObservedEnd !== undefined && c.start < to && c.processObservedEnd > from).map(c => ({
      category: c.category, fingerprint: c.fingerprint, sourceRef: c.sourceRef,
      observedSpanSeconds: Math.round((Math.min(to, c.processObservedEnd!) - Math.max(from, c.start)) / 1000) })),
    limitations: ['Codex rollouts only; other providers and hosted jobs are not included.',
      'Elapsed tool-call intervals include tool/service overhead and polling; not CPU time or subprocess runtime.',
      'Concurrent intervals sum as tool-seconds; union is wall-clock coverage, not critical-path delay.',
      'Categories and normalized wrapper fingerprints are heuristics, not proof of redundant verification.',
      'Nested tools are counted once per wrapper; batches and asynchronous launches are flagged.',
      'Correlated process spans end at terminal poll delivery: upper bounds including time between polls, not exact process runtime.',
      'Run admission/queue time is unavailable in these logs; it is not estimated.',
      'Missing results are censored at the cutoff; active-at-cutoff calls may complete later.'] }
}

export async function* files(path: string): AsyncGenerator<string> {
  if (!(await stat(path)).isDirectory()) { yield path; return }
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) yield* files(child)
    else if (entry.name.endsWith('.jsonl')) yield child
  }
}

export async function main(args: string[]) {
  const value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1] }
  const from = Date.parse(value('--from') ?? ''), to = Date.parse(value('--to') ?? '')
  const input = value('--input'), workspace = value('--workspace-prefix'), exclude = value('--exclude-workspace')
  if (!input || !workspace || !Number.isFinite(from) || !Number.isFinite(to) || from >= to)
    throw new Error('Usage: census.ts --input <rollout file/directory> --workspace-prefix <root> --from <ISO> --to <ISO> [--exclude-workspace <path>]')
  const calls: Call[] = []
  let scannedFiles = 0, malformedLines = 0, orphanResults = 0
  for await (const file of files(resolve(input))) {
    const result = await readRollout(file, cwd => acceptsWorkspace(cwd, workspace, exclude))
    calls.push(...result.calls); scannedFiles++; malformedLines += result.malformed; orphanResults += result.orphanResults
  }
  console.log(JSON.stringify({ schema: 1, scannedFiles, malformedLines, orphanResults,
    ...summarize(calls, from, to) }, null, 2))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
