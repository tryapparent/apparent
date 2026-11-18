import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

test("trusted practice host drives the real renderer without accepting renderer facts", {
  timeout: 60000,
}, async (t) => {
  const frontend = fileURLToPath(
    new URL("../../../capture/desktop/ui/frontend/", import.meta.url),
  );
  const require = createRequire(path.join(frontend, "package.json"));
  const profile = await mkdtemp(path.join(tmpdir(), "practice-composition-"));
  const child = spawn(
    require("electron"),
    [
      path.join(frontend, "dist/composition/onboarding/entry.cjs"),
      "--assets-root",
      frontend,
      "--no-sandbox",
      "--remote-debugging-port=0",
    ],
    {
      env: { ...process.env, APPARENT_UI_PROFILE: profile },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.stdin.end();
      const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(timeout);
    }
    await browser?.close();
    await rm(profile, { recursive: true, force: true });
  });
  let output = "";
  child.stdout.on("data", (bytes) => (output += bytes));
  const endpoint = await new Promise<string>((resolve, reject) => {
    let log = "";
    const timeout = setTimeout(
      () => reject(Error("No Electron debugger endpoint")),
      10000,
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(Error(log));
    });
    child.stderr.on("data", (bytes) => {
      log += bytes;
      const found = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (found) {
        clearTimeout(timeout);
        resolve(found[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts()[0].pages()[0];
  const send = (value: unknown) =>
    child.stdin.write(JSON.stringify(value) + "\n");
  const evidence = process.env.APPARENT_ONBOARDING_EVIDENCE;
  const setup = (patch: Record<string, unknown>) =>
    send({
      type: "state",
      step: "welcome",
      rows: [],
      ready: true,
      platform: "linux",
      shortcut: "Ctrl+R",
      ...patch,
    });
  const capture = async (name: string) => {
    for (const width of [760, 320])
      for (const theme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 600 });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        assert.equal(
          await page
            .locator(".native-setup")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
          true,
        );
        if (evidence) {
          await mkdir(evidence, { recursive: true });
          await page.screenshot({
            path: path.join(
              evidence,
              name + "-" + theme + "-" + width + ".png",
            ),
          });
        }
      }
  };
  setup({});
  await expect(
    page.getByRole("heading", { name: "Where’s ur agent at?", exact: true }),
  ).toBeVisible();
  await capture("welcome");
  setup({ penPicker: true });
  await expect(
    page.getByRole("heading", { name: "Pick your pen.", exact: true }),
  ).toBeVisible();
  const back = page.getByRole("button", { name: "Back", exact: true });
  await back.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => output).toContain('"action":"back"');
  await capture("pen");
  setup({
    step: "permissions",
    ready: false,
    rows: [{ permission: "accessibility", status: "denied", required: true }],
  });
  await expect(page.getByText("Input devices", { exact: true })).toBeVisible();
  const copy = page.getByRole("button", { name: "Copy command", exact: true });
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => output)
    .toContain('"action":"grant","permission":"accessibility"');
  await expect(
    page.getByRole("button", { name: "Choose recording shortcut" }),
  ).toBeDisabled();
  await capture("permissions-denied");
  setup({
    step: "permissions",
    rows: [{ permission: "accessibility", status: "granted", required: true }],
  });
  await expect(
    page.getByRole("button", { name: "Choose recording shortcut" }),
  ).toBeEnabled();
  const repair = (status: string, extra: Record<string, boolean> = {}) =>
    setup({
      step: "permissions",
      platform: "macos",
      fix: true,
      ready: status === "granted" && !extra.relaunch && !extra.reopening,
      rows: [
        { permission: "screen-recording", status, required: true, ...extra },
      ],
    });
  repair("unavailable");
  await expect(page.getByText("Checking access…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Open Settings" })).toHaveCount(
    0,
  );
  await capture("repair-checking");
  repair("denied");
  const openSettings = page.getByRole("button", { name: "Open Settings" });
  await expect(openSettings).toBeVisible();
  await openSettings.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => output)
    .toContain('"action":"grant","permission":"screen-recording"');
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await capture("repair-denied");
  repair("granted", { reopening: true });
  await expect(page.getByText("Reopening apparent…")).toBeVisible();
  await capture("repair-reopening");
  repair("granted", { relaunch: true });
  await expect(
    page.getByRole("button", { name: "Reopen apparent" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();
  await capture("repair-relaunch");
  repair("granted");
  await expect(page.getByRole("button", { name: "Done" })).toBeEnabled();
  await capture("repair-restored");
  setup({
    step: "shortcut",
    shortcutEditing: true,
    shortcutEditor: { recording: true },
  });
  await expect(
    page.getByRole("heading", { name: "Choose your shortcut.", exact: true }),
  ).toBeVisible();
  await capture("shortcut");
  setup({
    step: "shortcut",
    shortcut: "Option",
    shortcutChosen: true,
    shortcutSelectionReleased: true,
    firstCaptureRequired: true,
  });
  await expect.poll(() => output).toContain("accept-shortcut-choice:Option");
  send({
    type: "state",
    step: "try-it",
    rows: [],
    ready: true,
    platform: "linux",
    shortcut: "Ctrl+R",
    penRgb: [217, 76, 68],
    practice: "start",
  });
  let sequence = 0;
  const batch = async (events: object[]) => {
    const id = String(++sequence);
    send({
      type: "practice-batch",
      version: 1,
      source: "1",
      transport: "2",
      attempt: "1",
      capture: "1",
      sequence: id,
      intent: events.some((event) => "action" in event) ? id : null,
      board: "owned-test-board",
      events,
    });
    await expect
      .poll(() =>
        output
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .some(
            (value) =>
              value.type === "practice-disposition" && value.sequence === id,
          ),
      )
      .toBe(true);
  };
  const stage = (name: string) =>
    expect(page.locator(".native-coach")).toHaveAttribute("data-stage", name);
  await batch([{ type: "reset" }, { type: "started" }]);
  await stage("whiteboard");
  await batch([
    { type: "whiteboard-visible", visible: true },
    { type: "ink", board: true, screen: 4 },
  ]);
  await stage("board-ink");
  await batch([
    { type: "ink", board: true, screen: 5 },
    { type: "whiteboard-visible", visible: false },
  ]);
  await stage("screen-ink");
  await expect(page.locator(".native-gesture-ink")).toHaveCSS(
    "stroke",
    "rgb(217, 76, 68)",
  );
  await batch([{ type: "ink", board: false, screen: 5 }]);
  await stage("screen-ink");
  await batch([{ type: "ink", board: false, screen: 6 }]);
  await stage("stop");
  for (const width of [380, 320])
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 540 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      assert.equal(
        await page
          .locator(".native-coach-content")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
        true,
      );
      const close = page.getByRole("button", {
        name: "Close guide",
        exact: true,
      });
      await close.focus();
      await expect(close).toBeFocused();
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await page.screenshot({
          path: path.join(evidence, `trusted-stop-${theme}-${width}.png`),
        });
      }
    }
  await batch([{ type: "processing" }, { type: "saved", copied: true }]);
  await stage("copied");
  assert.equal(
    await page.evaluate(async () => {
      const bridge = (
        window as unknown as {
          nativeOnboarding: { action(value: unknown): Promise<unknown> };
        }
      ).nativeOnboarding;
      try {
        await bridge.action({
          type: "practice-batch",
          events: [{ type: "opened-latest" }],
        });
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(() => output).toContain('"action":"practice-review"');
  await stage("copied");
  await batch([{ type: "action", action: "practice-review" }]);
  await stage("complete");
  await expect(
    page.getByRole("heading", { name: "Feel like customizing more?" }),
  ).toBeVisible();
  await expect(
    page.getByText("Open Settings from apparent’s tray icon."),
  ).toBeVisible();
  for (const width of [380, 320])
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 440 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      const close = page.getByRole("button", {
        name: "Finish setup",
        exact: true,
      });
      await close.focus();
      await expect(close).toBeFocused();
      await expect(close).toBeInViewport();
      if (evidence)
        await page.screenshot({
          path: path.join(evidence, `complete-${theme}-${width}.png`),
        });
    }
  await page.keyboard.press("Enter");
  await expect.poll(() => output).toContain('"action":"practice-finish"');
});
