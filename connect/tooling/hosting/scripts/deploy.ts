import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { accountId, workerName, deploymentConfig, validateProfile, sameBindings, singleVersion } from './profile.ts'
import type { Settings } from './profile.ts'
import { digest, verifySeal } from './seal.ts'

const root = resolve(import.meta.dirname, '..'), repo = resolve(root, '../../..')
const artifact = resolve(root, '.output'), sha = process.argv[2]
const receipt = await verifySeal(artifact, sha)
assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, accountId, 'Unexpected Cloudflare account')
const token = process.env.CLOUDFLARE_API_TOKEN
assert.ok(token, 'Deployment credential is required')
const worker = '/accounts/' + accountId + '/workers/scripts/' + workerName

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
    ...options, headers: { Authorization: 'Bearer ' + token, ...options.headers }, signal: AbortSignal.timeout(30000),
  })
  const body = await response.json() as any
  assert.ok(response.ok && body.success, 'Cloudflare read/write failed: HTTP ' + response.status + ', codes ' + JSON.stringify(body.errors?.map((error: any) => error.code)))
  return body.result
}
async function snapshot() {
  const [settings, deployments, versions, schedules, subdomain, domains] = await Promise.all([
    api(worker + '/settings'), api(worker + '/deployments'), api(worker + '/versions?per_page=2'),
    api(worker + '/schedules'), api(worker + '/subdomain'), api('/accounts/' + accountId + '/workers/domains'),
  ])
  return { settings: settings as Settings, deployment: deployments.deployments[0], versions: versions.items, schedules, subdomain, domains }
}
function preserve(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) {
  sameBindings(before.settings.bindings, after.settings.bindings)
  for (const key of ['compatibility_date', 'compatibility_flags', 'logpush', 'tail_consumers', 'observability', 'limits', 'placement', 'usage_model'] as const) {
    assert.deepEqual(after.settings[key], before.settings[key], 'Provider setting changed: ' + key)
  }
  for (const key of ['schedules', 'subdomain', 'domains'] as const) assert.deepEqual(after[key], before[key], 'Provider configuration changed: ' + key)
}
function admission() {
  const fetch = spawnSync('git', ['fetch', 'origin', 'main'], { cwd: repo, encoding: 'utf8', timeout: 30000 })
  assert.equal(fetch.status, 0, 'Cannot refresh current main')
  const gate = spawnSync(process.execPath, ['--experimental-strip-types', 'enablement/ci/routing/streams.ts', 'connect', sha], { cwd: repo, encoding: 'utf8', timeout: 30000 })
  assert.equal(gate.status, 0, 'Candidate superseded by affected main changes')
}

admission()
const before = await snapshot(), previous = singleVersion(before.deployment)
validateProfile(before.settings)
assert.equal(before.versions[0].id, previous, 'A separate version is already staged')
const baselineVersion = await api(worker + '/versions/' + previous)
const outputRoot = process.env.RUNNER_TEMP || process.env.TMPDIR
assert.ok(outputRoot, 'A private job temporary directory is required')
const configPath = resolve(outputRoot, 'connect-production.json')
const receiptPath = resolve(repo, 'connect-service-receipt.json')
const record = (phase: string, extra: Record<string, unknown> = {}) => writeFile(receiptPath,
  JSON.stringify({ sha, worker: workerName, previousVersion: previous, phase, ...extra }) + '\n')
await record('preflight')
await writeFile(configPath, JSON.stringify(deploymentConfig(before.settings, artifact)), { mode: 0o600 })
// Upload a version first. This command cannot apply migrations, initialize the
// ledger, activate traffic, change routes/cron or upgrade a subscription.
const upload = spawnSync(resolve(root, 'node_modules/.bin/wrangler'), [
  'versions', 'upload', '--config', configPath, '--no-bundle', '--keep-vars', '--strict',
  '--tag', sha, '--message', 'Automatic Connect delivery after passing tests: ' + sha,
], { cwd: root, encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' } })
// Wrangler can print runtime variables; keep its output out of CI/artifacts.
assert.equal(upload.status, 0, 'Worker version upload failed; traffic was not changed')
const staged = await snapshot(), candidate = staged.versions[0].id
assert.equal(singleVersion(staged.deployment), previous, 'Active deployment changed while staging')
preserve(before, staged)
const version = await api(worker + '/versions/' + candidate)
assert.notEqual(candidate, previous)
assert.equal(version.annotations?.['workers/tag'], sha, 'Wrong staged candidate')
sameBindings(baselineVersion.resources.bindings, version.resources.bindings)
assert.deepEqual(version.resources.script_runtime, baselineVersion.resources.script_runtime, 'Version runtime configuration changed')
await record('staged', { version: candidate })
await verifySeal(artifact, sha)
admission()
const fresh = await snapshot()
preserve(before, fresh)
assert.equal(singleVersion(fresh.deployment), previous, 'Another deploy owns traffic')
assert.equal(fresh.versions[0].id, candidate, 'Another owner staged a version')
const deployed = await api(worker + '/deployments', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    strategy: 'percentage', versions: [{ version_id: candidate, percentage: 100 }],
    annotations: { 'workers/message': 'Automatic tested main ' + sha + '; previous version ' + previous },
  }),
})
await record('active-unverified', { version: candidate, deployment: deployed.id })
const after = await snapshot()
assert.equal(singleVersion(after.deployment), candidate, 'Exact candidate is not active')
preserve(before, after)
for (const file of receipt.files.filter(file => file.path.startsWith('dist/'))) {
  const path = '/' + file.path.slice('dist/'.length).replace(/\/index\.html$/, '')
  const response = await fetch('https://app.tryapparent.com' + path, { redirect: 'manual', headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200, 'Published asset status: ' + path)
  assert.equal(digest(new Uint8Array(await response.arrayBuffer())), file.sha256, 'Published asset differs: ' + path)
  assert.equal(response.headers.get('X-Apparent-Publisher'), 'connect-worker')
}
for (const url of ['https://app.tryapparent.com/connect/v1/session', 'https://hosted.tryapparent.com/v1/session']) {
  const response = await fetch(url, { headers: { Origin: 'https://app.tryapparent.com' }, signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200)
  assert.equal((await response.json() as any).authenticated, false)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://app.tryapparent.com')
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true')
}
const result = { sha, worker: workerName, deployment: deployed.id, version: candidate, previousVersion: previous, phase: 'verified', assets: receipt.files.filter(file => file.path.startsWith('dist/')).length, configurationPreserved: true }
await writeFile(receiptPath, JSON.stringify(result) + '\n')
console.log(JSON.stringify(result))
