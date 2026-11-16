// Same-run dependency outputs select an immutable artifact, never a search hit.
import assert from 'node:assert/strict';
export type Identity = {repository: string; run: string; attempt: string; currentAttempt: string;
  source: string; tree: string; head: string; ref: string; event: string; workflow: string; artifact: string; digest: string};
export function authenticate(identity: Identity, run: any, attempt: any, artifact: any, jobs: any) {
  const i = identity;
  assert.equal(i.repository, 'tryapparent/apparent');
  for (const value of [i.run, i.attempt, i.currentAttempt, i.artifact]) assert.match(value, /^[1-9]\d*$/);
  assert.ok(Number(i.attempt) <= Number(i.currentAttempt));
  assert.match(i.source, /^[a-f0-9]{40}$/); assert.match(i.tree, /^[a-f0-9]{40}$/);
  assert.match(i.digest, /^[a-f0-9]{64}$/);
  assert.ok(['checks.yml', 'verification.yml', 'stream-connect.yml'].includes(i.workflow));
  for (const value of [run, attempt]) {
    assert.equal(String(value.id), i.run);
    assert.equal(value.repository?.full_name, i.repository);
    assert.equal(value.head_repository?.full_name, i.repository);
    assert.equal(value.path, '.github/workflows/' + i.workflow);
    assert.equal(value.head_sha, i.head);
    assert.equal(value.event, i.event);
    assert.ok(['push', 'pull_request', 'workflow_dispatch'].includes(value.event));
    assert.ok(!['cancelled', 'timed_out', 'action_required', 'stale'].includes(value.conclusion));
  }
  assert.equal(String(run.run_attempt), i.currentAttempt);
  assert.equal(String(attempt.run_attempt), i.attempt);
  assert.ok(i.ref === 'refs/heads/' + run.head_branch ||
    (i.event === 'pull_request' && /^refs\/pull\/\d+\/merge$/.test(i.ref)));
  assert.equal(String(artifact.id), i.artifact);
  assert.equal(artifact.name, `apparent-native-candidate-${i.run}-${i.attempt}`);
  assert.equal(artifact.expired, false);
  assert.ok(Date.parse(artifact.expires_at) > Date.now());
  assert.equal(artifact.workflow_run?.id, Number(i.run));
  assert.equal(artifact.workflow_run?.head_sha, i.head);
  assert.equal(artifact.digest, 'sha256:' + i.digest);
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes < 2 ** 31);
  assert.ok(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length, 'Incomplete producer job inventory');
  const producers = jobs.jobs.filter((job: any) => /(?:^| \/ )(?:platform|rust) \(macos-15-intel\)$/.test(job.name) &&
    job.steps?.some((step: any) => step.name === 'Upload the pending native test candidate' && step.conclusion === 'success'));
  assert.equal(producers.length, 1, 'Expected one successful candidate producer');
  const producer = producers[0];
  assert.deepEqual(producer.labels, ['macos-15-intel']);
  assert.equal(producer.status, 'completed'); assert.equal(producer.conclusion, 'success');
  assert.equal(String(producer.run_attempt), i.attempt); assert.equal(producer.head_sha, i.head);
  for (const name of ['Build and package the exact Mac candidate for native checks',
    'Retain the installed Mac CI candidate for a separate native test run',
    'Execute the same changed-tree checks (not GUI acceptance)'])
    assert.equal(producer.steps.filter((step: any) => step.name === name && step.conclusion === 'success').length, 1, name);
}
export function bindManifest(manifest: any, i: Identity) {
  assert.deepEqual(manifest.source, {commit: i.source, tree: i.tree});
  assert.equal(manifest.repository, i.repository);
  assert.deepEqual(manifest.run, {id: i.run, attempt: i.attempt});
}
