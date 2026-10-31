import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const site = resolve(import.meta.dirname, '..')
const hash = b => createHash('sha256').update(b).digest('hex')
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pages-package-'))
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'dist-apparent'))
  cpSync(join(site, 'scripts/prepare-pages.mjs'), join(root, 'scripts/prepare-pages.mjs'))
  cpSync(join(site, 'published-homepage'), join(root, 'published-homepage'), { recursive: true })
  cpSync(join(site, 'published-homepage.sha256.json'), join(root, 'published-homepage.sha256.json'))
  return root
}
const run = root => spawnSync(process.execPath, [join(root, 'scripts/prepare-pages.mjs')], { encoding: 'utf8' })
test('Pages keeps accepted homepage bytes and retained assets, without replacing fresh Connect', () => {
  const root = fixture()
  try {
    for (const route of ['connect', 'connect/device', 'connect/shares', 'hosted', 'hosted/device', 'hosted/shares']) {
      mkdirSync(join(root, 'dist-apparent', route), { recursive: true })
      writeFileSync(join(root, 'dist-apparent', route, 'index.html'), `fresh ${route}`)
    }
    assert.equal(run(root).status, 0)
    const manifest = JSON.parse(readFileSync(join(root, 'published-homepage.sha256.json')))
    for (const [path, digest] of Object.entries(manifest)) assert.equal(hash(readFileSync(join(root, 'dist-apparent', path))), digest, path)
    for (const route of ['connect', 'connect/device', 'connect/shares', 'hosted', 'hosted/device', 'hosted/shares']) {
      assert.equal(readFileSync(join(root, 'dist-apparent', route, 'index.html'), 'utf8'), `fresh ${route}`)
    }
    assert.equal(existsSync(join(root, 'dist-apparent/404.html')), true)
    assert.match(readFileSync(join(root, 'dist-apparent/_redirects'), 'utf8'), /\/hosted\/device \/connect\/device 302/)
    for (const suffix of ['', '/']) assert.ok(readFileSync(join(root, 'dist-apparent/_redirects'), 'utf8').split('\n').includes(`/hosted/shares${suffix} /connect/shares 302`))
    assert.match(readFileSync(join(root, 'dist-apparent/_headers'), 'utf8'), /X-Apparent-Publisher: cloudflare-pages/)
    assert.equal(run(root).status, 1, 'do not silently reprocess provider metadata as public source')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
for (const path of ['pitch/index.html', 'map-tyyxsf5b/index.html', 'hosted/private.png', 'deployment.json', 'connect/secret.json']) {
  test(`Pages refuses unexpected public path ${path} before changing homepage`, () => {
    const root = fixture()
    try {
      const target = join(root, 'dist-apparent', path)
      mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, 'private sentinel')
      writeFileSync(join(root, 'dist-apparent/index.html'), 'previous homepage')
      assert.notEqual(run(root).status, 0)
      assert.equal(readFileSync(join(root, 'dist-apparent/index.html'), 'utf8'), 'previous homepage')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}
test('Pages refuses unreviewed snapshot mutations', () => {
  const root = fixture()
  try {
    writeFileSync(join(root, 'published-homepage/index.html'), 'unreviewed')
    assert.notEqual(run(root).status, 0)
    assert.equal(existsSync(join(root, 'dist-apparent/index.html')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
