/** Readiness only. The unchanged installer consumer remains the admission authority. */
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Context = { repository: string; run: string; attempt: string; token: string; event: string; job: string }
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
export async function waitForSettingsProducer(context: Context, options: {
  request?: typeof fetch; now?: () => number; pause?: (ms: number) => Promise<void>; timeout?: number
} = {}): Promise<string> {
  check(context.repository === 'tryapparent/apparent' && context.event === 'workflow_dispatch' &&
    context.job === 'settings-native' && /^\d+$/.test(context.run) && /^\d+$/.test(context.attempt) && context.token,
    'Missing focused Settings run identity')
  const request = options.request ?? fetch, now = options.now ?? Date.now
  const pause = options.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const deadline = now() + (options.timeout ?? 420_000)
  const read = async (path: string) => {
    check(now() < deadline, 'Focused Settings producer readiness timed out')
    const response = await request(`https://api.github.com/repos/tryapparent/apparent/${path}`, {
      headers: { Authorization: `Bearer ${context.token}`, Accept: 'application/vnd.github+json' },
      redirect: 'error', signal: AbortSignal.timeout(Math.min(10_000, deadline - now())),
    })
    check(response.ok, 'Cannot read focused Settings producer metadata')
    const body = await response.json()
    check(now() < deadline, 'Focused Settings producer readiness timed out')
    return body
  }
  const name = `mac-dev-executables-${context.run}-${context.attempt}`
  while (now() < deadline) {
    const inventory = await read(`actions/runs/${context.run}/attempts/${context.attempt}/jobs?per_page=100`)
    check(Array.isArray(inventory.jobs) && inventory.jobs.length === inventory.total_count && inventory.total_count <= 100,
      'Incomplete focused Settings job inventory')
    const jobs = inventory.jobs.filter((job: any) => job.name === 'settings-build')
    check(jobs.length <= 1, 'Ambiguous focused Settings producer')
    if (jobs.length) {
      const job = jobs[0]
      check(String(job.run_id) === context.run && String(job.run_attempt) === context.attempt &&
        ['queued', 'in_progress', 'completed'].includes(job.status), 'Wrong focused Settings producer attempt')
      if (job.status === 'completed') {
        check(job.conclusion === 'success', 'Focused Settings producer did not succeed')
        const found = await read(`actions/runs/${context.run}/artifacts?name=${name}&per_page=100`)
        check(Array.isArray(found.artifacts) && found.artifacts.length === found.total_count && found.total_count <= 1,
          'Ambiguous focused Settings artifact')
        if (found.artifacts.length) {
          const artifact = found.artifacts[0]
          check(artifact.name === name && artifact.expired === false && Number.isSafeInteger(artifact.id) && artifact.id > 0 &&
            String(artifact.workflow_run?.id) === context.run, 'Wrong focused Settings artifact')
          return String(artifact.id)
        }
      }
    }
    await pause(Math.min(5000, Math.max(0, deadline - now())))
  }
  throw new Error('Focused Settings producer readiness timed out')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env
  if (!env.GITHUB_ENV) throw new Error('Missing Actions environment destination')
  waitForSettingsProducer({ repository: env.GITHUB_REPOSITORY!, run: env.GITHUB_RUN_ID!, attempt: env.GITHUB_RUN_ATTEMPT!,
    token: env.GH_TOKEN!, event: env.GITHUB_EVENT_NAME!, job: env.GITHUB_JOB! })
    .then(id => appendFileSync(env.GITHUB_ENV!, `APPARENT_PREBUILT_ARTIFACT=${id}\n`))
    .catch(() => { console.error('::error::Focused Settings producer readiness failed; installation was not admitted'); process.exitCode = 1 })
}
