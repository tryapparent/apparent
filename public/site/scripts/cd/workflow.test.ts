import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, symlinkSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {YAML} from 'bun'
import {streamPaths} from '../../../../enablement/ci/routing/streams.ts'
import {selectRange} from '../../../../enablement/ci/select.ts'

const root = new URL('../../../../', import.meta.url)
const workflow = YAML.parse(readFileSync(new URL('.github/workflows/stream-public.yml', root), 'utf8'))
const jobs = workflow.jobs
type Context = {event?: string; ref?: string; repository?: string; gate?: string; result?: string; selected?: string; cancelled?: boolean}
function context(overrides: Context = {}) {
  const {event = 'push', ref = 'refs/heads/main', repository = 'tryapparent/apparent',
    gate = 'true', result = 'success', selected = 'true', cancelled = false} = overrides
  return {github: {event_name: event, ref, repository, event: {pull_request: event === 'pull_request' ? {number: 7} : {}}},
    needs: {select: {result, outputs: {public: selected}}, verify: {result}}, vars: {WEBSITE_CD_ENABLED: gate}, cancelled}
}
function admitted(job: any, overrides: Context = {}) {
  const {github, needs, vars, cancelled} = context(overrides)
  const expression = job.if || 'true'
  // Preserve Actions' implicit dependency success for conditions without a
  // status function; a passed event guard alone cannot authorize a failed build.
  if (!/\b(?:always|cancelled|success|failure)\s*\(/.test(expression) &&
    [job.needs].flat().some(name => name && needs[name as keyof typeof needs].result !== 'success')) return false
  return Function('github', 'needs', 'vars', 'cancelled', `return (${expression})`)(github, needs, vars, () => cancelled)
}
function group(overrides: Context) {
  const {github} = context(overrides)
  return workflow.concurrency.group.replace(/\$\{\{(.*?)\}\}/g,
    (_: string, expression: string) => Function('github', `return (${expression})`)(github))
}

test('Public owns direct main/PR/dispatch entrypoints and full-delta selection', () => {
  assert.deepEqual(Object.keys(workflow.on), ['pull_request', 'push', 'workflow_dispatch'])
  for (const event of ['push', 'pull_request']) {
    assert.deepEqual(workflow.on[event].branches, ['main'])
    assert.deepEqual(workflow.on[event].paths, streamPaths.public, 'automatic entry follows directory ownership')
    assert.equal(workflow.on[event]['paths-ignore'], undefined)
  }
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'reopened', 'synchronize', 'ready_for_review', 'converted_to_draft'])
  assert.equal(workflow.permissions.contents, 'read')
  const checkout = jobs.select.steps.find((s: any) => s.uses === 'actions/checkout@v4')
  assert.equal(checkout.with['fetch-depth'], 0)
  assert.equal(checkout.with.ref, undefined, 'PRs verify GitHub’s proposed merge')
  const select = jobs.select.steps.find((s: any) => s.id === 'paths')
  assert.equal(select.env.BASE_SHA, '${{ github.event.pull_request.base.sha || github.event.before }}')
  assert.equal(select.run, 'node --experimental-strip-types enablement/ci/select.ts')
  assert.equal(jobs.select.outputs.public, '${{ steps.paths.outputs.public }}')
  assert.equal(jobs.verify.needs, 'select')
  assert(jobs.verify.steps.some((s: any) => s.run === 'npm run verify'))
  assert.equal(jobs.deploy.needs, 'verify')
  assert(!Object.values(jobs).some((job: any) => job.uses?.includes('checks.yml')))
})

test('only explicit irrelevant PR selection skips Public; failed/unknown routing runs checks', () => {
  assert.equal(admitted(jobs.verify, {event: 'pull_request', selected: 'false'}), false)
  for (const result of ['failure', 'skipped', 'cancelled', 'unknown'])
    assert.equal(admitted(jobs.verify, {event: 'pull_request', result, selected: 'false'}), true, result)
  for (const selected of ['true', '', 'unknown', undefined])
    assert.equal(admitted(jobs.verify, {event: 'pull_request', selected}), true, String(selected))
  for (const event of ['push', 'workflow_dispatch'])
    assert.equal(admitted(jobs.verify, {event, selected: 'false'}), true, 'main carries unfinished Public changes')
  assert.equal(admitted(jobs.verify, {cancelled: true}), false)
})

