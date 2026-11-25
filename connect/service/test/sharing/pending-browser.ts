import assert from "node:assert/strict";
import type { Browser, Page, Request } from "playwright-core";

export async function checkPendingPage(
  browser: Browser,
  page: Page,
  url: string,
) {
  const manifest = url + "/manifest.json";
  await Promise.all([
    page.waitForRequest(manifest, { timeout: 3500 }),
    page.goto(url),
  ]);
  await page.getByRole("heading", { name: "Preparing recording" }).waitFor();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const manual = await context.newPage();
  const checks: Request[] = [];
  manual.on("request", (request) => {
    if (request.url() === manifest) checks.push(request);
  });
  try {
    await manual.goto(url);
    const fallback = manual.locator("[data-share-poll] noscript p");
    assert.ok(await fallback.isVisible());
    assert.match(await fallback.innerText(), /Reload this page later/);
    await page.bringToFront();
  } catch (error) {
    await context.close();
    throw error;
  }
  return async () => {
    try {
      assert.ok(
        await manual
          .getByRole("heading", { name: "Preparing recording" })
          .isVisible(),
      );
      assert.deepEqual(checks, []);
      await manual.reload();
      assert.ok(await manual.locator("video[controls]").isVisible());
    } finally {
      await context.close();
    }
  };
}
