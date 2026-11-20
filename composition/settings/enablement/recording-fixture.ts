import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RecordingState } from "../../../record/settings/recording-contract";

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
    const page = context.pages()[0];
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

export function recordingFixture(send: (message: object) => void) {
  const linuxState: RecordingState = {
    platform: "linux",
    microphone: {
      selected: "default",
      value: "System default",
      options: [{ id: "default", title: "System default", enabled: true }],
      note: null,
      meter: "fixture-input",
    },
    transcriber: {
      engine: "apple",
      hexTitle: "Hex (not running)",
      hexEnabled: false,
      language: "en",
      appleLocale: "auto",
      models: [],
      command: null,
    },
    speech: { state: "ready", progress: 1 },
    lowerPlayback: false,
    playbackLevel: 20,
    playbackAvailable: false,
    videoExport: false,
    doubleShiftNotes: true,
    mediaWarnings: [],
  };
  const state = structuredClone(linuxState);

  const fixture = {
    refuse: false,
    pickerSupported: false,
    autoPasteSupported: false,
    autoPasteSaved: false,
    show() {
      send({ type: "recording-state", state });
    },
    linux() {
      Object.assign(state, structuredClone(linuxState), {
        videoExport: state.videoExport,
        doubleShiftNotes: state.doubleShiftNotes,
      });
      fixture.show();
    },
    mac() {
      state.platform = "macos";
      state.playbackAvailable = true;
      state.lowerPlayback = true;
      state.speech = {
        state: "downloading",
        locale: "en_US",
        locales: ["en_US", "nl_NL"],
        progress: 0.4,
      };
      fixture.show();
    },
    hex() {
      state.microphone.meter = null;
      state.transcriber.engine = "hex";
      state.transcriber.hexTitle = "Hex";
      state.transcriber.hexEnabled = true;
      state.transcriber.models = [
        { id: "fixture-model", title: "Test model", chosen: true },
      ];
      fixture.show();
    },
    receive(action: Record<string, unknown>) {
      if (action.action === "navigate") {
        send({ type: "show", pane: action.pane });
        if (action.pane === "recording") fixture.show();
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
              platform: "wayland",
              rows: [
                {
                  permission: "accessibility",
                  status: "denied",
                  required: false,
                  relaunch: false,
                  repair: "copy-input",
                },
              ],
            },
          });
      }
      if (action.action === "labs-preference") {
        if (
          action.setting === "autoPaste" &&
          typeof action.enabled === "boolean"
        )
          fixture.autoPasteSaved = action.enabled;
        send({
          type: "labs-result",
          request: action.request,
          facts: {
            saved: false,
            screenPickerSaved: false,
            screenPickerSupported: fixture.pickerSupported,
            autoPasteSupported: fixture.autoPasteSupported,
            autoPasteSaved: fixture.autoPasteSaved,
            sharingSaved: false,
            wisprSupported: false,
          },
        });
      }
      if (action.action === "recording-preference") {
        if (!fixture.refuse && action.key === "videoExport") {
          state.videoExport = Boolean(action.value);
          fixture.show();
        }
        if (!fixture.refuse && action.key === "doubleShiftNotes") {
          state.doubleShiftNotes = Boolean(action.value);
          fixture.show();
        }
        send({
          type: "recording-result",
          request: action.request,
          ok: !fixture.refuse,
        });
      }
      if (action.action === "recording-meter" && action.visible) {
        send({ type: "recording-level", level: 0.45 });
      }
    },
  };
  return fixture;
}
