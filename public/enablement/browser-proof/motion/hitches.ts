// Real-time hitch probe: plays the demo at 1x (sound off) and records every requestAnimationFrame
// interval, plus long tasks where the browser reports them.
//
//   bun ../enablement/browser-proof/motion/hitches.ts --url http://localhost:4602/ [--browser webkit] [--size iphone] [--runs 2]
import { chromium, webkit } from "playwright-core"
import { framePacing } from "./frame-pacing.ts"

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1])
const url = args.get("url") ?? "http://localhost:4602/"
const browserName = args.get("browser") ?? "webkit"
const size = args.get("size") ?? "iphone"
const runs = Number(args.get("runs") ?? "2")
const query = args.get("query") ?? ""
const viewport = size === "iphone" ? { width: 393, height: 852 } : { width: 1280, height: 860 }

const all: number[] = []
const longTasks: number[] = []
for (let r = 0; r < runs; r++) {
  const exe = process.env.PW_WEBKIT && browserName === "webkit" ? { executablePath: process.env.PW_WEBKIT } : {}
  const browser = await (browserName === "webkit" ? webkit : chromium).launch(exe)
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: size === "iphone" ? 3 : 2, isMobile: size === "iphone", hasTouch: size === "iphone" })
  const page = await ctx.newPage()
  await page.goto(`${url}${url.includes("?") ? "&" : "?"}${query}`, { waitUntil: "networkidle" })
  await page.waitForFunction(() => window.__apparentDemo?.ready?.() === true, null, { timeout: 20000 })
  await page.evaluate(() => (document.querySelector(".stage-wrap") as HTMLElement).scrollIntoView({ block: "center" }))
  await page.waitForTimeout(1500)
  const res = await page.evaluate(
    () =>
      new Promise<{ dts: number[]; long: number[] }>((resolve) => {
        const dts: number[] = []
        const long: number[] = []
        try {
          new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(e.duration))).observe({ type: "longtask", buffered: false })
        } catch {
          // WebKit has no long task entries.
        }
        window.__apparentDemo!.seek(0)
        window.__apparentDemo!.play()
        let last = performance.now()
        const tick = (now: number) => {
          dts.push(now - last)
          last = now
          if (window.__apparentDemo!.t() >= 22990) resolve({ dts: dts.slice(2), long })
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
  all.push(...res.dts)
  longTasks.push(...res.long)
  await browser.close()
}

console.log(JSON.stringify({ url, browser: browserName, size, runs, ...framePacing(all, longTasks) }))
