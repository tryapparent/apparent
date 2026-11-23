import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(
  new URL("../../../capture/desktop/ui/frontend/", import.meta.url),
);
const load = createRequire(path.join(frontend, "package.json"));
const { _electron: electron, expect } = load("@playwright/test");

for (const pane of ["About", "General"]) {
  test(`Settings opens at a fixed size from ${pane}`, async () => {
    const home = await mkdtemp(path.join(tmpdir(), "settings-window-"));
    try {
      const application = await electron.launch({
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: path.join(home, "config"),
          XDG_CACHE_HOME: path.join(home, "cache"),
        },
        args: [
          frontend,
          "--settings-storage",
          `--settings-${pane.toLowerCase()}`,
        ],
      });
      try {
        const page = await application.firstWindow();
        await expect(page).toHaveTitle(`Apparent Settings — ${pane}`);
        const options = await application.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          return {
            size: window.getContentSize(),
            resizable: window.isResizable(),
            fullscreenable: window.isFullScreenable(),
            ...(process.platform === "darwin"
              ? { maximizable: window.isMaximizable() }
              : {}),
          };
        });
        assert.deepEqual(options, {
          size: [740, 580],
          resizable: false,
          fullscreenable: false,
          ...(process.platform === "darwin" ? { maximizable: false } : {}),
        });
        if (pane === "About") {
          await application.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].webContents.send(
              "apparent:about-state",
              {
                type: "about-state",
                version: "1.2.3 · a1b2c3d +modified",
                updates: true,
                linux: true,
                mainUpdates: true,
                updateChannel: "main",
                updateCheck: { checking: false, result: "current" },
              },
            );
          });
          await expect(
            page.getByRole("heading", { name: "Already up to date" }),
          ).toBeVisible();
          for (const colorScheme of ["light", "dark"] as const) {
            await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
            await page.evaluate(() =>
              document.fonts.ready.then(() => undefined),
            );
            assert.equal(
              await page
                .locator(".settings-content")
                .evaluate((pane) => pane.scrollHeight <= pane.clientHeight),
              true,
              `About fits at the fixed size in ${colorScheme} mode`,
            );
          }
        }
      } finally {
        await application.close();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
}
