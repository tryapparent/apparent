import assert from 'node:assert/strict'

/** Public never collects analytics, even with legacy config or saved consent. */
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const site = resolve(import.meta.dirname, '../..')
const root = mkdtempSync(join(tmpdir(), 'apparent-dev-public-analytics-'))
const packageOutput = join(root, 'public')
const env = {
  ...process.env,
  APPARENT_PUBLIC_SITE: '1',
  // Deliberately enabled legacy configuration must not reactivate tracking.
  PUBLIC_POSTHOG_ENABLED: 'true',
  PUBLIC_POSTHOG_TOKEN: 'phc_synthetic',
  PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
  PUBLIC_POSTHOG_ENVIRONMENT: 'production',
  PUBLIC_BUILD_DIR: join(root, 'dist'),
  PUBLIC_SSR_DIR: join(root, 'ssr'),
  PUBLIC_PACKAGE_OUTPUT: packageOutput,
}
const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: site, env, stdio: 'inherit' })
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4' }

let server: ReturnType<typeof createServer> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  symlinkSync(join(site, 'node_modules'), join(root, 'node_modules'), 'dir')
  run(join(site, 'node_modules/.bin/vite'), ['build', '--outDir', env.PUBLIC_BUILD_DIR])
  run(join(site, 'node_modules/.bin/vite'), ['build', '--ssr', 'src/entry-server.tsx', '--outDir', env.PUBLIC_SSR_DIR])
  run('node', ['scripts/site-build/prerender.ts'])
  run('node', ['scripts/site-build/package-apparent.mjs'])

  const publicOrigin = 'https://app.tryapparent.com'
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, publicOrigin).pathname
    const file = resolve(packageOutput, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(packageOutput + '/')) { response.writeHead(403).end(); return }
    try {
      response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream')
      response.end(await readFile(file))
    } catch { response.writeHead(404).end() }
  })
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
  const localOrigin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox', '--mute-audio'] })
  for (const savedChoice of [null, 'allow', 'deny'] as const) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const analyticsRequests: string[] = []
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === publicOrigin) {
        const response = await route.fetch({ url: localOrigin + url.pathname + url.search, maxRedirects: 0 })
        await route.fulfill({ response }); return
      }
      if (/posthog/i.test(url.hostname)) analyticsRequests.push(url.href)
      await route.abort()
    })
    await context.addInitScript(choice => {
      if (choice === null) return
      localStorage.setItem('apparent.product-analytics.v1', JSON.stringify({
        choice, at: Date.now(), noticeVersion: 'product-analytics-v1',
        id: 'anon:11111111-1111-4111-8111-111111111111',
      }))
    }, savedChoice)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(publicOrigin + '/?utm_source=NEVER-SEND#capture-secret')
    await page.locator('.pond-page').waitFor()
    await page.waitForFunction(() => customElements.get('apparent-footer'))
    await page.waitForTimeout(500)
    assert.equal(await page.getByLabel('Analytics preferences', { exact: true }).count(), 0,
      `no analytics notice or settings for saved choice ${savedChoice}`)
    const before = await page.evaluate(() => localStorage.getItem('apparent.product-analytics.v1'))
    // Exercise the actual download listener without navigating away or downloading.
    await page.evaluate(() => {
      const link = [...document.querySelectorAll<HTMLAnchorElement>('a')].find(a => a.href.startsWith('https://github.com/tryapparent/apparent/releases'))!
      link.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation() }, { once: true })
      link.click()
    })
    await page.waitForTimeout(200)
    assert.deepEqual(analyticsRequests, [], 'no pageview, identity or download events')
    assert.equal(await page.evaluate(() => localStorage.getItem('apparent.product-analytics.v1')), before,
      'Public does not create or rewrite analytics preferences')
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('Public analytics disabled: fresh, previously allowed and denied mobile visitors pass; no tracking requests')
} finally {
  try {
    await browser?.close()
    if (server?.listening) await new Promise<void>(done => server!.close(() => done()))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
