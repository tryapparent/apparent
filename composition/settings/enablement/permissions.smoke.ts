import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  PermissionBridge,
  PermissionState,
} from "../../../record/settings/permissions/permissions-contract.ts";

const frontend = fileURLToPath(
  new URL("../../../capture/desktop/ui/frontend/", import.meta.url),
);
const load = createRequire(join(frontend, "package.json"));
const { chromium, expect } = load("@playwright/test");

const mac: PermissionState = {
  platform: "macos",
  rows: [
    {
      permission: "screen-recording",
      status: "granted",
      required: true,
      relaunch: true,
      repair: "none",
    },
    {
      permission: "microphone",
      status: "denied",
      required: true,
      relaunch: false,
      repair: "open-settings",
    },
    {
      permission: "accessibility",
      status: "not-determined",
      required: true,
      relaunch: false,
      repair: "request",
    },
    {
      permission: "camera",
      status: "unavailable",
      required: false,
      relaunch: false,
      repair: "none",
    },
  ],
};
const wayland: PermissionState = {
  platform: "wayland",
  rows: [
    {
      permission: "microphone",
      status: "granted",
      required: false,
      relaunch: false,
      repair: "none",
    },
    {
      permission: "accessibility",
      status: "denied",
      required: false,
      relaunch: false,
      repair: "copy-input",
    },
  ],
};

