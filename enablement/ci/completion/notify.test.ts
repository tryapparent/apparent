import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notify, type API, type Run} from './notify.ts';

const repo = 'test/repository', sha = 'a'.repeat(40);
const run = (overrides: Partial<Run> = {}): Run => ({id: 10, workflow_id: 1, run_attempt: 1,
  path: '.github/workflows/checks.yml', event: 'pull_request', head_sha: sha,
  status: 'completed', conclusion: 'failure', repository: {full_name: repo},
  head_repository: {full_name: repo}, ...overrides});
const pr = () => ({number: 42, state: 'open', head: {sha, repo: {full_name: repo}}, base: {ref: 'main', repo: {full_name: repo}}});
function fixture(runs: Run[] = [run()]) {
  const state = {runs, comments: [] as {body: string; user: {login: string; type: string}}[], prs: [pr()], fresh: pr(), calls: [] as string[]};
  const api: API = async <T>(path: string, body?: {body: string}) => {
    state.calls.push(path);
    if (body) {state.comments.push({...body, user: {login: 'github-actions[bot]', type: 'Bot'}}); return {} as T;}
    if (path.startsWith('actions/runs?')) return {total_count: state.runs.length, workflow_runs: state.runs} as T;
    if (path.startsWith('commits/')) return state.prs as T;
    if (path.startsWith('pulls/')) return state.fresh as T;
    if (path.includes('/comments?')) return state.comments as T;
    throw Error('Unexpected API path');
  };
  return {state, api};
}

test('an early failure and later successful completions each wake through existing comments', async () => {
  const early = run(), slow = run({id: 11, workflow_id: 2, path: '.github/workflows/stream-connect.yml', status: 'in_progress', conclusion: null});
  const f = fixture([early, slow]);
  assert.equal(await notify({action: 'completed', workflow_run: early}, repo, f.api), 1);
  const final = {...slow, status: 'completed', conclusion: 'success'};
  f.state.runs = [early, final];
  assert.equal(await notify({action: 'completed', workflow_run: final}, repo, f.api), 1);
  assert.match(f.state.comments[1]!.body, /Connect workflow completed/);
  assert.match(f.state.comments[1]!.body, /Other workflows may still be running/);
  assert.match(f.state.comments[1]!.body, /not test, merge or release admission/);
  assert.equal(await notify({action: 'completed', workflow_run: final}, repo, f.api), 0);
  assert.equal(f.state.comments.length, 2);
});

test('green heads stay quiet and fresh failed reruns get one receipt', async () => {
  const green = run({conclusion: 'success'}), f = fixture([green]);
  assert.equal(await notify({action: 'completed', workflow_run: green}, repo, f.api), 0);
  for (const attempt of [1, 2]) {
    const failed = run({run_attempt: attempt}); f.state.runs = [failed];
    assert.equal(await notify({action: 'completed', workflow_run: failed}, repo, f.api), 1);
    assert.equal(await notify({action: 'completed', workflow_run: failed}, repo, f.api), 0);
  }
});

test('superseded runs/attempts and stale head/closed/foreign PRs cannot receive a receipt', async () => {
  for (const replacement of [run({id: 20}), run({run_attempt: 2})]) {
    const f = fixture([run(), replacement]);
    assert.equal(await notify({action: 'completed', workflow_run: run()}, repo, f.api), 0);
    assert.equal(f.state.comments.length, 0);
  }
  for (const mutate of [
    (p: ReturnType<typeof pr>) => {p.head.sha = 'b'.repeat(40);},
    (p: ReturnType<typeof pr>) => {p.state = 'closed';},
    (p: ReturnType<typeof pr>) => {p.head.repo.full_name = 'other/repo';},
    (p: ReturnType<typeof pr>) => {p.base.ref = 'other';},
  ]) {
    const f = fixture(); mutate(f.state.prs[0]!);
    assert.equal(await notify({action: 'completed', workflow_run: run()}, repo, f.api), 0);
    assert.equal(f.state.comments.length, 0);
    const moved = fixture(); mutate(moved.state.fresh);
    assert.equal(await notify({action: 'completed', workflow_run: run()}, repo, moved.api), 0);
    assert.equal(moved.state.comments.length, 0);
  }
});

test('pushes, forks, unknown workflows and malformed event IDs cause no API calls', async () => {
  for (const value of [run({event: 'push'}), run({head_repository: {full_name: 'other/repo'}}),
    run({path: 'constructor'}), run({id: -1}), run({head_sha: 'invalid'}), run({status: 'in_progress'})]) {
    const f = fixture();
    assert.equal(await notify({action: 'completed', workflow_run: value}, repo, f.api), 0);
    assert.deepEqual(f.state.calls, []);
  }
});

test('event completion survives a lagging list read; cancellation is still unsuccessful', async () => {
  const f = fixture([run({status: 'in_progress', conclusion: null})]);
  assert.equal(await notify({action: 'completed', workflow_run: run({conclusion: 'cancelled'})}, repo, f.api), 1);
});

test('API errors and incomplete inventories fail without writing comments', async () => {
  const f = fixture();
  const api: API = async <T>(path: string, body?: {body: string}) => path.startsWith('actions/')
    ? {total_count: 101, workflow_runs: [run()]} as T : f.api(path, body);
  await assert.rejects(notify({action: 'completed', workflow_run: run()}, repo, api), /Incomplete/);
  assert.equal(f.state.comments.length, 0);
  await assert.rejects(notify({action: 'completed', workflow_run: run()}, repo, async () => {throw Error('403');}), /403/);
});

test('a user-forged marker cannot suppress a bot receipt', async () => {
  const f = fixture();
  f.state.comments.push({body: '<!-- apparent-ci-completion:10:1 -->', user: {login: 'someone', type: 'User'}});
  assert.equal(await notify({action: 'completed', workflow_run: run()}, repo, f.api), 1);
});
