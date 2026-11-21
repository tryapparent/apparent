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
const warning = "May install an earlier version.";
const channelDescription =
  "Stable is for everyday use. Development gets changes sooner and may be less reliable.";
const stagedStable = "Restart to use Stable v2.0.0.";
const unconfirmed =
  "Apparent couldn’t confirm an installed update. To try again, install from the selected channel.";

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
      {
        linux = true,
        restartPending = false,
        stagedRelease = null,
        updateChannel = "stable",
        updates = true,
      }: {
        linux?: boolean;
        restartPending?: boolean;
        stagedRelease?: { channel: string; id: string } | null;
        updateChannel?: string;
        updates?: boolean;
      } = {},
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
          updates,
          mainUpdates: linux,
          updateChannel,
          restartPending,
          stagedRelease,
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
    const channel = page.getByRole("combobox", { name: "Next install source" });
    const install = page.getByRole("button", { name: "Check for updates", exact: true });
    const checkAgain = page.getByRole("button", { name: "Check again", exact: true });
    const restart = page.getByRole("button", { name: "Restart now" });
    const frog = page.locator(".settings-update-pond");
    const proof = process.env.APPARENT_SETTINGS_PROOF;
    if (proof) await mkdir(proof, { recursive: true });

    for (const width of [920, 720, 640]) {
      await application.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setResizable(true);
        window.setSize(size, 600);
      }, width);
      await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, 600]);
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
        await expect(install).toBeVisible();
        await expect(page.getByText(warning)).toHaveCount(0);
        await expect(channel.locator("option[value=main]")).toHaveText("Development builds");
        await expect(channel).toHaveAccessibleDescription(channelDescription);
        await expect(page.locator("#update-channel-description")).toBeHidden();
        await page.evaluate(() => document.fonts.ready.then(() => {}));
        await page.locator(".settings-content").evaluate((el) => {
          el.scrollTop = 0;
        });
        await expect(install).toBeInViewport({ ratio: 1 });
        assert.equal((await install.boundingBox())?.width, (await channel.boundingBox())?.width);
        await capture("idle");
        await page.getByRole("button", { name: "Copy version" }).focus();
        await page.keyboard.press("Tab");
        await expect(install).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(channel).toBeFocused();
        await expect(page.getByRole("tooltip")).toContainText(channelDescription);
        await page.keyboard.press("Shift+Tab");
        await expect(install).toBeFocused();
        await pressForAction("check-for-updates");

        await publish(checking);
        await expect(
          page.getByRole("heading", { name: "Checking for updates…" }),
        ).toBeVisible();
        await expect(install).toHaveCount(0);
        await expect(channel).toBeDisabled();
        await expect(restart).toHaveCount(0);
        await capture("checking");

        await publish({ checking: false, result: "current" });
        await expect(page.getByRole("heading", { name: "Already up to date" })).toBeVisible();
        await expect(install).toHaveCount(0);
        await expect(channel).toBeEnabled();
        await expect(checkAgain).toBeEnabled();
        assert.equal((await checkAgain.boundingBox())?.width, (await channel.boundingBox())?.width);
        await capture("current");
        await checkAgain.focus();
        await pressForAction("check-for-updates");
        await publish(checking);
        await expect(checkAgain).toHaveCount(0);
        await publish({ checking: false, result: "current" });
        await expect(checkAgain).toBeVisible();
        await channel.focus();
        await page.keyboard.press("Tab");
        await expect(frog).toBeFocused();
        const currentStart = output.length;
        await page.keyboard.press("Escape");
        await channel.selectOption("main");
        await expect.poll(() => output.slice(currentStart)).toContain(
          '"action":"set","key":"updateChannel","value":"main"',
        );
        assert.doesNotMatch(output.slice(currentStart), /dismiss-update-check|check-for-updates/);
        await publish(idle, { updateChannel: "main" });
        await expect(install).toBeVisible();
        await install.focus();
        await pressForAction("check-for-updates");

        const offered = { checking: false, result: "available" };
        const pending = {
          restartPending: true,
          stagedRelease: { channel: "stable", id: "v2.0.0" },
        };
        await publish({ checking: false, result: "current" }, pending);
        await expect(restart).toBeVisible();
        await publish(offered, pending);
        await expect(page.getByRole("heading", { name: "Restart required" })).toHaveCount(0);
        await expect(page.locator(".settings-updates [role=status]")).toHaveText("Restart required");
        await expect(restart).toHaveAccessibleDescription(stagedStable);
        await capture("restart");
        await expect(page.getByRole("button", { name: "Restart later" })).toHaveCount(0);
        await page.getByRole("button", { name: "Copy version" }).focus();
        await page.keyboard.press("Tab");
        await expect(restart).toBeFocused();
        await expect(page.getByRole("tooltip")).toHaveText(stagedStable);
        await page.keyboard.press("Tab");
        await expect(channel).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(frog).toBeFocused();
        const sparkle = frog.locator(".settings-frog-sparkle");
        await page.keyboard.press("Space");
        await expect(sparkle).toHaveAttribute("data-side", "right");
        await frog.click();
        await expect(sparkle).toHaveAttribute("data-side", "left");
        await capture("frog-reaction");
        await channel.focus();
        const changeStart = output.length;
        if (process.platform === "linux") await page.keyboard.press("ArrowDown");
        else await channel.selectOption("main");
        await expect.poll(() => output.slice(changeStart)).toContain(
          '"action":"set","key":"updateChannel","value":"main"',
        );
        assert.doesNotMatch(output.slice(changeStart), /check-for-updates|update-now/);
        const changedChannelWhilePending = { ...pending, updateChannel: "main" };
        await publish(idle, changedChannelWhilePending);
        await expect(channel).toHaveValue("main");
        await expect(install).toHaveCount(0);
        await expect(restart).toHaveAccessibleDescription(stagedStable);
        await capture("restart-after-channel-change");
        await page.keyboard.press("Shift+Tab");
        await expect(restart).toBeFocused();
        await pressForAction("update-now");

        const restartFailed = {
          checking: false,
          result: "failed",
          failure: "restart",
        };
        await publish(restartFailed, changedChannelWhilePending);
        const restartError = page.getByRole("alertdialog", {
          name: "Couldn’t restart Apparent",
        });
        await expect(
          restartError.getByRole("button", { name: "Retry restart" }),
        ).toBeFocused();
        await expect(restartError).toHaveAccessibleDescription(
          `${stagedStable} After closing, use Restart now in About.`,
        );
        await capture("restart-failure");
        await pressForAction("update-now");
        if (width === 640) {
          await page.keyboard.press("Tab");
          await expect(restartError.getByRole("button", { name: "Close" })).toBeFocused();
          await pressForAction("dismiss-update-check");
        } else {
          await pressForAction("dismiss-update-check", "Escape");
        }
        await publish(idle, changedChannelWhilePending);
        await expect(restartError).toBeHidden();
        await expect(restart).toBeFocused();
        await expect(restart).toHaveAccessibleDescription(stagedStable);
        await capture("restart-dismissed");
        await pressForAction("update-now");
        await publish(idle, {
          restartPending: true,
          stagedRelease: { channel: "main", id: "a".repeat(40) },
        });
        await expect(restart).toHaveAccessibleDescription(
          "Restart to use Development build aaaaaaaa.",
        );
        await expect(channel).toHaveValue("stable");
        await capture("restart-development-source-stable");
        await publish(idle, { updateChannel: "main" });
        await expect(channel).toHaveValue("main");
        await expect(restart).toHaveCount(0);
        await expect(install).toBeVisible();
        await capture("development");
        await publish(offered);
        await expect(channel).toHaveValue("stable");
        await expect(restart).toHaveCount(0);
        for (const updateChannel of ["stable", "main"]) {
          await publish(restartFailed, { updateChannel });
          await expect(restartError).toBeHidden();
          await expect(page.getByRole("alert")).toHaveText(unconfirmed);
          await expect(install).toHaveAccessibleDescription(unconfirmed);
          await channel.focus();
          await page.keyboard.press("Shift+Tab");
          await expect(install).toBeFocused();
          await expect(install).toBeInViewport({ ratio: 1 });
          await capture(`restart-without-receipt-${updateChannel}`);
          await pressForAction("check-for-updates");
        }

        await publish(idle, { updates: false });
        await expect(page.getByRole("heading", { name: "Updates unavailable" })).toBeVisible();
        await expect(channel).toHaveCount(0);
        await expect(install).toBeDisabled();
        await expect(restart).toHaveCount(0);
        await capture("unavailable");

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
        const errorFrog = verification.getByRole("button", { name: "Boop the frog" });
        await errorFrog.click();
        await expect(errorFrog.locator(".settings-frog-sparkle")).toBeVisible();
        await expect(frog).toBeHidden();
        await capture("error-frog");
        await verification.getByRole("button", { name: "Retry update" }).focus();
        await pressForAction("check-for-updates");
      }
    }
    await publish(idle, { linux: false });
    await expect(
      page.getByRole("button", { name: "Check for updates" }),
    ).toBeVisible();

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await publish(idle);
    const pond = frog;
    const video = pond.locator("video");
    const pose = pond.locator("img");
    await expect(pose).toHaveAttribute("src", /\/idle-.*\.webp$/);
    await expect(page.locator("header").getByRole("button", { name: "Show welcome tour" })).toBeVisible();
    await channel.hover();
    await expect(page.getByRole("tooltip")).toContainText(channelDescription);
    const hoverActionStart = output.length;
    await install.click();
    await expect.poll(() => output.slice(hoverActionStart)).toContain('"action":"check-for-updates"');
    await publish(checking);
    await expect(video).toHaveAttribute("src", /\/check-.*\.mp4$/);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) =>
      element.currentTime > 0 && element.videoWidth === 540 && element.textTracks.length === 0,
    )).toBe(true);
    await expect(pond.locator('video[src*="/check-"]')).toHaveJSProperty("ended", true);
    await publish({ checking: false, result: "current" });
    await expect(page.getByRole("heading", { name: "Already up to date" })).toBeVisible();
    await expect(video).toHaveAttribute("src", /\/open-box-.*\.mp4$/);
    await expect(pose).toHaveAttribute("src", /\/boat-.*\.webp$/);
    await expect(video).toHaveAttribute("src", /\/launch-.*\.mp4$/);
    await expect(video).toHaveAttribute("src", /\/afloat-.*\.mp4$/);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) =>
      element.loop && element.currentTime > 0,
    )).toBe(true);

    await publish({
      ...checking,
      progress: { phase: "downloading", downloadedBytes: 42, totalBytes: 100 },
    });
    const bar = page.getByRole("progressbar", { name: "Update download" });
    await expect(bar).toHaveAttribute("value", "42");
    const sparkle = pond.locator(".settings-frog-sparkle");
    await pond.click();
    await expect(sparkle).toHaveAttribute("data-side", "right");
    await pond.click();
    await expect(sparkle).toHaveAttribute("data-side", "left");
    await expect(pose).toHaveAttribute("src", /\/fold-flat-.*\.webp$/);
    await expect(pose).toHaveAttribute("src", /\/fold-(creased|pinched)-.*\.webp$/);
    await expect(video).toHaveCount(0);
    await publish({ ...checking, progress: { phase: "verifying" } });
    await expect(bar).toHaveCount(0);
    await expect(pose).toHaveAttribute("src", /\/fold-creased-.*\.webp$/);
    await publish({ checking: false, result: "available" }, { restartPending: true });
    await expect(restart).toBeVisible();
    await expect(video).toHaveAttribute("src", /\/launch-.*\.mp4$/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(video).toHaveCount(0);
    await expect(pose).toHaveAttribute("src", /\/afloat-.*\.webp$/);
  } finally {
    await application.close();
    await rm(home, { recursive: true, force: true });
  }
});