test("Permissions shares the Recording window and recovers from refused actions", {
  timeout: 50_000,
}, async () => {
  const home = await mkdtemp(join(tmpdir(), "permissions-pane-"));
  const stage = process.env.APPARENT_PERMISSIONS_STAGE;
  const runtime = stage
    ? join(
        stage,
        process.platform === "darwin"
          ? "runtime/Electron.app/Contents/MacOS/Electron"
          : "runtime/electron",
      )
    : load("electron");
  const child = spawn(
    runtime,
    [
      "--no-sandbox",
      stage ? join(stage, "app") : frontend,
      "--settings-storage",
      "--settings-recording",
      "--settings-parent",
      "--remote-debugging-port=0",
    ],
    {
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, "config"),
        ELECTRON_RUN_AS_NODE: "",
      },
      stdio: "pipe",
    },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const send = (message: object) =>
    child.stdin.write(JSON.stringify(message) + "\n");
  const publish = (state: PermissionState) =>
    send({ type: "permission-state", state });
  const replies: { request: number; intent: unknown }[] = [];
  let facts = mac;
  let answer: string | null = null;
  let hold = false;
  const acknowledge = (request: number) =>
    send({ type: "permission-result", request, error: answer });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const action = JSON.parse(line);
    if (action.action === "navigate") {
      send({ type: "show", pane: action.pane });
      if (action.pane === "permissions") publish(facts);
    }
    if (action.action === "permission-action") {
      replies.push(action);
      if (!hold) acknowledge(action.request);
    }
  });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = stderr.match(
          /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/,
        );
        if (match) resolve(match[1]);
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(Error(`Settings exited ${code}: ${stderr.slice(-1000)}`)),
      );
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    await expect(page).toHaveTitle("Apparent Settings — Recording");
    await assert.rejects(
      page.evaluate(() =>
        (
          window as Window & { apparentPermissions: PermissionBridge }
        ).apparentPermissions.act({ kind: "recheck" }),
      ),
    );
    await page
      .getByRole("button", { name: "Permissions", exact: true })
      .click();
    await expect(page).toHaveTitle("Apparent Settings — Permissions");
    const recheck = page.getByRole("button", { name: "Recheck" });
    const reopen = page.getByRole("button", {
      name: "Reopen Apparent · Screen Recording",
    });
    const microphone = page.getByRole("button", {
      name: "Open System Settings · Microphone",
    });
    const accessibility = page.getByRole("button", {
      name: "Allow · Accessibility",
    });
    const session = await context.newCDPSession(page);
    await page.evaluate(() => document.fonts.ready);
    for (const width of [720, 640]) {
      for (const colorScheme of ["light", "dark"]) {
        await session.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 530,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await page.emulateMedia({ colorScheme });
        await recheck.focus();
        await page.keyboard.press("Tab");
        await expect(reopen).toBeFocused();
        assert.equal(
          await page.evaluate(
            () =>
              document.querySelector("main")!.scrollWidth <=
              document.querySelector("main")!.clientWidth,
          ),
          true,
        );
        const evidence = process.env.APPARENT_PERMISSIONS_EVIDENCE;
        if (evidence) {
          await recheck.focus();
          await page.screenshot({
            path: join(evidence, `permissions-${width}-${colorScheme}.png`),
          });
        }
      }
    }
    await expect(page.getByText("Denied", { exact: true })).toHaveCount(1);
    await expect(
      page.getByText("Checking access…", { exact: true }),
    ).toHaveCount(1);
    await assert.rejects(
      page.evaluate(() =>
        (
          window as Window & { apparentPermissions: PermissionBridge }
        ).apparentPermissions.act({
          kind: "repair",
          permission: "input-monitoring" as "microphone",
          repair: "request",
        }),
      ),
    );
    hold = true;
    await recheck.focus();
    await page.keyboard.press("Enter");
    await expect(recheck).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect.poll(() => replies.length).toBe(1);
    acknowledge(replies[0].request + 1);
    await expect(recheck).toHaveAttribute("aria-disabled", "true");
    acknowledge(replies[0].request);
    await expect(page.getByRole("status")).toHaveText("Access checked.");
    hold = false;

    answer = "capture-active";
    await reopen.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Finish or cancel");
    assert.deepEqual(replies.at(-1)?.intent, { kind: "reopen" });
    answer = null;
    await microphone.press("Enter");
    await expect.poll(() => replies.length).toBe(3);
    await expect(microphone).toHaveAttribute("aria-disabled", "false");
    assert.deepEqual(replies.at(-1)?.intent, {
      kind: "repair",
      permission: "microphone",
      repair: "open-settings",
    });

    hold = true;
    await accessibility.press("Enter");
    await expect(accessibility).toHaveAttribute("aria-disabled", "true");
    publish({
      ...mac,
      rows: mac.rows.map((row) =>
        row.permission === "accessibility"
          ? { ...row, status: "granted", repair: "none" }
          : row,
      ),
    });
    await expect(accessibility).toHaveCount(0);
    await expect.poll(() => replies.length).toBe(4);
    answer = "changed";
    acknowledge(replies.at(-1)!.request);
    await expect(page.getByRole("alert")).toContainText("Access changed");
    await expect(recheck).toBeFocused();

    hold = false;
    answer = null;
    publish(mac);
    await accessibility.press("Enter");
    await expect(accessibility).toHaveAttribute("aria-disabled", "false");
    publish({
      ...mac,
      rows: mac.rows.map((row) =>
        row.permission === "accessibility"
          ? { ...row, status: "granted", repair: "none" }
          : row,
      ),
    });
    await expect(recheck).toBeFocused();

    await page
      .getByRole("button", { name: "Settings pages, Permissions" })
      .press("Enter");
    await page
      .getByRole("button", { name: "Recording", exact: true })
      .press("Enter");
    await expect(page).toHaveTitle("Apparent Settings — Recording");
    assert.equal(context.pages().length, 1);
    await assert.rejects(
      page.evaluate(() =>
        (
          window as Window & { apparentPermissions: PermissionBridge }
        ).apparentPermissions.act({ kind: "reopen" }),
      ),
    );
    facts = wayland;
    hold = false;
    answer = null;
    await page
      .getByRole("button", { name: "Settings pages, Recording" })
      .press("Enter");
    await page
      .getByRole("button", { name: "Permissions", exact: true })
      .press("Enter");
    await expect(
      page.getByText("Wayland asks what to share when you start recording."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Screen Recording" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Copy command · Input devices" })
      .press("Enter");
    await expect(page.getByRole("status")).toContainText("Command copied");
    assert.deepEqual(replies.at(-1)?.intent, {
      kind: "repair",
      permission: "accessibility",
      repair: "copy-input",
    });
    send({ type: "close" });
    assert.equal(await exited, 0);
  } finally {
    child.kill();
    await browser?.close().catch(() => {});
    await exited;
    await rm(home, { recursive: true, force: true });
  }
});
