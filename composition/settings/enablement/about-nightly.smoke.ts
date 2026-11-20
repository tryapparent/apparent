import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(
  new URL("../../../capture/desktop/ui/frontend/", import.meta.url),
);
const load = createRequire(join(frontend, "package.json"));
const { _electron: electron, expect } = load("@playwright/test");

test("Stable Mac About shows the Nightly download and Nightly identifies its own build", async () => {
  const home = await mkdtemp(join(tmpdir(), "apparent-dev-nightly-about-"));
  const application = await electron.launch({
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, "config") },
    args: [frontend, "--settings-storage", "--settings-about"],
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("Loading update status…")).toBeVisible();
    const publish = (mac: boolean, nightly = false, checking = false) =>
      application.evaluate(
        ({ BrowserWindow }, state) => {
          BrowserWindow.getAllWindows()[0].webContents.send(
            "apparent:about-state",
            state,
          );
        },
        {
          type: "about-state",
          version: "1.2.3 · a1b2c3d",
          mac,
          nightly,
          updates: true,
          linux: !mac,
          mainUpdates: !mac,
          updateChannel: "stable",
          updateCheck: { checking, result: null },
        },
      );
    await publish(false);
    const action = page.getByRole("button", { name: "Download Nightly" });
    await expect(action).toHaveCount(0);
    await publish(true);
    for (const width of [720, 640]) {
      await application.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setResizable(true);
        window.setSize(size, 530);
      }, width);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await action.focus();
        await expect(action).toBeFocused();
        const linkColors = await page
          .locator(".settings-nightly-download, .settings-support a, .settings-links a")
          .evaluateAll((links) => links.map((link) => {
            const { color, transitionDuration } = getComputedStyle(link);
            return [color, transitionDuration];
          }));
        const foreground = colorScheme === "dark" ? "rgb(245, 240, 232)" : "rgb(2, 1, 2)";
        assert.deepEqual(linkColors, Array.from({ length: 5 }, () => [foreground, "0s"]));
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const evidence = process.env.APPARENT_SETTINGS_PROOF;
        if (evidence) {
          await mkdir(evidence, { recursive: true });
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
          });
          await page.screenshot({
            path: join(evidence, `mac-nightly-${width}-${colorScheme}.png`),
          });
        }
      }
    }
    await publish(true, false, true);
    await expect(action).toBeDisabled();
    await publish(true);
    await application.evaluate(() => {
      globalThis.fetch = async () => new Response("", { status: 404 });
    });
    await action.press("Enter");
    await expect(page.getByRole("alert")).toHaveText(
      "Nightly download unavailable. Try again later.",
    );
    await publish(true, true);
    await expect(
      page.getByRole("heading", { name: "apparent Nightly" }),
    ).toBeVisible();
    await expect(page.getByText("Version 1.2.3 · a1b2c3d")).toBeVisible();
    await expect(action).toHaveCount(0);
  } finally {
    await application.close();
    await rm(home, { recursive: true, force: true });
  }
});
