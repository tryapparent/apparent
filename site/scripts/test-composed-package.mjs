// Exercise the real publisher in disposable trees, never a live release.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
const routes = ['connect', 'connect/device', 'hosted', 'hosted/device']
const approved = ['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png', 'hosted/agent-reading-v4.png', 'HostGrotesk-Variable.ttf', 'apparent-wordmark.svg']
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'connect-compose-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const site = join(root, 'site'), dist = join(site, 'dist'), connect = join(root, 'connect/web/dist')
  const put = (base, name, bytes) => { mkdirSync(resolve(base, name, '..'), { recursive: true }); writeFileSync(join(base, name), bytes) }
  mkdirSync(join(site, 'scripts'), { recursive: true })
  cpSync(new URL('package-apparent.mjs', import.meta.url), join(site, 'scripts/package-apparent.mjs'))
  put(dist, 'index.html', '<html>https://app.tryapparent.com/ Visual feedback gets lost We believe work should be<script src="/assets/marketing-123.js"></script></html>')
  put(dist, 'assets/marketing-123.js', 'export const marketing = true')
  for (const name of ['pond/safe.png', 'team/safe.png', 'feature-demos/safe.png', 'icon.svg', 'social-preview-v1.png', 'Apparent-ghost-demo-v4-lilac.mp4', 'Apparent-ghost-demo-v4-lilac-poster.jpg', ...approved]) put(dist, name, 'approved asset')
  for (const asset of approved) put(connect, asset, 'approved asset')
  for (const route of routes) {
    put(dist, `${route}/index.html`, 'legacy implementation')
    put(connect, `${route}/index.html`, '<meta name="robots" content="noindex, nofollow"><p>Checking your account</p><script src="/assets/connect-123.js"></script><link href="/assets/connect-123.css" rel="stylesheet">')
  }
  put(connect, 'assets/connect-123.js', 'export const connect = true')
  put(connect, 'assets/connect-123.css', '.hosted-page { color: black }')
  const run = () => spawnSync(process.execPath, ['scripts/package-apparent.mjs'], { cwd: site, encoding: 'utf8' })
  return { root, dist, connect, out: join(site, 'dist-apparent'), put, run }
}
test('composition uses independent routes, preserves marketing and excludes unreferenced private assets', t => {
  const f = fixture(t)
  f.put(f.dist, 'assets/private-capture.png', 'private capture')
  f.put(f.dist, 'private-pitch/index.html', 'private pitch')
  f.put(f.connect, 'assets/private-capture.png', 'private capture')
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  for (const route of routes) assert.deepEqual(readFileSync(`${f.out}/${route}/index.html`), readFileSync(`${f.connect}/${route}/index.html`))
  assert.deepEqual(readFileSync(`${f.out}/index.html`), readFileSync(`${f.dist}/index.html`))
  assert.deepEqual(readdirSync(`${f.out}/assets`).sort(), ['connect-123.css', 'connect-123.js', 'marketing-123.js'])
  assert(!readdirSync(f.out).includes('private-pitch'))
  const first = readFileSync(`${f.out}/connect/index.html`)
  assert.equal(f.run().status, 0)
  assert.deepEqual(readFileSync(`${f.out}/connect/index.html`), first)
})
test('same-name assets deduplicate only identical bytes; differing bytes fail before replacing output', t => {
  const f = fixture(t)
  f.put(f.connect, 'assets/marketing-123.js', 'export const marketing = true')
  f.put(f.connect, 'assets/connect-123.js', 'import "/assets/marketing-123.js"')
  assert.equal(f.run().status, 0)
  const before = readFileSync(`${f.out}/index.html`)
  f.put(f.connect, 'assets/marketing-123.js', 'different')
  assert.notEqual(f.run().status, 0, 'different asset bytes must not overwrite marketing')
  assert.deepEqual(readFileSync(`${f.out}/index.html`), before)
})
test('missing route, changed shared asset, or unsafe route dependencies fail closed', t => {
  for (const change of ['missing', 'shared', 'private']) {
    const f = fixture(t)
    if (change === 'missing') rmSync(`${f.connect}/connect/device/index.html`)
    if (change === 'shared') f.put(f.connect, 'apparent-wordmark.svg', 'different brand')
    if (change === 'private') f.put(f.connect, 'assets/connect-123.js', 'import "/assets/private-capture.png"')
    assert.notEqual(f.run().status, 0, change)
  }
})

test('identical shared modules still validate each product dependency closure', t => {
  const f = fixture(t)
  for (const root of [f.dist, f.connect]) f.put(root, 'assets/marketing-123.js', 'import "/assets/child-123.js"')
  f.put(f.dist, 'assets/child-123.js', 'marketing child')
  f.put(f.connect, 'assets/child-123.js', 'different child')
  f.put(f.connect, 'assets/connect-123.js', 'import "/assets/marketing-123.js"')
  assert.notEqual(f.run().status, 0, 'equal parent bytes must not conceal unequal dependencies')
})
