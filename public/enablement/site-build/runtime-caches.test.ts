import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { withRuntimeCaches } from './runtime-caches.ts'

const sitePackage = fileURLToPath(new URL('../../site/package.json', import.meta.url))
const producer = `
const { createRequire } = require('node:module');
const siteRequire = createRequire(${JSON.stringify(sitePackage)});
const { Miniflare } = siteRequire('miniflare');
const { MockAgent, setGlobalDispatcher } = createRequire(siteRequire.resolve('miniflare'))('undici');
const agent = new MockAgent(); agent.disableNetConnect();
agent.get('https://workers.cloudflare.com').intercept({ path: '/cf.json' })
  .reply(200, JSON.stringify({ colo: 'SYNTHETIC', country: 'XX' }));
setGlobalDispatcher(agent);
(async () => {
  const runtime = new Miniflare({ modules: true, host: '127.0.0.1', port: 0,
    compatibilityDate: '2026-08-06',
    script: 'export default { fetch(request) { return Response.json(request.cf) } }' });
  try {
    const response = await runtime.dispatchFetch('https://example.com/');
    const cf = await response.json();
    if (cf.colo !== 'SYNTHETIC') throw new Error('real cf producer did not run');
  } finally { await runtime.dispose(); await agent.close(); }
})().catch(error => { console.error(error); process.exitCode = 1 });
`

function fixture(run: (root: string, env: NodeJS.ProcessEnv) => void) {
  const job = mkdtempSync(join(tmpdir(), 'apparent-dev-public-cache-test-'))
  const root = join(job, 'site')
  mkdirSync(root)
  // Fixture Git must never inherit the push hook's repository/index bindings.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  for (const key of ['MINIFLARE_CACHE_DIR', 'WRANGLER_CACHE_DIR', 'CLOUDFLARE_CF_FETCH_PATH', 'CLOUDFLARE_CF_FETCH_ENABLED', 'NODE_ENV', 'NODE_TEST_CONTEXT']) delete env[key]
  env.TMPDIR = job
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  try {
    mkdirSync(join(root, '.wrangler'))
    // Real checked-in marker, not an ignore hiding the generated cache.
    writeFileSync(join(root, '.wrangler/.metadata_never_index'), readFileSync(new URL('../../site/.wrangler/.metadata_never_index', import.meta.url)))
    git('init', '--quiet'); git('add', '.')
    git('-c', 'user.name=Cache test', '-c', 'user.email=cache@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'clean runtime cwd')
    assert.equal(git('status', '--porcelain'), '')
    run(root, env)
  } finally { rmSync(job, { recursive: true, force: true }) }
}

function runtime(cwd: string, env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, ['-e', producer], { cwd, env, encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
}

test('locked Miniflare writes its real cf cache to source cwd without isolation', () => fixture((root, env) => {
  runtime(root, env)
  assert.equal(JSON.parse(readFileSync(join(root, '.wrangler/cache/cf.json'), 'utf8')).colo, 'SYNTHETIC')
}))

test('verification defaults redirect the real producer and leave the clean cwd untouched', () => fixture((root, env) => {
  let owned = ''
  withRuntimeCaches(env, child => {
    owned = child.MINIFLARE_CACHE_DIR!
    assert.equal(statSync(join(owned, '..')).mode & 0o777, 0o700)
    runtime(root, child)
    assert.equal(JSON.parse(readFileSync(join(owned, 'cf.json'), 'utf8')).colo, 'SYNTHETIC')
    assert.equal(existsSync(join(root, '.wrangler/cache')), false)
    const status = spawnSync('git', ['status', '--porcelain', '--ignored'], { cwd: root, env, encoding: 'utf8' })
    // No ignored cache output may masquerade as a clean checkout either.
    assert.equal(status.status, 0); assert.equal(status.stdout, '')
  })
  assert.equal(existsSync(owned), false)
  assert.equal(env.MINIFLARE_CACHE_DIR, undefined)
}))

test('explicit cache/config values survive, and failed verification removes only owned defaults', () => fixture((root, env) => {
  const caller = join(root, 'caller-cache')
  const explicit = { ...env, MINIFLARE_CACHE_DIR: caller, WRANGLER_CACHE_DIR: 'caller-relative', CLOUDFLARE_CF_FETCH_ENABLED: 'true' }
  const failure = Object.assign(new Error('synthetic verification diagnostic'), { exitCode: 23 })
  assert.throws(() => withRuntimeCaches(explicit, child => {
    assert.equal(child.MINIFLARE_CACHE_DIR, caller)
    assert.equal(child.WRANGLER_CACHE_DIR, 'caller-relative')
    assert.equal(child.CLOUDFLARE_CF_FETCH_ENABLED, 'true')
    runtime(root, child)
    throw failure
  }), error => error === failure)
  assert.equal(JSON.parse(readFileSync(join(caller, 'cf.json'), 'utf8')).colo, 'SYNTHETIC')
  let owned = ''
  assert.throws(() => withRuntimeCaches(env, child => { owned = child.MINIFLARE_CACHE_DIR!; throw failure }), error => error === failure)
  assert.equal(existsSync(owned), false)
  const cfPath = join(root, 'caller-cf.json')
  const cfBytes = JSON.stringify({ colo: 'SYNTHETIC', country: 'CALLER' })
  writeFileSync(cfPath, cfBytes)
  withRuntimeCaches({ ...env, CLOUDFLARE_CF_FETCH_PATH: cfPath }, child => {
    runtime(root, child)
    assert.equal(existsSync(child.MINIFLARE_CACHE_DIR!), false)
  })
  assert.equal(readFileSync(cfPath, 'utf8'), cfBytes)
  withRuntimeCaches({ ...explicit, MINIFLARE_CACHE_DIR: '', CLOUDFLARE_CF_FETCH_PATH: 'caller-cf.json' }, child => {
    assert.equal(child.MINIFLARE_CACHE_DIR, '')
    assert.equal(child.CLOUDFLARE_CF_FETCH_PATH, 'caller-cf.json')
  })
}))
