// Controlled synthetic API + exact packaged website. The API origin is build-specific.
// No real Google or Connect service; loopback builds are not production artifacts.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright-core'
const root = resolve(process.env.SITE_ARTIFACT || 'dist-apparent')
const evidence = resolve(process.env.SITE_EVIDENCE || `${process.env.TMPDIR}/hosted-web-evidence`)
await mkdir(evidence, { recursive: true })
for (const route of ['connect', 'connect/device', 'hosted', 'hosted/device']) {
  const html = await readFile(`${root}/${route}/index.html`, 'utf8')
  assert.match(html, /noindex, nofollow/); assert.match(html, /Checking your account/)
  assert.match(html, /<title>Connect(?: a device)? — Apparent<\/title>/)
  assert(!html.includes('verified@example.com'))
}
assert(!(await readFile(`${root}/index.html`, 'utf8')).includes('href="/hosted'))
assert(!(await readFile(`${root}/sitemap.xml`, 'utf8')).includes('/hosted'))
assert(!(await readFile(`${root}/index.html`, 'utf8')).includes('href="/connect'))
assert(!(await readFile(`${root}/sitemap.xml`, 'utf8')).includes('/connect'))
// The packaged artifact must retain the exact approved art and original brand assets.
for (const asset of ['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png', 'hosted/agent-reading-v4.png', 'HostGrotesk-Variable.ttf', 'apparent-wordmark.svg']) {
  assert.deepEqual(await readFile(`${root}/${asset}`), await readFile(`public/${asset}`), `packaged ${asset}`)
}
let scenario = {}, writes = [], calls = [], approved = false, signedOut = false, interest = false
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname.startsWith('/v1/') || url.pathname === '/auth/logout') {
    res.setHeader('Access-Control-Allow-Origin', `http://127.0.0.1:${server.address().port}`)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    calls.push({ host: req.headers.host, cookie: req.headers.cookie })
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store')
    if (scenario.loading && url.pathname === '/v1/session') await new Promise(r => setTimeout(r, 650))
    if (scenario.unavailable) return res.writeHead(503).end('{}')
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      writes.push({ path: url.pathname, body, csrf: req.headers['x-csrf-token'], cookie: req.headers.cookie, origin: req.headers.origin })
      if (req.headers['x-csrf-token'] !== 'synthetic-csrf' || !req.headers.cookie?.includes('fixture=1') || req.headers.origin !== `http://127.0.0.1:${server.address().port}` || scenario.forbidden) return res.writeHead(403).end('{}')
      await new Promise(r => setTimeout(r, 180))
      if (url.pathname === '/v1/device/approve') approved = true
      if (url.pathname === '/v1/waitlist') interest = body.interestedAtFiveDollars
      if (url.pathname === '/auth/logout') signedOut = true
      return res.end('{"ok":true}')
    }
    if (url.pathname === '/v1/device') return res.end(JSON.stringify({ scope: approved && scenario.changedScope ? 'upload' : scenario.scope || 'read', status: approved && !scenario.unconfirmed ? 'approved' : scenario.status || 'pending', ...(scenario.withExpiry || scenario.clockExpiry ? { expiresAt: new Date(scenario.clockExpiry ? scenario.expiresAt : Date.now() + 600000).toISOString() } : {}) }))
    if (scenario.anonymous || signedOut) return res.end('{"authenticated":false,"csrfToken":null,"account":null,"slots":{"used":0,"limit":20,"remaining":20}}')
    return res.end(JSON.stringify({ authenticated: true, csrfToken: 'synthetic-csrf', account: { email: 'verified@example.com', beta: scenario.waitlist ? 'waitlist' : 'active', quotaBytes: 500000000, usedBytes: 0, waitlist: { interestedAtFiveDollars: interest } }, slots: { used: scenario.full ? 20 : 0, limit: scenario.invalid ? 50 : 20, remaining: scenario.full ? 0 : 20 }, accessToken: 'must-not-render' }))
  }
  let path = url.pathname
  if (/^\/(connect|hosted)(\/device)?\/?$/.test(path)) path = path.replace(/\/$/, '') + '/index.html'
  if (path === '/') path = '/index.html'
  const file = resolve(root, '.' + path)
  if (!file.startsWith(root + '/')) return res.writeHead(403).end()
  try { res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' })[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)) }
  catch { res.writeHead(404).end() }
})
await new Promise(r => server.listen(Number(process.env.HOSTED_FIXTURE_PORT || 0), '127.0.0.1', r))
const apiOrigin = process.env.HOSTED_TEST_API_ORIGIN || ''
const apiServer = apiOrigin ? createServer(server.listeners('request')[0]) : null
if (apiServer) await new Promise(r => apiServer.listen(Number(new URL(apiOrigin).port), '127.0.0.1', r))
console.log(`Synthetic hosted fixture at http://127.0.0.1:${server.address().port}/hosted/`)
if (process.env.HOSTED_FIXTURE_ONLY) await new Promise(() => {})
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/home/simon/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] })
const results = []
try {
  for (const test of [
    { name: 'anonymous', anonymous: true, width: 1440 }, { name: 'anonymous-device', anonymous: true, device: true }, { name: 'loading', loading: true },
    { name: 'desktop-1440', width: 1440 }, { name: 'desktop-1280', width: 1280 }, { name: 'phone-390', width: 390 }, { name: 'empty-account', width: 320 }, { name: 'zoom-200-equivalent', width: 640, height: 450 },
    { name: 'full-waitlist', waitlist: true, full: true, width: 390 },
    { name: 'read-approval', device: true }, { name: 'upload-approval', device: true, scope: 'upload', width: 390, withExpiry: true },
    { name: 'expired', device: true, status: 'expired' }, { name: 'rejected', device: true, status: 'rejected' },
    { name: 'invalid-scope', device: true, scope: 'admin' }, { name: 'no-code', device: true, noCode: true },
    { name: 'csrf-denied', device: true, forbidden: true }, { name: 'unavailable', unavailable: true }, { name: 'invalid-count', invalid: true },
    { name: 'approved-read', device: true, status: 'approved' }, { name: 'approved-upload', device: true, scope: 'upload', status: 'approved', width: 320 },
    { name: 'unconfirmed-approval', device: true, unconfirmed: true }, { name: 'changed-scope-readback', device: true, changedScope: true },
    { name: 'clock-expiry', device: true, clockExpiry: true },
    { name: 'legacy-account', legacy: true }, { name: 'legacy-anonymous', legacy: true, anonymous: true },
    { name: 'legacy-device', legacy: true, device: true }, { name: 'legacy-anonymous-device', legacy: true, device: true, anonymous: true },
    { name: 'canonical-no-slash', noSlash: true }, { name: 'canonical-device-slash', device: true, deviceSlash: true },
  ]) {
    scenario = test; writes = []; calls = []; approved = false; signedOut = false; interest = false
    scenario.expiresAt = Date.now() + 2500
    const page = await browser.newPage({ viewport: { width: test.width || 1100, height: test.height || 900 } })
    const errors = []; page.on('pageerror', e => errors.push(String(e)))
    await page.context().addCookies([{ name: 'fixture', value: '1', url: `http://127.0.0.1:${server.address().port}` }])
    await page.goto(`http://127.0.0.1:${server.address().port}/${test.legacy ? 'hosted' : 'connect'}${test.device ? `/device${test.deviceSlash ? '/' : ''}${test.noCode ? '' : '?code=SYNTHETIC'}` : `${test.noSlash ? '' : '/'}?returnTo=https://evil.example`}`)
    if (test.loading) { await page.getByRole('status').filter({ hasText: 'Checking your account' }).waitFor(); await page.screenshot({ path: `${evidence}/loading-pending.png` }) }
    await page.waitForFunction(() => document.querySelector('.hosted-panel')?.getAttribute('aria-busy') === 'false')
    assert.equal(writes.length, 0, 'never auto approve or mutate on load')
    if (!test.device && !test.waitlist && !test.unavailable && !test.invalid) {
      const computer = page.getByRole('tab', { name: 'This computer', exact: true })
      const agent = page.getByRole('tab', { name: 'Your agent', exact: true })
      assert.equal(await page.getByRole('heading', { name: 'Upload new captures', exact: true }).count(), 1)
      await page.evaluate(() => document.fonts.ready)
      const geometry = await page.evaluate(() => {
        const sheet = document.querySelector('.hosted-main'), title = document.querySelector('h1'), cta = document.querySelector('.hosted-main-action')
        return { width: sheet.getBoundingClientRect().width, radius: getComputedStyle(sheet).borderRadius, title: getComputedStyle(title).fontSize, ctaRadius: getComputedStyle(cta).borderRadius, ctaColor: getComputedStyle(cta).backgroundColor, font: getComputedStyle(sheet).fontFamily }
      })
      assert.equal(geometry.width, test.width >= 760 ? 720 : (test.width || 1100) > 550 ? Math.min(720, (test.width || 1100) - 40) : test.width - 24)
      assert.equal(geometry.radius, '0px'); assert.equal(geometry.ctaRadius, '0px'); assert.equal(geometry.ctaColor, 'rgb(25, 22, 29)')
      assert.equal(geometry.title, test.width <= 550 ? '32px' : '36px'); assert.match(geometry.font, /Host Grotesk/)
      await page.screenshot({ path: `${evidence}/${test.name}-computer.png`, fullPage: true })
      await computer.focus(); await page.keyboard.press('ArrowRight')
      assert.equal(await agent.getAttribute('aria-selected'), 'true'); assert.equal(await agent.evaluate(e => e === document.activeElement), true)
      assert.equal(await page.getByRole('heading', { name: 'Read your captures', exact: true }).count(), 1)
      assert.equal(await page.locator('.hosted-agent').count(), 0)
      assert.match(await page.locator('.hosted-source').getAttribute('src'), /agent-reading-v4/)
      await page.waitForFunction(() => [...document.querySelectorAll('.hosted-scene img, .hosted-header img')].every(e => e.complete && e.naturalWidth > 0))
      const lock = page.getByRole('button', { name: 'View separate agent read permission details' })
      assert.equal(await lock.evaluate(e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e || e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }), true)
      await page.screenshot({ path: `${evidence}/${test.name}-agent.png`, fullPage: true })
      await lock.click(); await page.getByRole('dialog').waitFor()
      assert.match(await page.getByRole('dialog').innerText(), /all current and future uploads/)
      await page.keyboard.press('Escape'); assert.equal(await lock.evaluate(e => e === document.activeElement), true)
      const details = page.locator('.hosted-details > summary')
      await details.focus(); await page.keyboard.press('Enter')
      assert.equal(await page.locator('.hosted-details').getAttribute('open'), '')
      await page.locator('.hosted-details .hosted-limits > summary').click()
      assert.match(await page.locator('.hosted-details').innerText(), /500,000,000[\s\S]*90,000,000[\s\S]*20 accounts[\s\S]*30 days/)
      await page.getByRole('button', { name: 'Review access', exact: true }).click()
      if (!test.anonymous) {
        assert.equal(await page.getByRole('dialog').locator('pre code').innerText(), `apparent connect login --server ${apiOrigin || 'https://YOUR-HOSTED-API-ORIGIN'} --scope read --no-browser`)
        assert.match(await page.getByRole('dialog').innerText(), /Update Apparent to use apparent connect\. Older apps can use apparent cloud; it remains a compatibility alias\./)
      }
      await page.keyboard.press('Escape')
      await agent.focus(); await page.keyboard.press('Home')
      assert.equal(await computer.getAttribute('aria-selected'), 'true')
      assert.match(await page.locator('.hosted-source').getAttribute('src'), /source-pond-v4/)
      assert.equal(await page.locator('.hosted-agent').count(), 1)
      assert.equal(await page.locator('.hosted-details').getAttribute('open'), null)
      const connect = page.getByRole('button', { name: 'Connect', exact: true })
      await connect.click()
      if (!test.anonymous) {
        assert.deepEqual(await page.getByRole('dialog').locator('pre code').allInnerTexts(), [
          `apparent connect login --server ${apiOrigin || 'https://YOUR-HOSTED-API-ORIGIN'} --scope upload --consent-upload`,
          'apparent connect status\napparent connect status --account',
        ])
        assert.match(await page.getByRole('dialog').innerText(), /Update Apparent to use apparent connect\. Older apps can use apparent cloud; it remains a compatibility alias\./)
      }
      assert.equal(writes.length, 0, 'tabs, details and setup never mutate')
      if (!test.anonymous) { await page.screenshot({ path: `${evidence}/${test.name}-setup.png`, fullPage: true }); await page.keyboard.press('Escape'); assert.equal(await connect.evaluate(e => e === document.activeElement), true) }
    }
    if (test.anonymous) { const href = await page.getByRole('link', { name: 'Continue with Google' }).getAttribute('href'); assert.equal(href, apiOrigin + (test.device ? '/auth/google/start?returnTo=%2Fconnect%2Fdevice%3Fcode%3DSYNTHETIC' : '/auth/google/start?returnTo=%2Fconnect')) }
    if (test.waitlist) {
      assert.match(await page.locator('main').innerText(), /beta is full/)
      await page.getByRole('checkbox').check()
      await page.locator('form').evaluate(e => { e.requestSubmit(); e.requestSubmit() })
      await page.waitForFunction(() => document.querySelector('.hosted-panel')?.getAttribute('aria-busy') === 'false')
      assert.equal(writes.length, 1); assert.deepEqual(writes[0].body, { interestedAtFiveDollars: true })
    }
    const allow = page.getByRole('button', { name: /^Allow / })
    if (test.clockExpiry) {
      await page.getByRole('heading', { name: 'That code expired' }).waitFor()
      assert.equal(await allow.count(), 0); assert.equal(writes.length, 0)
    } else if (test.device && !test.anonymous && !test.status && !test.noCode && test.scope !== 'admin') {
      assert.equal(await allow.count(), 1)
      const selectedTab = page.getByRole('tab', { name: test.scope === 'upload' ? 'This computer' : 'Your agent', exact: true })
      assert.equal(await selectedTab.getAttribute('aria-selected'), 'true')
      assert.equal(await page.getByRole('tab', { name: test.scope === 'upload' ? 'Your agent' : 'This computer', exact: true }).isDisabled(), true)
      await selectedTab.focus(); await page.keyboard.press('ArrowRight'); assert.equal(await selectedTab.getAttribute('aria-selected'), 'true')
      if (test.scope === 'upload') { assert.equal(await allow.isDisabled(), true); await page.getByRole('checkbox').check(); assert.equal(writes.length, 0) }
      assert.match(await page.locator('main').innerText(), test.scope === 'upload' ? /add, read and delete/ : /All your current and future uploads/)
      await page.screenshot({ path: `${evidence}/${test.name}-pending.png`, fullPage: true })
      await allow.evaluate(e => { e.click(); e.click() })
      await page.waitForFunction(() => document.querySelector('.hosted-panel')?.getAttribute('aria-busy') === 'false')
      assert.equal(writes.length, 1); assert.equal(writes[0].csrf, 'synthetic-csrf'); assert.deepEqual(writes[0].body, { userCode: 'SYNTHETIC' })
      assert.match(await page.locator('main').innerText(), test.forbidden ? /not authorized/ : test.unconfirmed || test.changedScope ? /Approval could not be confirmed/ : /Approval granted[\s\S]*CLI must finish/)
    } else if (test.device) assert.equal(await allow.count(), 0)
    if (test.unavailable || test.invalid || test.scope === 'admin') assert.equal(await page.getByRole('alert').count(), 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('main *, dialog[open] *')].filter(e => e.getClientRects().length && getComputedStyle(e).position !== 'absolute').some(e => { const r = e.getBoundingClientRect(); return r.width > innerWidth + 1 || r.left < -1 || r.right > innerWidth + 1 })), false, 'no clipped content hidden by global overflow CSS')
    assert.doesNotMatch(await page.locator('body').innerText(), /Uploads are on|Read access is on|Manage|simulated|Try a state|\bHosting\b|\bHosted\b/)
    assert.equal(await page.evaluate(() => localStorage.length), 0)
    assert(!(await page.content()).includes('must-not-render'))
    assert(!(await page.content()).includes('synthetic-csrf'))
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `${evidence}/${test.name}.png`, fullPage: true })
    if (test.name === 'empty-account') {
      await page.getByRole('button', { name: 'Log out' }).click()
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
      await page.getByRole('link', { name: 'Continue with Google' }).waitFor()
      assert.equal(writes[0].path, '/auth/logout'); assert.equal(writes[0].csrf, 'synthetic-csrf')
    }
    assert(calls.length > 0)
    for (const call of calls) {
      assert.equal(call.host, apiOrigin ? new URL(apiOrigin).host : `127.0.0.1:${server.address().port}`, 'fetches must use configured API origin')
      assert.match(call.cookie || '', /fixture=1/, 'credentialed API fetch retains the host cookie')
    }
    results.push(test.name); await page.close()
  }
  const receipt = { synthetic: true, artifact: root, apiOrigin: apiOrigin || 'same-origin', passed: results, count: results.length, screenshots: evidence, assets: Object.fromEntries(await Promise.all(['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png', 'hosted/agent-reading-v4.png', 'HostGrotesk-Variable.ttf', 'apparent-wordmark.svg'].map(async name => [name, createHash('sha256').update(await readFile(`${root}/${name}`)).digest('hex')]))), limits: 'Controlled synthetic API only; not live OAuth, service, native, or deployment proof. 640×450 CSS pixels is a 200%-equivalent layout, not browser zoom.' }
  await import('node:fs/promises').then(fs => fs.writeFile(`${evidence}/receipt.json`, JSON.stringify(receipt, null, 2)))
  console.log(JSON.stringify(receipt, null, 2))
} finally { await browser.close(); if (apiServer) await new Promise(r => apiServer.close(r)); await new Promise(r => server.close(r)) }
