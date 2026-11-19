// Run against the packaged page: node scripts/verify-page-density-browser.mjs <URL>
import assert from "node:assert/strict"
import { chromium } from "playwright-core"

const url = process.argv[2]
if (!url) throw new Error("Pass the packaged page URL")
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: true, args: ["--mute-audio", "--no-sandbox"] })
try {
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1366, 768], [1024, 600], [390, 844], [320, 568]]) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(url)
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => document.querySelector(".pond-demo").scrollIntoView({ behavior: "instant" }))
    const demo = await page.evaluate(() => {
      const stage = document.querySelector("#demo iframe").getBoundingClientRect()
      const fallback = document.querySelector("#demo a").getBoundingClientRect()
      const heading = document.querySelector(".pond-demo h2").getBoundingClientRect()
      return { top: heading.top, bottom: fallback.bottom, stageWidth: stage.width, stageHeight: stage.height, overflow: document.documentElement.scrollWidth - innerWidth }
    })
    assert.ok(demo.top >= -1 && demo.bottom <= height - 16, `heading, entire movie and controls fit together at ${width}x${height}: ${JSON.stringify(demo)}`)
    assert.ok(demo.stageWidth >= 200 && demo.stageWidth <= 1072, "player width fits the slot and YouTube controls")
    assert.ok(Math.abs(demo.stageHeight - Math.max(200, demo.stageWidth * 9 / 16)) < 1, "player keeps the video ratio above YouTube's minimum height")
    assert.ok(demo.overflow <= 0, "no horizontal scrolling")
    const fallback = page.getByRole("link", { name: "Open on YouTube" })
    assert.equal(await fallback.getAttribute("href"), "https://youtu.be/IXJVr0-PJ7k")
    console.log(JSON.stringify({ viewport: `${width}x${height}`, demo, status: "PASS" }))
    await page.close()
  }
} finally {
  await browser.close()
}
