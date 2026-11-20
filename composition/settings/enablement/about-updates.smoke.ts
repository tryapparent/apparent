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
const warning =
  "Installs the latest release from this channel, which may be an earlier version.";
const version = "Version 1.2.3 · a1b2c3d +modified";

test("About makes channel installation, restart and recovery distinct", async () => {
  const home = await mkdtemp(join(tmpdir(), "apparent-dev-about-updates-"));
  const application = await electron.launch({
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, "config") },
    args: [frontend, "--settings-storage", "--settings-about"],
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("Loading update status…")).toBeVisible();
    let output = "";
    application.process().stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });
    const publish = (
      updateCheck: object,
      { linux = true, restartPending = false, updateChannel = "stable" } = {},
    ) =>
      application.evaluate(
        ({ BrowserWindow }, value) => {
          BrowserWindow.getAllWindows()[0].webContents.send(
            "apparent:about-state",
            value,
          );
        },
        {
          type: "about-state",
          version: "1.2.3 · a1b2c3d +modified",
          linux,
          mac: !linux,
          updates: true,
          mainUpdates: linux,
          updateChannel,
          restartPending,
          updateCheck,
        },
      );
    const idle = { checking: false, result: null };
    const checking = { checking: true, result: null };
    const pressForAction = async (action: string, key = "Enter") => {
      const start = output.length;
      await page.keyboard.press(key);
      await expect
        .poll(() => output.slice(start).includes(`"action":"${action}"`))
        .toBe(true);
    };
    const channel = page.getByRole("combobox", { name: "Release channel" });
    const install = page.getByRole("button", {
      name: "Install latest release",
    });
    const restart = page.getByRole("button", { name: "Restart now" });
    const proof = process.env.APPARENT_SETTINGS_PROOF;
    if (proof) await mkdir(proof, { recursive: true });

    for (const width of [720, 640]) {
      await application.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setResizable(true);
        window.setSize(size, 600);
      }, width);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      for (const colorScheme of ["light", "dark"] as const) {
        const capture = async (phase: string) => {
          const content = page.locator(".settings-content");
          assert.equal(
            await content.evaluate((el) => el.scrollWidth <= el.clientWidth),
            true,
          );
          if (proof)
            await page.screenshot({
              animations: "disabled",
              path: join(proof, `release-${phase}-${width}-${colorScheme}.png`),
            });
        };
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await publish(idle);
        await expect(install).toHaveAccessibleDescription(warning);
        await expect(channel.locator("option[value=main]")).toHaveText("Development builds");
        await page.evaluate(() => document.fonts.ready.then(() => {}));
        await page.locator(".settings-content").evaluate((el) => {
          el.scrollTop = 0;
        });
        await capture("idle");
        await page.getByRole("button", { name: "Copy version" }).focus();
        await page.keyboard.press("Tab");
        await expect(channel).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(install).toBeFocused();
        await pressForAction("check-for-updates");

        await publish(checking);
        await expect(
          page.getByRole("button", { name: "Checking…" }),
        ).toBeDisabled();
        await expect(channel).toBeDisabled();
        await expect(restart).toHaveCount(0);
        await capture("checking");

        const offered = { checking: false, result: "available" };
        const pending = { restartPending: true };
        await publish(offered, pending);
        await expect(
          page.getByRole("heading", { name: "Restart required" }),
        ).toBeVisible();
        await expect(
          page.getByText("The channel release is installed."),
        ).toBeVisible();
        await expect(page.getByText(version)).toBeVisible();
        await expect(page.getByText(warning)).toHaveCount(0);
        await expect(install).toHaveCount(0);
        await capture("restart");
        const later = page.getByRole("button", { name: "Restart later" });
        await channel.focus();
        await page.keyboard.press("Tab");
        await expect(restart).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(later).toBeFocused();
        await pressForAction("update-later");
        await publish(idle, pending);
        await expect(later).toHaveCount(0);
        await expect(restart).toBeFocused();
        await capture("restart-later");
        await pressForAction("update-now");

        const restartFailed = {
          checking: false,
          result: "failed",
          failure: "restart",
        };
        await publish(restartFailed, pending);
        const restartError = page.getByRole("alertdialog", {
          name: "Couldn’t restart Apparent",
        });
        await expect(
          restartError.getByRole("button", { name: "Retry restart" }),
        ).toBeFocused();
        await expect(page.getByText(warning)).toHaveCount(0);
        await capture("restart-failure");
        await pressForAction("update-now");
        if (width === 640) {
          await page.keyboard.press("Tab");
          await expect(restartError.getByRole("button", { name: "Close" })).toBeFocused();
          await pressForAction("dismiss-update-check");
        } else {
          await pressForAction("dismiss-update-check", "Escape");
        }
        await publish(idle, pending);
        await expect(restartError).toBeHidden();
        await expect(restart).toBeFocused();
        await capture("restart-dismissed");
        await pressForAction("update-now");
        await publish(idle, { updateChannel: "main" });
        await expect(channel).toHaveValue("main");
        await expect(restart).toHaveCount(0);
        await expect(install).toBeVisible();
        await capture("development");
        await publish(offered);
        await expect(channel).toHaveValue("stable");
        await expect(restart).toHaveCount(0);
        await expect(later).toHaveCount(0);
        await publish(restartFailed);
        await expect(restartError).toBeHidden();
        await expect(install).toBeVisible();

        await publish({
          checking: false,
          result: "failed",
          failure: "download",
        });
        const downloadError = page.getByRole("alertdialog", {
          name: "Download failed",
        });
        const retry = downloadError.getByRole("button", { name: "Retry update" });
        await expect(retry).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(
          downloadError.getByRole("button", { name: "Close" }),
        ).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(retry).toBeFocused();
        await capture("download-failure");
        await pressForAction("check-for-updates");
        await publish({
          ...checking,
          progress: {
            phase: "downloading",
            downloadedBytes: 25,
            totalBytes: 100,
          },
        });
        await expect(
          page.getByRole("progressbar", { name: "Update download" }),
        ).toHaveAttribute("value", "25");
        await expect(downloadError).not.toBeVisible();
        await capture("download-retry");
        await publish({ checking: false, result: "failed", failure: "verification" });
        const verification = page.getByRole("alertdialog", {
          name: "Couldn’t verify the download",
        });
        await expect(verification.getByRole("button", { name: "Retry update" })).toBeFocused();
        await capture("verification-failure");
        await pressForAction("check-for-updates");
      }
    }
    await publish(idle, { linux: false });
    await expect(
      page.getByRole("button", { name: "Check for updates" }),
    ).toBeVisible();
    await expect(page.getByText(warning)).toHaveCount(0);
  } finally {
    await application.close();
    await rm(home, { recursive: true, force: true });
  }
});
