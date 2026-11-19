// Offline review tooling; T3 owns snapshots, dispatch and scheduling transport.
import {readFileSync, statSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acceptsWorkspace, files, readRollout, summarize} from '../census.ts';
import type {Call} from '../census.ts';
import {inspectThreads, inspectJobs} from './snapshots.ts';
import {isoTime} from './policy.ts';
import * as ledger from './state.ts';
import {markdown, chart} from './format.ts';
import {collectGitHub, type ReadGitHub} from './github.ts';

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const save = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
const fail = (message: string): never => {throw Error(message);};
export async function main(args: string[], readGitHub?: ReadGitHub) {
  const command = args[0];
  const options = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || args[i + 1] === undefined || options.has(args[i])) fail('Expected unique --name value options');
    options.set(args[i], args[i + 1]);
  }
  const allowed: Record<string, string[]> = {
    collect: ['input', 'workspace', 'exclude-workspace', 'from', 'to', 'out', 'threads', 'jobs', 'github-repo', 'ci-run-limit', 'ci-exact-attempt'],
    init: ['state', 'scope', 'since'], begin: ['state', 'run-id', 'end'], commit: ['state', 'run-id', 'decision'],
    abort: ['state', 'run-id'], plan: ['state'], prepare: ['state', 'key'], record: ['state', 'request-id', 'receipt'],
    delivered: ['state', 'request-id', 'receipt'], benefit: ['state', 'key', 'receipt'], show: ['state'], format: ['input', 'out'], chart: ['input', 'out'],
  };
  if (!allowed[command]) fail('Commands: collect, init, begin, commit, abort, plan, prepare, record, delivered, benefit, show, format, chart. See review/README.md.');
  for (const key of options.keys()) if (!allowed[command].includes(key.slice(2))) fail(`Unknown option ${key}`);
  const get = (key: string) => options.get('--' + key) ?? fail(`Missing --${key}`);
  if (command === 'collect') {
    const from = isoTime(get('from')), to = isoTime(get('to'));
    if (from >= to) fail('Invalid review window');
    if (options.has('--jobs') && options.has('--github-repo')) fail('Use --jobs or --github-repo, not both');
    if (options.has('--ci-run-limit') && !options.has('--github-repo')) fail('--ci-run-limit requires --github-repo');
    if (options.has('--ci-exact-attempt') && !options.has('--github-repo')) fail('--ci-exact-attempt requires --github-repo');
    const calls: Call[] = []; let scanned = 0, malformed = 0, orphanResults = 0;
    const root = resolve(get('workspace')), exclude = options.get('--exclude-workspace');
    for await (const file of files(resolve(get('input')))) {
      if (statSync(file).mtimeMs < from) continue;
      const r = await readRollout(file, cwd => acceptsWorkspace(cwd, root, exclude));
      scanned++; malformed += r.malformed; orphanResults += r.orphanResults; calls.push(...r.calls);
    }
    const census = summarize(calls, from, to);
    const grouped = new Map<string, number[]>();
    for (const p of census.correlatedProcesses) grouped.set(p.category, [...(grouped.get(p.category) ?? []), p.observedSpanSeconds]);
    const processGroups = [...grouped].map(([label, durations]) => {
      durations.sort((a, b) => a - b); const totalSeconds = durations.reduce((a, b) => a + b, 0);
      return {label, count: durations.length, meanSeconds: totalSeconds / durations.length, totalSeconds,
        p50Seconds: durations[Math.floor((durations.length - 1) * .5)], p95Seconds: durations[Math.floor((durations.length - 1) * .95)]};
    }).sort((a, b) => b.totalSeconds - a.totalSeconds);
    const threads = options.has('--threads') ? inspectThreads(json(get('threads')), from, to) : null;
    const github = options.has('--github-repo') ? collectGitHub(get('github-repo'),get('from'),get('to'),
      Number(options.get('--ci-run-limit') ?? 12),readGitHub,options.get('--ci-exact-attempt')) : null;
    const jobs = options.has('--jobs') ? inspectJobs(json(get('jobs')), from, to) : github ? {...inspectJobs(github.runs,from,to),collection:github.coverage} : null;
    const result = {schema: 1, census, processGroups, threads, jobs, coverage: {scanned, malformed, orphanResults,
      threadsProvided: threads !== null, hostedJobsProvided: jobs !== null},
      requiredLenses: ['human-dependency', 'time-eater', 'confusion-maintainability', 'feedback-gap'],
      warning: 'Rank measured totals; count × mean = total. Tool envelopes, recovered process spans and hosted jobs overlap: never add them. Human/code/stale-wait verdicts require original evidence, not keyword matches.'};
    save(get('out'), result); return {written: get('out'), coverage: result.coverage};
  }
  if (command === 'format' || command === 'chart') {
    const data = json(get('input'));
    writeFileSync(get('out'), command === 'format' ? markdown(data) : chart(data), {mode: 0o600, flag: 'wx'});
    return {written: get('out')};
  }
  const state = get('state');
  if (command === 'init') return ledger.initialize(state, get('scope'), get('since'));
  if (command === 'begin') return ledger.begin(state, get('run-id'), get('end'));
  if (command === 'commit') return ledger.commit(state, get('run-id'), json(get('decision')));
  if (command === 'abort') return ledger.abort(state, get('run-id'));
  if (command === 'show') return ledger.readState(state);
  if (command === 'plan') return ledger.plan(state);
  if (command === 'prepare') return ledger.prepare(state, get('key'));
  if (command === 'record') return ledger.recordDispatch(state, get('request-id'), json(get('receipt')));
  if (command === 'benefit') return ledger.benefit(state, get('key'), json(get('receipt')));
  return ledger.delivered(state, get('request-id'), json(get('receipt')));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).then(value => console.log(JSON.stringify(value))).catch(error => {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  });