test('automatic/manual publication requires canonical main, enabled gate and successful same-run verification', () => {
  assert.equal(jobs.deploy.environment.name, 'website-production')
  for (const event of ['push', 'workflow_dispatch']) {
    assert.equal(admitted(jobs.deploy, {event}), true)
    for (const ref of ['refs/pull/7/merge', 'refs/heads/feature', 'refs/tags/v1'])
      assert.equal(admitted(jobs.deploy, {event, ref}), false)
    assert.equal(admitted(jobs.deploy, {event, repository: 'fork/apparent'}), false)
    for (const gate of ['', 'false', 'TRUE']) assert.equal(admitted(jobs.deploy, {event, gate}), false)
    for (const result of ['failure', 'skipped', 'cancelled', 'unknown'])
      assert.equal(admitted(jobs.deploy, {event, result}), false, result)
  }
  for (const event of ['pull_request', 'pull_request_target', 'workflow_call', 'workflow_run', 'schedule'])
    assert.equal(admitted(jobs.deploy, {event}), false, event)
  const upload = jobs.verify.steps.find((s: any) => s.uses === 'actions/upload-artifact@v4')
  const download = jobs.deploy.steps.find((s: any) => s.uses === 'actions/download-artifact@v4')
  assert.equal(upload.with.name, 'public-${{ github.sha }}')
  assert.equal(download.with.name, upload.with.name)
  assert.equal(download.with['run-id'], undefined, 'never download another run’s artifact')
  assert.equal(download.with.path, '.build/website')
  const publish = jobs.deploy.steps.find((s: any) => s.run === 'node public/site/scripts/cd/publish-pages.ts')
  assert.equal(publish.env.WEBSITE_PAGES_API_TOKEN, '${{ secrets.WEBSITE_PAGES_API_TOKEN }}')
  assert(!jobs.verify.steps.some((s: any) => s.env?.WEBSITE_PAGES_API_TOKEN))
})

test('automatic main and manual deployment share a lock; PR cancellation cannot interrupt publication', () => {
  assert.equal(group({event: 'push'}), group({event: 'workflow_dispatch'}))
  assert.notEqual(group({event: 'pull_request'}), group({event: 'push'}))
  for (const event of ['push', 'workflow_dispatch', 'pull_request']) {
    const expression = workflow.concurrency['cancel-in-progress'].slice(3, -2)
    assert.equal(Function('github', `return (${expression})`)(context({event}).github), event === 'pull_request')
  }
})

test('Public selection covers shared/mixed/unknown, full history, additions, deletions and both rename sides', () => {
  const directory = mkdtempSync(join(tmpdir(), 'public-workflow-'))
  const previous = process.cwd()
  const git = (...args: string[]) => execFileSync('git', args, {cwd: directory, encoding: 'utf8'}).trim()
  const put = (path: string, text: string) => {mkdirSync(dirname(join(directory, path)), {recursive: true}); writeFileSync(join(directory, path), text)}
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid')
    put('public/site/src/page.tsx', 'before'); put('capture/desktop/native/Settings.swift', 'before')
    put('shared/ui/src/tokens.css', 'before'); put('unknown-config.json', '{}')
    git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD')
    process.chdir(directory)
    const select = () => selectRange(base, git('rev-parse', 'HEAD')).public
    const commit = () => {git('add', '-A'); git('commit', '-qm', 'candidate')}
    const reset = () => git('reset', '--hard', base)
    put('public/site/src/page.tsx', 'updated'); commit(); assert.equal(select(), true)
    put('capture/desktop/native/Settings.swift', 'later unrelated'); commit(); assert.equal(select(), true, 'full PR delta, not only latest commit')
    reset(); put('capture/desktop/native/Settings.swift', 'native'); commit(); assert.equal(select(), false)
    reset(); put('shared/ui/src/tokens.css', 'shared'); commit(); assert.equal(select(), true)
    reset(); put('unknown-config.json', '{"changed":true}'); commit(); assert.equal(select(), true)
    reset(); put('public/site/src/new.tsx', 'added'); commit(); assert.equal(select(), true)
    reset(); git('rm', 'public/site/src/page.tsx'); commit(); assert.equal(select(), true)
    reset(); git('mv', 'public/site/src/page.tsx', 'outside.tsx'); commit(); assert.equal(select(), true)
    reset(); git('mv', 'unknown-config.json', 'public/site/src/from-outside.json'); commit(); assert.equal(select(), true)
    reset(); chmodSync(join(directory, 'public/site/src/page.tsx'), 0o755); commit(); assert.equal(select(), true)
    reset(); rmSync(join(directory, 'public/site/src/page.tsx')); symlinkSync('missing', join(directory, 'public/site/src/page.tsx')); commit(); assert.equal(select(), true)
    assert.equal(selectRange('invalid', git('rev-parse', 'HEAD')).public, true)
    assert.equal(selectRange(base, base).public, true, 'empty/unavailable proof stays conservative')
  } finally {process.chdir(previous); rmSync(directory, {recursive: true, force: true})}
})
