import assert from 'node:assert/strict'
import test from 'node:test'
import { executionSeconds, enforceBudget, loadJobs, auditName, type Job } from './workflow-budget.ts'
import { readFileSync, readdirSync } from 'node:fs'

const job = (start: number, end: number, name = 'work'): Job => ({ name, status: 'completed', conclusion: 'success', started_at: new Date(start * 1000).toISOString(), completed_at: new Date(end * 1000).toISOString() })

test('union counts parallel execution once and excludes queue gaps', () => {
  assert.equal(executionSeconds([job(0, 100), job(30, 80), job(90, 200), job(500, 650)]), 350)
})
test('sequential reusable jobs share one workflow budget', () => {
  assert.throws(() => enforceBudget([job(0, 350), job(400, 700)]), /agent whose run exceeded the limit owns optimization/)
  assert.doesNotThrow(() => enforceBudget([job(0, 600)]))
  assert.equal(executionSeconds([job(0, 350, 'verify / rust'), job(400, 700, 'publish')]), 650)
  assert.equal(executionSeconds([job(0, 600)]), 600)
})
test('skip placeholders and audits do not consume the workload budget', () => {
  assert.equal(executionSeconds([{ ...job(10, 0), conclusion: 'skipped' },
    { ...job(0, 999), name: `runtime-budget / ${auditName}`, status: 'in_progress' },
    job(0, 20)]), 20)
})
test('failed and cancelled execution still counts; uncertain timestamps fail closed', () => {
  assert.equal(executionSeconds([{ ...job(0, 30), conclusion: 'failure' }, { ...job(30, 60), conclusion: 'cancelled' }]), 60)
  for (const entry of [{ ...job(0, 10), status: 'queued' }, { ...job(0, 10), started_at: null }, job(20, 10)])
    assert.throws(() => executionSeconds([entry]))
})
test('read all pages from exact run attempt, without redirecting credentials', async () => {
  const urls: string[] = []
  const request = async (url: string | URL | Request, options?: RequestInit) => {
    urls.push(String(url))
    assert.equal(options?.redirect, 'error')
    return new Response(JSON.stringify({ total_count: 2, jobs: [job(urls.length * 10, urls.length * 10 + 5)] }))
  }
  const jobs = await loadJobs('https://api.github.com', 'owner/repo', '42', '3', 'synthetic-token', request as typeof fetch)
  assert.equal(jobs.length, 2)
  assert.match(urls[0], /runs\/42\/attempts\/3\/jobs\?per_page=100&page=1$/)
  assert.match(urls[1], /page=2$/)
})
test('API denial and incomplete inventories cannot pass', async () => {
  for (const response of [new Response('', { status: 403 }), new Response(JSON.stringify({total_count: 1, jobs: []})), new Response('{}'), new Response(JSON.stringify({total_count: 0, jobs: []})), new Response(JSON.stringify({total_count: 1, jobs: [job(0, 1), job(1, 2)]}))])
    await assert.rejects(loadJobs('https://api.github.com', 'owner/repo', '42', '1', 'token', (async () => response) as typeof fetch))
})
test('every supported root workflow waits for all payload jobs before auditing', () => {
  const folder = new URL('../../.github/workflows/', import.meta.url)
  for (const name of readdirSync(folder)) {
    const text = readFileSync(new URL(name, folder), 'utf8')
    if (name === 'release-windows.yml' || name === 'runtime-budget.yml') continue
    // Only root workflows: callable platform verification is covered by caller.
    if (!/^  (push|workflow_dispatch|workflow_run|schedule):/m.test(text)) continue
    const jobs = [...text.split('jobs:\n')[1].matchAll(/^  ([\w-]+):$/gm)].map(m => m[1])
    assert.ok(jobs.includes('runtime-budget'), name)
    const gate = text.split('  runtime-budget:\n')[1]
    assert.match(gate, /    if: always\(\)/)
    assert.ok(gate.includes(`needs: [${jobs.filter(j => j !== 'runtime-budget').join(', ')}]`), name)
    assert.match(gate, /actions: read/)
    assert.match(gate, /uses: .\/.github\/workflows\/runtime-budget.yml/)
  }
})

