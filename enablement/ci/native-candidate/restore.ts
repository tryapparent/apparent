import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {download, unpack} from './archive.ts';
import {authenticate, bindManifest, type Identity} from './authority.ts';
import {installRetainedArchive, sourceSnapshot} from '../../../capture/desktop/scripts/packaging/native-candidate.ts';
assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'x64');
assert.equal(execFileSync('uname', ['-m'], {encoding: 'utf8'}).trim(), 'x86_64');
assert.equal(execFileSync('sysctl', ['-in', 'hw.optional.arm64'], {encoding: 'utf8'}).trim() || '0', '0');
assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
const env = process.env, source = sourceSnapshot(process.cwd(), env.GITHUB_SHA!);
const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH!, 'utf8'));
const identity: Identity = {repository: env.GITHUB_REPOSITORY!, run: env.GITHUB_RUN_ID!,
  attempt: env.CANDIDATE_ATTEMPT!, currentAttempt: env.GITHUB_RUN_ATTEMPT!, tree: source.tree, source: source.commit,
  head: event.pull_request?.head?.sha ?? env.GITHUB_SHA!, ref: env.GITHUB_REF!, event: env.GITHUB_EVENT_NAME!,
  workflow: env.GITHUB_WORKFLOW_REF!.split('/.github/workflows/')[1].split('@')[0], artifact: env.CANDIDATE_ID!, digest: env.CANDIDATE_DIGEST!};
for (const value of [identity.run, identity.attempt, identity.currentAttempt, identity.artifact]) assert.match(value, /^[1-9]\d*$/);
const api = async (path: string) => {
  const response = await fetch(`https://api.github.com/repos/${identity.repository}/${path}`, {
    headers: {Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(120000)});
  assert.ok(response.ok, `Candidate lookup failed: ${response.status}`); return response;
};
const start = performance.now();
const temporary = mkdtempSync(join(env.RUNNER_TEMP!, 'native-acquisition-'));
try {
  const run = await (await api(`actions/runs/${identity.run}`)).json();
  const attempt = await (await api(`actions/runs/${identity.run}/attempts/${identity.attempt}`)).json();
  const artifact: any = await (await api(`actions/artifacts/${identity.artifact}`)).json();
  const jobs = await (await api(`actions/runs/${identity.run}/attempts/${identity.attempt}/jobs?per_page=100`)).json();
  authenticate(identity, run, attempt, artifact, jobs);
  const outer = join(temporary, 'artifact.zip');
  await download(await api(`actions/artifacts/${identity.artifact}/zip`), outer, {sha256: identity.digest, bytes: artifact.size_in_bytes});
  const {archive, manifestPath, manifest} = unpack(outer, temporary);
  bindManifest(manifest, identity);
  const destination = join(env.HOME!, 'Applications', `Apparent-Storage-${identity.run}-${identity.currentAttempt}.app`);
  await installRetainedArchive({archive, manifestPath, expectedSource: identity.source,
    expectedArchiveSha256: manifest.artifact.sha256, destination, temporary});
  assert.deepEqual(sourceSnapshot(process.cwd(), identity.source), source);
  appendFileSync(env.GITHUB_ENV!, `APPARENT_TIMING_FILE=${join(env.RUNNER_TEMP!, 'native-acceptance-timings.jsonl')}\n`);
} finally {
  rmSync(temporary, {recursive: true, force: true});
  appendFileSync(join(env.RUNNER_TEMP!, 'native-acceptance-timings.jsonl'), JSON.stringify({phase: 'candidate-acquisition', durationMs: performance.now() - start, producerAttempt: identity.attempt, consumerAttempt: identity.currentAttempt}) + '\n');
}
