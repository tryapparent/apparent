import assert from "node:assert/strict";
import { join } from "node:path";
import type { Browser } from "playwright-core";

export async function verifyAgentQuickstart(browser: Browser, origin: string) {
  for (const width of [1280, 320]) {
    const viewport = { width, height: 900 };
    for (const colorScheme of ["light", "dark"] as const) {
      const page = await browser.newPage({
        viewport,
        colorScheme,
        javaScriptEnabled: false,
      });
      try {
        await page.goto(origin);
        await page.getByRole("link", { name: "Agent quickstart" }).click();
        await page
          .getByRole("heading", {
            name: "Screen recordings your coding agent can read",
          })
          .waitFor();
        const route = new URL(page.url()).pathname;
        assert.equal(route, "/agents/");
        const geometry = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth,
        }));
        assert(
          geometry.scrollWidth <= geometry.innerWidth,
          `Agent quickstart ${route} (JavaScript disabled, ${browser.browserType().name()}, ${viewport.width}x${viewport.height}, ${colorScheme}): horizontal overflow (scrollWidth=${geometry.scrollWidth}px, innerWidth=${geometry.innerWidth}px)`,
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page.locator("a:focus-visible").getAttribute("href"),
          "/",
        );
        if (process.env.SITE_EVIDENCE)
          await page.screenshot({
            path: join(
              process.env.SITE_EVIDENCE,
              `agents-${browser.browserType().name()}-${width}-${colorScheme}.png`,
            ),
            fullPage: true,
          });
        await page
          .getByRole("link", { name: "Read the skill instructions" })
          .click();
        assert.equal(new URL(page.url()).pathname, "/skill.md");
      } finally {
        await page.close();
      }
    }
  }
}
