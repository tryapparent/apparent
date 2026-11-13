// workflow_run uses trusted default-branch code; never consume PR code/artifacts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const workflows: Record<string, string> = {
  '.github/workflows/checks.yml': 'Capture',
  '.github/workflows/stream-connect.yml': 'Connect',
  '.github/workflows/stream-public.yml': 'Public',
  '.github/workflows/hermes.yml': 'Hermes',
  '.github/workflows/stream-engine.yml': 'Engine',
};
export type Run = {id: number; run_attempt: number; workflow_id: number; path: string; event: string;
  head_sha: string; status: string; conclusion: string | null;
  repository: {full_name: string}; head_repository: {full_name: string}};
type PR = {number: number; state: string; head: {sha: string; repo: {full_name: string} | null}; base: {ref: string; repo: {full_name: string}}};
type Comment = {body: string; user: {login: string; type: string}};
export type API = <T>(path: string, body?: {body: string}) => Promise<T>;
const unsuccessful = (run: Run) => run.status === 'completed' &&
  ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'].includes(run.conclusion ?? '');
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const known = (path: string) => Object.hasOwn(workflows, path);
const owned = (run: Run, repo: string, sha: string) => run.event === 'pull_request' && run.head_sha === sha &&
  run.repository?.full_name === repo && run.head_repository?.full_name === repo;

export async function notify(event: {action: string; workflow_run: Run}, repo: string, api: API): Promise<number> {
  const run = event.workflow_run;
  if (event.action !== 'completed' || run?.status !== 'completed' || !known(run.path) ||
      !owned(run, repo, run.head_sha) || !/^[a-f0-9]{40}$/.test(run.head_sha) ||
      ![run.id, run.run_attempt, run.workflow_id].every(positive)) return 0;
  const inventory = await api<{total_count: number; workflow_runs: Run[]}>(
    `actions/runs?event=pull_request&head_sha=${run.head_sha}&per_page=100`);
  assert.ok(Array.isArray(inventory.workflow_runs) && inventory.total_count <= inventory.workflow_runs.length,
    'Incomplete workflow inventory; no completion notification');
  const latest = new Map<number, Run>();
  for (const item of inventory.workflow_runs) {
    if (!owned(item, repo, run.head_sha) || !known(item.path)) continue;
    assert.ok([item.id, item.workflow_id, item.run_attempt].every(positive));
    const old = latest.get(item.workflow_id);
    if (!old || item.id > old.id || (item.id === old.id && item.run_attempt > old.run_attempt)) latest.set(item.workflow_id, item);
  }
  const current = latest.get(run.workflow_id);
  // Ignore old attempts and superseded runs, even when they still report failure.
  if (!current || current.id !== run.id || current.run_attempt !== run.run_attempt) return 0;
  // The completion event proves this attempt finished even if the list read lags.
  latest.set(run.workflow_id, run);
  if (![...latest.values()].some(unsuccessful)) return 0; // Green heads already wake through checks.
  const prs = await api<PR[]>(`commits/${run.head_sha}/pulls?per_page=100`);
  assert.ok(Array.isArray(prs) && prs.length < 100, 'Incomplete PR inventory');
  let sent = 0;
  for (const pr of prs) {
    if (!positive(pr.number) || pr.state !== 'open' || pr.head?.sha !== run.head_sha ||
        pr.head.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo || pr.base.ref !== 'main') continue;
    const marker = `<!-- apparent-ci-completion:${run.id}:${run.run_attempt} -->`;
    const comments: Comment[] = [];
    for (let page = 1; ; page++) {
      assert.ok(page <= 10, 'Incomplete comment inventory');
      const batch = await api<Comment[]>(`issues/${pr.number}/comments?per_page=100&page=${page}`);
      assert.ok(Array.isArray(batch)); comments.push(...batch);
      if (batch.length < 100) break;
    }
    if (comments.some(comment => comment.user?.login === 'github-actions[bot]' &&
        comment.user.type === 'Bot' && comment.body?.includes(marker))) continue;
    // Discard candidates already moved during the reads; the receipt always names its exact head.
    const fresh = await api<PR>(`pulls/${pr.number}`);
    if (fresh.state !== 'open' || fresh.head?.sha !== run.head_sha || fresh.head.repo?.full_name !== repo ||
        fresh.base?.repo?.full_name !== repo || fresh.base.ref !== 'main') continue;
    await api(`issues/${pr.number}/comments`, {body: `${marker}\n` +
      `${workflows[run.path]} workflow completed for \`${run.head_sha}\` ` +
      `([run ${run.id}, attempt ${run.run_attempt}](https://github.com/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt})).\n\n` +
      'This head has an unsuccessful workflow. Inspect the current checks and act on the results. ' +
      'Other workflows may still be running; each completion on an unsuccessful head produces this receipt. ' +
      'This is a completion notification, not test, merge or release admission.'});
    sent++;
  }
  return sent;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_run');
  const repo = process.env.GITHUB_REPOSITORY!;
  assert.match(repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.ok(process.env.GH_TOKEN);
  const api: API = async <T>(path: string, body?: {body: string}) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {}),
    });
    if (!response.ok) throw Error(`GitHub completion API failed (${response.status})`);
    return await response.json() as T;
  };
  console.log(`Completion receipts sent: ${await notify(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8')), repo, api)}`);
}
