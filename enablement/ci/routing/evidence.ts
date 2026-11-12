// Reuse is bounded to an authenticated Actions artifact from the merged PR and
// the identical complete Git tree. No commit-message or aggregate-green inference.
import {execFileSync} from 'node:child_process';
import {appendFileSync, readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parsePlan} from './run.ts';

type Plan = ReturnType<typeof parsePlan>;
type Result = {result: string};
type Needs = Record<string, Result>;
export type Evidence = {schema: number; tree: string; sha: string; head: string; run: string; attempt: string; plan: Plan; macPlan: Plan; results: Needs};
const keys = ['root', 'engine', 'desktop', 'client', 'foreground', 'browser', 'service', 'tools', 'hermes'] as const;
export function covers(recorded: Plan, required: Plan): boolean {
  return keys.every(key => typeof recorded?.[key] === 'boolean' && (!required[key] || recorded[key]));
}
export function reusable(evidence: Evidence, tree: string, head: string, run: string, attempt: string, plan: Plan, macPlan: Plan) {
  const valid = evidence.schema === 1 && evidence.tree === tree && evidence.head === head && evidence.run === run && evidence.attempt === attempt &&
    /^[a-f0-9]{40}$/.test(evidence.sha) && evidence.results?.contracts?.result === 'success';
  const passed = (name: string) => valid && evidence.results?.[name]?.result === 'success';
  return {linux: passed('linux') && covers(evidence.plan, plan), macos: passed('macos') && covers(evidence.macPlan, macPlan),
    portable: passed('portable') && covers(evidence.plan, plan), hermes: passed('hermes') && covers(evidence.plan, plan),
    hermes_macos: passed('hermes-macos') && covers(evidence.plan, plan)};
}
type Tree = {truncated?: boolean; tree: {path: string; mode: string; type: string; sha: string}[]};
export function trustedProducer(before: Tree, after: Tree): boolean {
  if (before.truncated || after.truncated || !Array.isArray(before.tree) || !Array.isArray(after.tree)) return false;
  // Bind workflow admission, producer/selector/runner code and package scripts.
  // Product source may change; verification definitions may not authenticate themselves.
  const policy = (path: string) => ['.github/', 'enablement/', '.githooks/'].some(prefix => path.startsWith(prefix)) ||
    /(^|\/)(package(?:-lock)?\.json|bun\.lock)$/.test(path);
  const entries = (tree: Tree) => tree.tree.filter(entry => policy(entry.path))
    .map(entry => JSON.stringify([entry.path, entry.mode, entry.type, entry.sha])).sort();
  return JSON.stringify(entries(before)) === JSON.stringify(entries(after)) && entries(before).length > 0;
}
export function authenticatedSuites(jobs: {name: string; status: string; conclusion: string | null}[], plan: Plan, macPlan: Plan) {
  const passed = new Set(jobs.filter(job => job.status === 'completed' && job.conclusion === 'success').map(job => job.name));
  const common = passed.has('contracts') && passed.has('select') && passed.has('tree-evidence');
  const platform = (name: string, runner: string, value: Plan) => common && passed.has(name+' / select') &&
    (!(value.root || value.engine) || passed.has(name+' / rust ('+runner+')')) &&
    (!value.desktop || passed.has(name+' / desktop-ui ('+runner+')')) &&
    (!value.client || passed.has(name+' / connect-client ('+runner+')'));
  return {linux: platform('linux','ubuntu-24.04',plan), macos: platform('macos','macos-15-intel',macPlan),
    portable: common && passed.has('portable'), hermes: common && passed.has('Hermes inspection (ubuntu-24.04)'),
    hermes_macos: common && passed.has('Hermes inspection (macos-15-intel)')};
}
export function accepted(needs: Needs, required: Record<string, boolean>, reuse: Record<string, boolean>): boolean {
  return needs.contracts?.result === 'success' && needs.select?.result === 'success' &&
    Object.entries(required).every(([name, needed]) => !needed || reuse[name] === true || needs[name]?.result === 'success');
}
const git = (ref: string) => execFileSync('git', ['rev-parse', ref], {encoding: 'utf8'}).trim();
export async function reuse() {
  const none = {linux: false, macos: false, portable: false, hermes: false, hermes_macos: false};
  if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/main') return none;
  const repo = process.env.GITHUB_REPOSITORY!, sha = process.env.GITHUB_SHA!;
  const api = async (path: string) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw Error(`GitHub evidence lookup: ${response.status}`);
    return response;
  };
  try {
    const mainCommit = await (await api('git/commits/'+sha)).json() as any;
    if (mainCommit.tree?.sha !== git('HEAD^{tree}') || !mainCommit.parents?.[0]?.sha) return none;
    const baseCommit = await (await api('git/commits/'+mainCommit.parents[0].sha)).json() as any;
    const before = await (await api('git/trees/'+baseCommit.tree.sha+'?recursive=1')).json() as Tree;
    const after = await (await api('git/trees/'+mainCommit.tree.sha+'?recursive=1')).json() as Tree;
    if (!trustedProducer(before,after)) {console.log('Verification definitions changed; fresh main suites required.');return none;}
    const prs = await (await api(`commits/${sha}/pulls?per_page=100`)).json() as any[];
    for (const pr of prs.filter(pr => pr.merged_at && pr.merge_commit_sha === sha && pr.base?.repo?.full_name === repo && pr.head?.repo?.full_name === repo)) {
      const runs = await (await api(`actions/workflows/checks.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=20`)).json() as any;
      for (const run of runs.workflow_runs ?? []) {
        if (run.path !== '.github/workflows/checks.yml' || run.event !== 'pull_request' || run.head_sha !== pr.head.sha ||
            run.head_repository?.full_name !== repo || run.repository?.full_name !== repo || run.status !== 'completed' ||
            !['success', 'failure'].includes(run.conclusion)) continue;
        const artifacts = await (await api(`actions/runs/${run.id}/artifacts?per_page=100`)).json() as any;
        const artifact = artifacts.artifacts?.find((item: any) => item.name === `ci-tree-evidence-${run.run_attempt}` && !item.expired);
        if (!artifact || artifact.size_in_bytes > 1024 * 1024) continue;
        const directory = mkdtempSync(join(tmpdir(), 'apparent-dev-ci-evidence-'));
        try {
          const archive = join(directory, 'evidence.zip');
          writeFileSync(archive, Buffer.from(await (await api(`actions/artifacts/${artifact.id}/zip`)).arrayBuffer()));
          const evidence = JSON.parse(execFileSync('unzip', ['-p', archive, 'verified-tree.json'], {encoding: 'utf8', maxBuffer: 1024 * 1024}));
          const result = reusable(evidence, git('HEAD^{tree}'), pr.head.sha, String(run.id), String(run.run_attempt),
            parsePlan(process.env.VERIFICATION_PLAN), parsePlan(process.env.MAC_VERIFICATION_PLAN));
          if (!Object.values(result).some(Boolean)) continue;
          const sourceCommit = await (await api('git/commits/'+evidence.sha)).json() as any;
          if (sourceCommit.tree?.sha !== evidence.tree) continue;
          const inventory = await (await api('actions/runs/'+run.id+'/attempts/'+run.run_attempt+'/jobs?per_page=100')).json() as any;
          if (!Array.isArray(inventory.jobs) || inventory.jobs.length < inventory.total_count) continue;
          const authentic = authenticatedSuites(inventory.jobs,evidence.plan,evidence.macPlan);
          for (const key of Object.keys(result) as (keyof typeof result)[]) result[key] = result[key] && authentic[key];
          if (Object.values(result).some(Boolean)) {
            console.log(`Reusing PR #${pr.number}, run ${run.id}, attempt ${run.run_attempt}, exact tree ${evidence.tree}`);
            return result;
          }
        } finally { rmSync(directory, {recursive: true, force: true}); }
      }
    }
  } catch (error) { console.log(`No reusable evidence; executing affected suites: ${String(error)}`); }
  return none;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--reuse')) {
    const result = await reuse();
    appendFileSync(process.env.GITHUB_OUTPUT!, Object.entries(result).map(([key,value]) => `${key}=${value}\n`).join(''));
  } else if (process.argv.includes('--write')) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
    const evidence: Evidence = {schema: 1, tree: git('HEAD^{tree}'), sha: git('HEAD'), head: event.pull_request.head.sha,
      run: process.env.GITHUB_RUN_ID!, attempt: process.env.GITHUB_RUN_ATTEMPT!,
      plan: parsePlan(process.env.VERIFICATION_PLAN), macPlan: parsePlan(process.env.MAC_VERIFICATION_PLAN), results: JSON.parse(process.env.CI_NEEDS!)};
    writeFileSync(join(process.env.RUNNER_TEMP!, 'verified-tree.json'), JSON.stringify(evidence));
  } else if (process.argv.includes('--admit')) {
    const plan = parsePlan(process.env.VERIFICATION_PLAN), macPlan = parsePlan(process.env.MAC_VERIFICATION_PLAN);
    const mac = process.env.VERIFY_PLATFORM === 'macos';
    const required = {linux: !mac && (plan.root || plan.engine || plan.desktop || plan.client),
      macos: mac && (macPlan.root || macPlan.engine || macPlan.desktop || macPlan.client),
      portable: plan.browser || plan.service || plan.tools || plan.foreground};
    const reuse = Object.fromEntries(Object.entries(JSON.parse(process.env.CI_REUSE || '{}')).map(([key,value]) => [key, value === 'true']));
    if (!accepted(JSON.parse(process.env.CI_NEEDS!), required, {...reuse, 'hermes-macos': reuse.hermes_macos})) process.exit(1);
  }
}
