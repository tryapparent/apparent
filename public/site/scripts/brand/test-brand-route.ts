import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { mkdirSync, existsSync } from 'node:fs'
import { extname, resolve, join } from 'node:path'
import { chromium } from 'playwright-core'
import { inventory, validatePublic } from '../artifact/public.ts'

const site = resolve(import.meta.dirname, '../..')
const root = resolve(process.env.BRAND_ARTIFACT || join(site, 'dist-apparent'))
const proof = process.env.BRAND_PROOF_DIR
const mime: Record<string,string> = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.png':'image/png', '.jpg':'image/jpeg' }

test('packaged brand reading view, downloads, deep links and keyboard slides work', async () => {
  const files = inventory(root)
  assert(files.has('brand/index.html'))
  const canonical = inventory(join(site, 'public'))
  validatePublic(files, canonical)
  for (const path of ['brand/secret.txt', 'brand/assets/unreviewed.html']) {
    const injected = new Map(files); injected.set(path, Buffer.from('not approved'))
    assert.throws(() => validatePublic(injected, canonical), /Unexpected Public output/)
  }
  const server = createServer(async (req,res) => {
    let path = new URL(req.url!, 'http://localhost').pathname
    if (path === '/brand') { res.writeHead(308, {Location:'/brand/'}).end(); return }
    if (path.endsWith('/')) path += 'index.html'
    const file = resolve(root, '.' + path)
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return }
    try { res.setHeader('Content-Type',mime[extname(file)] || 'text/plain');res.end(await readFile(file)) }
    catch { res.writeHead(404).end() }
  })
  await new Promise<void>(done => server.listen(0,'127.0.0.1',done))
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const browser = await chromium.launch({headless:true,args:['--no-sandbox','--mute-audio']})
  try {
    for (const width of [1440,390,320]) {
      const page = await browser.newPage({viewport:{width,height:900}})
      const errors: string[] = []
      page.on('pageerror',e=>errors.push(e.message))
      page.on('response',r=>{if(r.status()>=400) errors.push(`${r.status()} ${r.url()}`)})
      assert.equal((await page.goto(origin + '/brand'))!.status(),200)
      await page.locator('.bb-reader-document').waitFor()
      await page.evaluate(()=>document.fonts.ready)
      assert(await page.getByRole('heading',{name:'Brand guidelines',exact:true}).count())
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,`overflow at ${width}: ${JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(e=>{const r=e.getBoundingClientRect();return !e.closest('.bb-reader-sidebar') && r.right>innerWidth && getComputedStyle(e).position!=='fixed'}).slice(0,20).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width,text:e.textContent?.slice(0,50)}))))}`)
      const links = await page.locator('a[href^="/brand/"]').evaluateAll(nodes=>nodes.map(n=>(n as HTMLAnchorElement).getAttribute('href')!))
      for (const href of new Set(links)) {
        const url = new URL(href,origin)
        if (url.pathname === '/brand/') continue
        assert.equal((await page.request.get(url.href)).status(),200,href)
      }
      assert(await page.getByText('It’s the machine’s job to understand us, not our job to talk like a machine.', {exact:true}).count())
      const collection = await (await page.request.get(origin + '/brand/assets/frogs/collection.json')).json()
      assert(collection.assets.length >= 10)
      for (const item of collection.assets) {
        const response = await page.request.get(origin + item.url)
        assert.equal(response.status(),200,item.url)
        const png = await response.body()
        assert.equal(png.readUInt32BE(16),item.width,item.name)
        assert.equal(png.readUInt32BE(20),item.height,item.name)
      }
      await page.getByRole('button',{name:'Try a button',exact:true}).click()
      assert(await page.getByText('Button tried 1 time.',{exact:true}).count())
      assert(await page.getByRole('button',{name:'Unavailable',exact:true}).isDisabled())
      const preference = page.getByRole('switch',{name:'Playful details'}).first()
      assert.equal(await preference.getAttribute('aria-checked'),'true')
      assert.equal(await preference.locator('.apparent-switch-track').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(183, 165, 216)')
      await preference.focus()
      await page.keyboard.press('Space')
      assert.equal(await preference.getAttribute('aria-checked'),'false')
      assert.equal(await preference.locator('.apparent-switch-track').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(122, 88, 199)')
      assert.equal(await preference.locator('.apparent-switch-track').evaluate(element=>getComputedStyle(element).borderWidth),'0px')
      await page.keyboard.press('Enter')
      assert.equal(await preference.getAttribute('aria-checked'),'true')
      assert.deepEqual(await page.locator('.bb-type-hierarchy').evaluate(element =>
        ['.bb-type-title','.bb-type-section','p'].map(selector => getComputedStyle(element.querySelector(selector)!).fontSize)), ['48px','24px','18px'])
      for (const theme of ['light','dark']) {
        const control = page.locator(`.bb-switch-${theme} .bb-switch`).first()
        await control.focus()
        assert.equal(await control.evaluate(element => getComputedStyle(element).outlineStyle),'solid')
        assert.equal(await control.locator('.apparent-switch-thumb').evaluate(element => getComputedStyle(element).backgroundColor), theme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(2, 1, 2)')
        assert.equal(await control.locator('.apparent-switch-track').evaluate(element => getComputedStyle(element).backgroundColor),'rgb(183, 165, 216)')
        await page.keyboard.press('Space')
        assert.equal(await control.getAttribute('aria-checked'),'false')
        assert.equal(await control.locator('.apparent-switch-track').evaluate(element => getComputedStyle(element).backgroundColor),'rgb(122, 88, 199)')
        await page.keyboard.press('Enter')
        assert.equal(await control.getAttribute('aria-checked'),'true')
      }
      const tab = page.getByRole('tab',{name:'Your expression'})
      await page.getByRole('button',{name:'Show error example'}).click()
      const dialog=page.getByRole('alertdialog',{name:'Unable to save preference'})
      assert(await dialog.isVisible())
      assert.equal(await dialog.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(245, 240, 232)')
      assert.equal(await dialog.locator('h2 svg').evaluate(element=>getComputedStyle(element).color),'rgb(180, 35, 24)')
      const recovery=dialog.getByRole('button',{name:'Refresh preference'})
      const close=dialog.getByRole('button',{name:'Close',exact:true})
      assert(await recovery.evaluate(element=>element===document.activeElement))
      const recoveryBounds=await recovery.boundingBox(),closeBounds=await close.boundingBox()
      assert(recoveryBounds&&closeBounds&&(recoveryBounds.y<closeBounds.y||recoveryBounds.x<closeBounds.x),'Primary comes first, including wrapped actions')
      await page.keyboard.press('Tab')
      assert(await close.evaluate(element=>element===document.activeElement))
      await page.keyboard.press('Escape')
      assert(!await dialog.isVisible())
      assert(await page.getByRole('button',{name:'Show error example'}).evaluate(element=>element===document.activeElement))
      await tab.focus()
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction(()=>document.querySelector('[role="tab"][data-state="active"]')?.textContent === 'Agent response')
      assert.equal(await page.getByRole('tab',{name:'Agent response'}).getAttribute('aria-selected'),'true')
      await page.getByLabel('Project name',{exact:true}).fill('')
      await page.getByRole('button',{name:'Try validation'}).click()
      assert.equal(await page.getByLabel('Project name',{exact:true}).getAttribute('aria-invalid'),'true')
      await page.getByLabel('Project name',{exact:true}).fill('A very peculiar frog')
      await page.getByRole('button',{name:'Try validation'}).click()
      assert(await page.getByText('Example accepted. Nothing was saved.',{exact:true}).count())
      for (const state of ['neutral','progress','success','warning','failure']) {
        await page.getByLabel('Example state',{exact:true}).selectOption(state)
        assert.equal(await page.locator('.apparent-status-card').getAttribute('data-tone'),state)
      }
      await page.getByRole('button',{name:'Try again',exact:true}).click()
      assert.equal(await page.getByLabel('Example state',{exact:true}).inputValue(),'progress')
      await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false)
      if (proof) {
        mkdirSync(proof,{recursive:true})
        for (const section of ['brand-foundations','frog-collection','frontend-design-system']) {
          await page.locator(`#${section}`).evaluate(element=>element.scrollIntoView({block:'start'}))
          await page.screenshot({path:join(proof,`brand-${section}-${width}.png`)})
        }
      }
      if (width === 1440) {
        await page.evaluate(()=>document.documentElement.style.fontSize='200%')
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,'overflow at 200% text size')
        await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'))
      }
      await page.getByRole('navigation',{name:'Brand guideline sections'}).getByRole('link',{name:/Typeface/}).click()
      if (proof) {mkdirSync(proof,{recursive:true});await page.screenshot({path:join(proof,`brand-typography-${width}.png`)})}
      assert.deepEqual(errors,[])
      await page.goto(origin + '/brand/?slides=1#slide-3')
      await page.waitForTimeout(250)
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction(()=>location.hash==='#slide-4')
      assert.deepEqual(errors,[])
      await page.close()
    }
    assert(existsSync(join(root,'brand/brand-guidelines.md')))
    assert(existsSync(join(root,'brand/design-system/tokens/apparent.tokens.json')))
  } finally { await browser.close();await new Promise<void>(done=>server.close(()=>done())) }
})
