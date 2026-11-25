// CHROME_PATH selects a locally installed Chromium; no browser download needed.
import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { servePackage } from "./homepage-performance/fixture.ts"

const artifact = process.env.SITE_ARTIFACT ?? fileURLToPath(new URL("../../site/dist-apparent", import.meta.url))

test("homepage starts with one preloaded font and defers GitHub and YouTube", async (t) => {
  const site = await servePackage(artifact)
  t.after(site.close)
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" })
    const starsUrl = "https://api.github.com/repos/tryapparent/apparent"
    const fonts = []
    let playerRequests = 0
    await page.route("https://fonts.bunny.net/**", route => route.abort())
    await page.route("https://www.youtube-nocookie.com/**", route => {
      playerRequests++
      return route.fulfill({ contentType: "text/html", body: "<title>Player fixture</title>" })
    })
    page.on("request", request => {
      if (request.resourceType() === "font") fonts.push(new URL(request.url()).pathname)
    })
    const wordmark = Promise.withResolvers()
    const wordmarkRequested = Promise.withResolvers()
    await page.route("**/apparent-wordmark.svg", async route => {
      wordmarkRequested.resolve()
      await wordmark.promise
      await route.continue()
    }, { times: 1 })
    let reply = { stargazers_count: 2 }
    let status = 200
    let requests = 0
    await page.route(starsUrl, (route) => {
      requests++
      return route.fulfill({ status, json: reply })
    })
    await page.goto(site.origin, { waitUntil: "domcontentloaded" })
    await wordmarkRequested.promise
    assert.equal(await page.evaluate(() => document.readyState), "interactive")
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(requests, 0, "GitHub metadata waits for the page load event")
    assert.equal(await page.locator(".github-stars span").textContent(), "GitHub")
    wordmark.resolve()
    await page.waitForLoadState("load")
    await page.waitForFunction(() => document.querySelector(".github-stars span")?.textContent === "2")
    const preload = page.locator('link[rel="preload"][as="font"]')
    const font = await preload.getAttribute("href")
    assert.equal(font, "/brand/assets/fonts/studies/HostGrotesk-Variable.woff2")
    assert.equal(await preload.getAttribute("crossorigin"), "")
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === "Host Grotesk" && font.status === "loaded")), true)
    assert.deepEqual(fonts, [font], "the homepage reuses the preloaded WOFF2")
    assert.equal(playerRequests, 0, "the offscreen player does not load")
    const frame = page.locator("#demo iframe")
    assert.equal(await frame.getAttribute("src"), null)
    const playerRequest = page.waitForRequest("https://www.youtube-nocookie.com/**")
    await frame.scrollIntoViewIfNeeded()
    const embed = new URL((await playerRequest).url())
    assert.equal(embed.searchParams.has("autoplay"), false)

    for (const [value, expected] of [[2, "2"], [0, "0"], [93000, "93K"], [1250, "1.3K"]]) {
      reply = { stargazers_count: value }
      await page.goto(site.origin)
      await page.waitForFunction((text) => document.querySelector(".github-stars span")?.textContent === text, expected)
      assert.equal(await page.locator(".github-stars").getAttribute("href"), "https://github.com/tryapparent/apparent")
      assert.equal(await page.locator(".github-stars").getAttribute("aria-label"), `apparent on GitHub: ${value.toLocaleString("en")} stars`)
    }
    for (const width of [1280, 375, 320]) {
      await page.setViewportSize({ width, height: 800 })
      const bounds = await page.locator(".github-stars").boundingBox()
      const brand = await page.locator(".pond-nav .brand").boundingBox()
      assert.ok(bounds.x >= brand.x + brand.width && bounds.x + bounds.width <= width)
      assert.ok(bounds.height >= 44)
      await page.locator(".pond-nav .brand").focus()
      await page.keyboard.press("Tab")
      assert.equal(await page.locator(".github-stars").evaluate((el) => document.activeElement === el), true)
      assert.equal(await page.locator(".github-stars").evaluate((el) => getComputedStyle(el).outlineStyle), "solid")
    }
    for (const invalid of [-1, "93k", 1.2, null]) {
      reply = { stargazers_count: invalid }
      await page.goto(site.origin)
      await page.waitForLoadState("networkidle")
      assert.equal(await page.locator(".github-stars span").textContent(), "GitHub")
    }
    status = 403
    await page.goto(site.origin)
    await page.waitForLoadState("networkidle")
    assert.equal(await page.locator(".github-stars span").textContent(), "GitHub")
    assert.equal(requests, 10, "one metadata request per mount, without retries")
  } finally {
    await browser.close()
  }
})
