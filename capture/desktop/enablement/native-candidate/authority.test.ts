import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticate, bindManifest, type Identity} from './authority.ts';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`producer-${name}.json`, import.meta.url), 'utf8'));
const run = fixture('run'), artifact = fixture('artifact'), job = fixture('job');
const identity: Identity = {repository: run.repository.full_name, run: String(run.id), attempt: '1', currentAttempt: '1',
  source: 'a'.repeat(40), tree: 'b'.repeat(40), head: run.head_sha, ref: 'refs/pull/1382/merge', event: run.event,
  workflow: 'checks.yml', artifact: String(artifact.id), digest: artifact.digest.slice(7)};
// Public API metadata from run 43920614168/job 133493289342. This historical
// producer failed native acceptance: it must remain rejected, despite packaging.
// Future-layout positive controls change ONLY its terminal/full-suite result and expiry;
// real restored/native proof remains a hosted CI requirement.
const successful = () => ({...structuredClone(job), conclusion: 'success', steps: job.steps.map((step: any) =>
  step.name === 'Execute the same changed-tree checks (not GUI acceptance)' ? {...step, conclusion: 'success'} : {...step})});
const liveArtifact = () => ({...structuredClone(artifact), expires_at: new Date(Date.now() + 60000).toISOString()});
const jobs = (value = successful()) => ({total_count: 1, jobs: [value]});
test('real failed producer metadata cannot become acceptance through a retained artifact', () => {
  assert.throws(() => authenticate(identity, run, run, liveArtifact(), jobs(job)));
  assert.ok(job.steps.some((s: any) => s.name === 'Build and package the exact Mac candidate for native checks' && s.conclusion === 'success'));
});
test('actual successful producer in a later-failed run qualifies cold and on a same-source retry', () => {
  // Run43958374569 produced and restored this candidate and passed all native
  // assertions before its later unrelated Connect contract timeout. These are
  // captured API fields, not a failed producer relabelled as successful.
  const actual = JSON.parse(readFileSync(new URL('successful-producer.json', import.meta.url), 'utf8'));
  const i: Identity = {...identity, run: String(actual.run.id), source: actual.source.commit, tree: actual.source.tree,
    head: actual.run.head_sha, ref: 'refs/pull/1388/merge', artifact: String(actual.artifact.id), digest: actual.artifact.digest.slice(7)};
  const inventory = {total_count: 1, jobs: [actual.job]};
  // Freeze identity bytes, not this historical artifact's two-day retention clock.
  const fresh = {...actual.artifact, expires_at: new Date(Date.now() + 60000).toISOString()};
  assert.equal(actual.run.conclusion, 'failure'); assert.equal(actual.job.conclusion, 'success');
  authenticate(i, actual.run, actual.run, fresh, inventory);
  // Only this current-run state is a projected second attempt. Actual hosted
  // carried dependency outputs remain unclaimed until a natural retry occurs.
  authenticate({...i, currentAttempt: '2'}, {...actual.run, run_attempt: 2, status: 'in_progress', conclusion: null}, actual.run, fresh, inventory);
});
test('missing, unsafe, stale, cancelled and changed authority fail closed', () => {
  for (const patch of [{repository: 'fork/apparent'}, {source: 'bad'}, {tree: ''}, {head: 'c'.repeat(40)},
    {ref: 'refs/heads/other'}, {workflow: 'untrusted.yml'}, {artifact: '9'}, {digest: 'd'.repeat(64)},
    {attempt: '2'}, {currentAttempt: '0'}, {event: 'workflow_run'}])
    assert.throws(() => authenticate({...identity, ...patch}, run, run, liveArtifact(), jobs()), JSON.stringify(patch));
  for (const patch of [{expired: true}, {expires_at: '2000-01-01'}, {digest: null}, {workflow_run: {id: 1}},
    {name: 'other'}, {size_in_bytes: 2 ** 31}])
    assert.throws(() => authenticate(identity, run, run, {...liveArtifact(), ...patch}, jobs()));
  for (const patch of [{status: undefined}, {status: 'unknown'}, {conclusion: undefined}, {conclusion: 'unknown'}, {conclusion: null}, {conclusion: 'cancelled'}, {repository: {full_name: 'other'}}, {head_repository: null},
    {path: '.github/workflows/other.yml'}, {head_sha: 'c'.repeat(40)}])
    assert.throws(() => authenticate(identity, {...run, ...patch}, run, liveArtifact(), jobs()));
  for (const conclusion of ['skipped', 'failure', 'cancelled', null]) {
    assert.throws(() => authenticate(identity, run, run, liveArtifact(), jobs({...successful(), conclusion})));
    for (const name of ['Build and package the exact Mac candidate for native checks',
      'Retain the installed Mac CI candidate for a separate native test run', 'Upload the pending native test candidate',
      'Execute the same changed-tree checks (not GUI acceptance)']) {
      const value = successful(); value.steps = value.steps.map((s: any) => s.name === name ? {...s, conclusion} : s);
      assert.throws(() => authenticate(identity, run, run, liveArtifact(), jobs(value)), name);
    }
  }
  for (const inventory of [{total_count: 2, jobs: [successful()]}, {total_count: 0, jobs: []}, {total_count: 2, jobs: [successful(), successful()]}])
    assert.throws(() => authenticate(identity, run, run, liveArtifact(), inventory));
});
test('authenticated archive manifest still requires exact source tree, repository, run and attempt', () => {
  const manifest = {source: {commit: identity.source, tree: identity.tree}, repository: identity.repository, run: {id: identity.run, attempt: identity.attempt}};
  bindManifest(manifest, identity);
  for (const patch of [{source: {...manifest.source, tree: 'c'.repeat(40)}}, {source: {...manifest.source, commit: 'c'.repeat(40)}},
    {repository: 'fork/apparent'}, {run: {...manifest.run, attempt: '2'}}, {run: {...manifest.run, id: '9'}}])
    assert.throws(() => bindManifest({...manifest, ...patch}, identity));
});
