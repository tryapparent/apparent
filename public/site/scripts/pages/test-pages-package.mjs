import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const site = resolve(import.meta.dirname, '../..')
const hash = b => createHash('sha256').update(b).digest('hex')
function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), 'pages-package-'))
  const root = join(workspace, 'public/site')
  mkdirSync(join(workspace, 'shared/analytics'), { recursive: true })
  cpSync(join(site, '../../shared/analytics/browser.js'), join(workspace, 'shared/analytics/browser.js'))
  mkdirSync(join(root, 'scripts/pages'), { recursive: true }); mkdirSync(join(root, 'dist-apparent'))
  cpSync(join(site, 'scripts/pages/prepare-pages.mjs'), join(root, 'scripts/pages/prepare-pages.mjs'))
  mkdirSync(join(root, 'scripts/site-build'), { recursive: true })
  cpSync(join(site, 'scripts/site-build/product-analytics.mjs'), join(root, 'scripts/site-build/product-analytics.mjs'))
  cpSync(join(site, 'published-homepage'), join(root, 'published-homepage'), { recursive: true })
  cpSync(join(site, 'published-homepage.sha256.json'), join(root, 'published-homepage.sha256.json'))
  return root
}
const run = (root, env={}) => spawnSync(process.execPath, [join(root, 'scripts/pages/prepare-pages.mjs')], { encoding: 'utf8', env:{...process.env,PUBLIC_POSTHOG_ENABLED:'false',...env} })
const cleanup = root => rmSync(resolve(root, '../..'), { recursive: true, force: true })
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
  } finally { cleanup(root) }
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
    } finally { cleanup(root) }
  })
}
test('Pages refuses unreviewed snapshot mutations', () => {
  const root = fixture()
  try {
    writeFileSync(join(root, 'published-homepage/index.html'), 'unreviewed')
    assert.notEqual(run(root).status, 0)
    assert.equal(existsSync(join(root, 'dist-apparent/index.html')), false)
  } finally { cleanup(root) }
})
test('explicit EU analytics overlay preserves canonical source and Connect; invalid config fails before replacement', () => {
  const config={PUBLIC_POSTHOG_ENABLED:'true',PUBLIC_POSTHOG_HOST:'https://eu.i.posthog.com',PUBLIC_POSTHOG_PROJECT_TOKEN:'phc_synthetic',PUBLIC_POSTHOG_ENVIRONMENT:'synthetic'}
  for (const valid of [false,true]) {
    const root=fixture()
    try {
      mkdirSync(join(root,'dist-apparent/connect'))
      writeFileSync(join(root,'dist-apparent/connect/index.html'),'fresh Connect')
      writeFileSync(join(root,'dist-apparent/index.html'),'previous homepage')
      const result=run(root,{...config,...(!valid?{PUBLIC_POSTHOG_HOST:'https://example.com'}:{})})
      assert.equal(result.status,valid?0:1,result.stderr)
      const source=readFileSync(join(root,'published-homepage/index.html'),'utf8')
      const output=readFileSync(join(root,'dist-apparent/index.html'),'utf8')
      if(valid){
        const tag='<script type="module" src="/assets/product-analytics.js"></script>\n'
        assert.equal(output.replace(tag,''),source)
        assert.match(readFileSync(join(root,'dist-apparent/assets/product-analytics.js'),'utf8'),/startAnalytics\(/)
      }else assert.equal(output,'previous homepage')
      assert.equal(readFileSync(join(root,'dist-apparent/connect/index.html'),'utf8'),'fresh Connect')
    }finally{cleanup(root)}
  }
})
