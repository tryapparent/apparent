/** Read-only Codex rollout census. Tool intervals are not subprocess/CPU timings. */
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { createHash, randomBytes } from 'node:crypto'
import { resolve, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

type Row = { timestamp?: string; type?: string; payload?: Record<string, any> }
type Call = { id: string; session: string; workspace: string; tool: string; category: string;
  fingerprint: string; start: number; end?: number; asynchronous: boolean; batched: boolean;
  processObservedEnd?: number }
const salt = randomBytes(32)
const hash = (s: string) => createHash('sha256').update(salt).update(s).digest('hex').slice(0, 16)
const within = (path: string, root: string) => path === root || path.startsWith(root + sep)
export const acceptsWorkspace = (cwd: string, root: string, excluded?: string) => !!cwd &&
  within(resolve(cwd), resolve(root)) && (!excluded || !within(resolve(cwd), resolve(excluded)))

export function describe(tool: string, source: string) {
  // Heuristics describe wrapper intent, never assert how many nested commands ran.
  const category = /write_stdin|functions\.wait|clock\.sleep|t3_thread_wait/.test(tool + source) || tool === 'wait' ? 'poll/wait'
    : /git push|pre-push|verification\.py.*--run/.test(source) ? 'push/verification'
    : /cargo\s+(test|build|check|clippy)|t3-build/.test(source) ? 'rust/build'
    : /(?:bun|npm|node|pnpm)\s+(?:run\s+)?(?:test|build|ci)|--test/.test(source) ? 'js/test-build-install'
    : /gh\s+(?:run|pr)|pull_request/.test(source + tool) ? 'ci/pr'
    : /exec_command|execute|shell/.test(tool + source) ? 'shell/other' : 'other-tool'
  const normalized = source.replace(/\/tmp\/apparent-dev-[\w./-]+/g, '<job>')
    .replace(/\/home\/[^\s"'`]+\/worktrees\/scrawl\/t3-[\w-]+/g, '<worktree>')
  return { category, fingerprint: hash(tool + '\n' + normalized),
    batched: (source.match(/tools\.exec_command\s*\(/g) ?? []).length > 1 }
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(v => typeof v?.text === 'string' ? v.text : '').join('\n')
  return ''
}

export async function readRollout(path: string, accept: (workspace: string) => boolean) {
  const calls = new Map<string, Call>()
  const processes = new Map<string, Call>()
  const pollTargets = new Map<string, string>()
  let session = '', workspace = '', malformed = 0, orphanResults = 0
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of lines) {
    let row: Row
    try { row = JSON.parse(line) } catch { malformed++; continue }
    const p = row.payload ?? {}
    if (row.type === 'session_meta') {
      session = String(p.id ?? p.session_id ?? '')
      workspace = String(p.cwd ?? '')
      if (!accept(workspace)) { lines.close(); break }
    }
    if (!session || row.type !== 'response_item') continue
    const time = Date.parse(row.timestamp ?? '')
    if (!Number.isFinite(time)) continue
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      if (typeof p.call_id !== 'string' || calls.has(p.call_id)) continue
      const tool = [p.namespace, p.name].filter(Boolean).join('.')
      const source = String(p.arguments ?? p.input ?? '')
      const poll = /write_stdin/.test(tool + source) && source.match(/session_id["\s]*:\s*(\d+)/)
      if (poll) pollTargets.set(p.call_id, poll[1])
      calls.set(p.call_id, { id: p.call_id, session, workspace, tool, start: time,
        ...describe(tool, source), asynchronous: false })
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const call = calls.get(p.call_id)
      if (!call) { orphanResults++; continue }
      if (call.end !== undefined) continue
      // A returned session/cell means this interval ends before the underlying work.
      const output = outputText(p.output)
      call.asynchronous = /session_id["\s]*[:=]\s*\d+|Session ID:|Script running with cell ID|Process running with session ID/.test(output)
      if (time >= call.start) call.end = time
      const processId = output.match(/session_id["\s]*[:=]\s*(\d+)|Process running with session ID\s*(\d+)/)
      if (processId && call.category !== 'poll/wait' && !call.batched)
        processes.set(processId[1] ?? processId[2], call)
      const target = pollTargets.get(p.call_id)
      const launched = target && processes.get(target)
      if (launched && /exit_code["\s]*:\s*\d+|Process exited with code\s*\d+/.test(output))
        launched.processObservedEnd = time
    }
  }
  return { calls: [...calls.values()], malformed, orphanResults }
}

export function summarize(calls: Call[], from: number, to: number) {
  const unique = [...new Map(calls.map(c => [c.session + ':' + c.id, c])).values()]
  // Old unmatched records do not establish a still-running operation in this window.
  const selected = unique.filter(c => c.start < to && (c.end ?? to) > from &&
    (c.end !== undefined || c.start >= from))
  function group(key: (c: Call) => string) {
    const groups = new Map<string, Call[]>()
    for (const c of selected) groups.set(key(c), [...(groups.get(key(c)) ?? []), c])
    return [...groups].map(([label, rows]) => {
      const complete = rows.filter(c => c.end !== undefined)
      const ms = (c: Call) => Math.max(0, Math.min(c.end ?? to, to) - Math.max(c.start, from))
      const short = complete.filter(c => !c.asynchronous && c.end! - c.start < 300_000)
      return { label, calls: rows.length, sessions: new Set(rows.map(c => c.session)).size,
        completed: complete.length, incomplete: rows.length - complete.length,
        asynchronous: rows.filter(c => c.asynchronous).length, batched: rows.filter(c => c.batched).length,
        activeAtCutoff: rows.filter(c => c.end === undefined || c.end > to).length,
        completedToolSeconds: Math.round(complete.reduce((n, c) => n + ms(c), 0) / 1000),
        shortCompletedCalls: short.length,
        shortToolSeconds: Math.round(short.reduce((n, c) => n + ms(c), 0) / 1000),
        incompleteObservedSeconds: Math.round(rows.filter(c => c.end === undefined).reduce((n, c) => n + ms(c), 0) / 1000) }
    }).sort((a, b) => b.completedToolSeconds - a.completedToolSeconds || b.calls - a.calls)
  }
  const intervals = selected.map(c => [Math.max(from, c.start), Math.min(to, c.end ?? to)])
    .sort((a, b) => a[0] - b[0])
  let union = 0, end = from
  for (const [a, b] of intervals) { union += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b) }
  return { window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    observedSessions: new Set(selected.map(c => c.session)).size, calls: selected.length,
    unmatchedBeforeWindow: unique.filter(c => c.end === undefined && c.start < from).length,
    observedToolUnionSeconds: Math.round(union / 1000),
    categories: group(c => c.category), tools: group(c => c.tool),
    repeatedWrappers: group(c => c.category + ':' + c.fingerprint).filter(g => g.calls > 1),
    correlatedProcesses: unique.filter(c => c.processObservedEnd !== undefined && c.start < to && c.processObservedEnd > from).map(c => ({
      category: c.category, fingerprint: c.fingerprint,
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

async function* files(path: string): AsyncGenerator<string> {
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
