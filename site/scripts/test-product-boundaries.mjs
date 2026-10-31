import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import test from 'node:test'

test('marketing browser and SSR own no Connect implementation or routes', () => {
  for (const entry of ['src/main.tsx', 'src/entry-server.tsx', 'scripts/prerender.ts']) {
    assert.doesNotMatch(readFileSync(entry, 'utf8'), /hosted\/Hosted|renderHosted|isHostedPath/)
  }
  assert(!existsSync('src/hosted'), 'legacy production implementation remains')
  assert(!existsSync('dist/connect'), 'marketing build still owns Connect routes')
  for (const name of readdirSync('dist/assets')) {
    if (/\.(js|css)$/.test(name)) assert.doesNotMatch(readFileSync(`dist/assets/${name}`, 'utf8'), /csrfToken|Checking your account|hosted-permission/)
  }
})
test('composed account SSR is the exact independent artifact, without marketing imports', () => {
  const source = `../connect/web/${process.env.CONNECT_BUILD_DIR || 'dist'}`
  for (const route of ['connect', 'connect/device', 'hosted', 'hosted/device']) {
    assert.deepEqual(readFileSync(`dist-apparent/${route}/index.html`), readFileSync(`${source}/${route}/index.html`))
  }
})
