// Run against the exact packaged or live page:
// node scripts/verify-video-demo-browser.mjs <URL> <private evidence directory>
// CHROME_PATH may override the system Chrome executable; no browser install is needed.
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "playwright-core"

const [url, directory] = process.argv.slice(2)
if (!url || !directory) throw new Error("Pass the packaged/live URL and a private evidence directory")
const out = resolve(directory)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: true, args: ["--mute-audio", "--no-sandbox"] })

try {
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [1280, 320]) {
      const page = await browser.newPage({ colorScheme, viewport: { width, height: 850 } })
      await page.goto(url, { waitUntil: "domcontentloaded" })
      const section = page.getByRole("region", { name: "apparent is now a Hermes Agent plugin" })
      const player = section.locator("iframe")
      const fallback = section.getByRole("link", { name: "Open on YouTube" })
      await player.scrollIntoViewIfNeeded()
      await page.waitForFunction(() => document.querySelector("#demo iframe")?.hasAttribute("src"))
      const source = new URL(await player.getAttribute("src"))
      assert.equal(source.origin + source.pathname, "https://www.youtube-nocookie.com/embed/IXJVr0-PJ7k")
      assert.equal(source.searchParams.get("mute"), "1")
      assert.equal(source.searchParams.get("playsinline"), "1")
      assert.equal(source.searchParams.get("autoplay"), "1")
      assert.equal(await fallback.getAttribute("href"), "https://youtu.be/IXJVr0-PJ7k")
      await section.screenshot({ path: resolve(out, `hermes-${colorScheme}-${width}.png`) })
      await fallback.focus()
      assert.equal(await fallback.evaluate((link) => link.matches(":focus-visible")), true)
      await page.close()
    }
  }

  const reduced = await browser.newPage({ reducedMotion: "reduce" })
  await reduced.goto(url, { waitUntil: "domcontentloaded" })
  await reduced.waitForFunction(() => document.querySelector("#demo iframe")?.hasAttribute("src"))
  assert.equal(new URL(await reduced.locator("#demo iframe").getAttribute("src")).searchParams.has("autoplay"), false)
  await reduced.close()

  const page = await browser.newPage()
  await page.goto(url, { waitUntil: "domcontentloaded" })
  const player = page.locator("#demo iframe")
  await player.scrollIntoViewIfNeeded()
  try {
    await player.contentFrame().locator("video").evaluate((video) => {
      if (!video.muted) throw new Error("The player started with sound")
    }, null, { timeout: 10000 })
    await player.contentFrame().locator("video").evaluate((video) => new Promise((done, reject) => {
      if (!video.paused && video.currentTime > 0 && video.muted) return done()
      const verify = () => {
        if (video.paused || !video.muted || video.currentTime === 0) return
        clearTimeout(deadline)
        done()
      }
      const deadline = setTimeout(() => reject(new Error("Muted autoplay did not start")), 10000)
      video.addEventListener("timeupdate", verify)
    }))
  } catch (error) {
    const message = await player.contentFrame().getByText(/sign in to confirm/i).innerText({ timeout: 1000 }).catch(() => "")
    throw new Error(message || "YouTube playback could not be verified", { cause: error })
  }
  console.log("Verified inline muted autoplay, reduced motion, fallback focus and responsive rendering")
} finally {
  await browser.close()
}
