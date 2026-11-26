import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordingFixture } from "../../../record/enablement/settings/recording-fixture.ts";

const frontend = fileURLToPath(
  new URL("../../../capture/desktop/ui/frontend/", import.meta.url),
);
const loadFrontendDependency = createRequire(join(frontend, "package.json"));
export const { chromium, expect } = loadFrontendDependency("@playwright/test");

export async function launchRecording() {
  const home = await mkdtemp(join(tmpdir(), "recording-pane-"));
  const stage = process.env.APPARENT_RECORDING_STAGE;
  const runtime = stage
    ? join(
        stage,
        process.platform === "darwin"
          ? "runtime/Electron.app/Contents/MacOS/Electron"
          : "runtime/electron",
      )
    : loadFrontendDependency("electron");
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
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  async function open() {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
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
    const page =
      context.pages()[0] ??
      (await context.waitForEvent("page", { timeout: 10_000 }));
    const session = await context.newCDPSession(page);
    async function setVariant(width: number, colorScheme: "light" | "dark") {
      await session.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 530,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.evaluate(() => document.fonts.ready);
      assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [
        width,
        530,
      ]);
    }
    return { page, setVariant };
  }
  async function close() {
    await browser?.close().catch(() => {});
    child.stdin.end();
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
    await rm(home, { recursive: true, force: true });
  }
  return { child, send, open, close };
}

export function settingsFixture(send: (message: object) => void) {
  const recording = recordingFixture(send);
  const fixture = {
    recording,
    refuseAutoPaste: false,
    pickerSupported: false,
    autoPasteSaved: true,
    receive(action: Record<string, unknown>) {
      if (action.action === "navigate") {
        send({ type: "show", pane: action.pane });
        if (action.pane === "recording") recording.show();
        if (action.pane === "general")
          send({
            type: "general-state",
            platform: "linux",
            login: { on: false, available: true, needsApproval: false },
            shortcuts: [
              {
                kind: "record",
                title: "Record",
                label: "F1",
                recording: false,
                externallyManaged: false,
                isDefault: true,
                clearable: false,
              },
            ],
            errorReporting: true,
          });
        if (action.pane === "permissions")
          send({
            type: "permission-state",
            state: {
              platform: fixture.pickerSupported ? "wayland" : "x11",
              accessChecked: true,
              screenSelection: fixture.pickerSupported
                ? "picker"
                : "unavailable",
              rows: [
                {
                  permission: fixture.pickerSupported
                    ? "accessibility"
                    : "microphone",
                  status: "denied",
                  required: false,
                  relaunch: false,
                  repair: fixture.pickerSupported ? "copy-input" : "none",
                },
              ],
            },
          });
      }
      if (action.action === "labs-preference") {
        send({
          type: "labs-result",
          request: action.request,
          facts: { saved: false, sharingSaved: false, wisprSupported: false },
        });
      }
      if (action.action === "handoff-auto-paste") {
        if (!fixture.refuseAutoPaste && typeof action.enabled === "boolean")
          fixture.autoPasteSaved = action.enabled;
        send({
          type: "handoff-auto-paste-result",
          request: action.request,
          enabled: fixture.refuseAutoPaste ? null : fixture.autoPasteSaved,
        });
      }
      recording.receive(action);
    },
  };
  return fixture;
}