// Parallel preparation cannot admit an artifact from an unfinished producer.
import { waitForSettingsProducer } from './focused/settings-producer.ts'
const settingsContext = { repository: 'tryapparent/apparent', run: '42', attempt: '3', token: 'synthetic', event: 'workflow_dispatch', job: 'settings-native' }
const settingsJob = (status = 'completed', conclusion: string | null = 'success') => ({ name: 'settings-build', run_id: 42, run_attempt: 3, status, conclusion })
const settingsArtifact = () => ({ id: 123, name: 'mac-dev-executables-42-3', expired: false, workflow_run: { id: 42 } })
function settingsAPI(bodies: unknown[]) {
  const urls: string[] = []
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url)); assert.equal(init?.redirect, 'error')
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic')
    assert.ok(bodies.length, 'Unexpected extra metadata request')
    return new Response(JSON.stringify(bodies.shift()), { headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { urls, request }
}
test('Settings preparation waits for final producer success before discovering its immutable artifact', async () => {
  let clock = 0
  const api = settingsAPI([{ total_count: 1, jobs: [settingsJob('in_progress', null)] },
    { total_count: 1, jobs: [settingsJob()] }, { total_count: 1, artifacts: [settingsArtifact()] }])
  assert.equal(await waitForSettingsProducer(settingsContext, { request: api.request, now: () => clock, pause: async ms => { clock += ms } }), '123')
  assert.equal(clock, 5000)
  assert.ok(api.urls[0].includes('/runs/42/attempts/3/jobs?'))
  assert.ok(api.urls[1].includes('/runs/42/attempts/3/jobs?'))
  assert.ok(api.urls[2].includes('/runs/42/artifacts?name=mac-dev-executables-42-3&'))
})
test('Settings cancelled or failed producers refuse an earlier uploaded artifact', async () => {
  for (const conclusion of ['cancelled', 'failure', 'skipped']) {
    const api = settingsAPI([{ total_count: 1, jobs: [settingsJob('completed', conclusion)] }])
    await assert.rejects(waitForSettingsProducer(settingsContext, { request: api.request }), /did not succeed/)
    assert.equal(api.urls.length, 1)
  }
})
test('Settings discovery rejects incomplete, duplicate and foreign-attempt job inventories', async () => {
  for (const body of [{ total_count: 2, jobs: [settingsJob()] },
    { total_count: 2, jobs: [settingsJob(), settingsJob()] },
    { total_count: 1, jobs: [{ ...settingsJob(), run_attempt: 2 }] },
    { total_count: 1, jobs: [{ ...settingsJob(), run_id: 41 }] }]) {
    const api = settingsAPI([body]); await assert.rejects(waitForSettingsProducer(settingsContext, { request: api.request }))
    assert.equal(api.urls.length, 1)
  }
})
test('Settings artifact discovery refuses duplicate, expired, foreign or nonnumeric IDs', async () => {
  for (const body of [{ total_count: 2, artifacts: [settingsArtifact(), settingsArtifact()] },
    ...[{ expired: true }, { id: '123\nINJECT=true' }, { name: 'other' }, { workflow_run: { id: 41 } }]
      .map(change => ({ total_count: 1, artifacts: [{ ...settingsArtifact(), ...change }] }))]) {
    const api = settingsAPI([{ total_count: 1, jobs: [settingsJob()] }, body])
    await assert.rejects(waitForSettingsProducer(settingsContext, { request: api.request }))
  }
})
test('Settings readiness is bounded and never installs or admits while producer is absent', async () => {
  let clock = 0; const api = settingsAPI([{ total_count: 0, jobs: [] }, { total_count: 0, jobs: [] }])
  await assert.rejects(waitForSettingsProducer(settingsContext, { request: api.request, timeout: 5001,
    now: () => clock, pause: async ms => { clock += ms } }), /timed out/)
  assert.equal(api.urls.length, 2); assert.equal(clock, 5001)
})
test('Settings readiness refuses unexpected invocation and metadata transport failures', async () => {
  for (const change of [{ repository: 'foreign/repo' }, { event: 'push' }, { job: 'other' }, { attempt: 'x' }, { token: '' }]) {
    const api = settingsAPI([])
    await assert.rejects(waitForSettingsProducer({ ...settingsContext, ...change }, { request: api.request }))
    assert.equal(api.urls.length, 0)
  }
  await assert.rejects(waitForSettingsProducer(settingsContext, { request: (async () => new Response('', { status: 403 })) as typeof fetch }), /Cannot read/)
})
test('Settings readiness refuses a final artifact body delivered after its deadline', async () => {
  let clock = 0, count = 0
  const request = (async () => {
    count++
    if (count === 1) return new Response(JSON.stringify({ total_count: 1, jobs: [settingsJob()] }))
    return { ok: true, json: async () => { clock = 501; return { total_count: 1, artifacts: [settingsArtifact()] } } } as Response
  }) as typeof fetch
  await assert.rejects(waitForSettingsProducer(settingsContext, { request, now: () => clock, timeout: 500 }), /timed out/)
  assert.equal(count, 2)
})
