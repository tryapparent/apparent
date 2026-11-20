import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { recordingFixture } from "./recording-fixture.ts";

const frontend = fileURLToPath(
  new URL("../../../capture/desktop/ui/frontend/", import.meta.url),
);
const loadFrontendDependency = createRequire(join(frontend, "package.json"));
const { chromium, expect } = loadFrontendDependency("@playwright/test");

test("staged Recording opens directly, receives native facts and saves only on its active route", {
  timeout: 45_000,
}, async () => {
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
  const fixture = recordingFixture(send);
  const actions: Record<string, unknown>[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const action = JSON.parse(line);
    actions.push(action);
    if (action.action === "navigate") send({ type: "show", pane: action.pane });
    fixture.receive(action);
  });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
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
    await expect(page).toHaveTitle("Apparent Settings — Recording");
    await expect(page.getByRole("status")).toHaveText(
      "Loading recording settings…",
    );
    fixture.show();
    const input = page.getByRole("combobox", { name: "Input", exact: true });
    await expect(input).toBeVisible();
    await expect(page.getByRole("meter")).toHaveAttribute(
      "aria-valuenow",
      "45",
    );
    await expect(
      page.getByRole("combobox", { name: "Lower to" }),
    ).toBeDisabled();
    const volume = page.getByRole("switch", {
      name: "Lower volume while recording",
    });
    await expect(volume).toBeDisabled();
    const session = await context.newCDPSession(page);
    const video = page.getByRole("switch", { name: "Video export" });
    const wordmark = page.getByRole("img", { name: "Apparent", exact: true });
    for (const width of [720, 640]) {
      for (const colorScheme of ["light", "dark"]) {
        await session.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 530,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        const expectedLeft =
          width === 720 ? 24 : process.platform === "darwin" ? 88 : 16;
        assert.equal((await wordmark.boundingBox())?.x, expectedLeft);
        await input.focus();
        await expect(input).toBeFocused();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const proof = process.env.APPARENT_RECORDING_PROOF;
        if (proof) {
          await mkdir(proof, { recursive: true });
          await page.screenshot({
            path: join(proof, `recording-${width}-${colorScheme}.png`),
          });
          await video.focus();
          await page.screenshot({
            path: join(proof, `volume-export-${width}-${colorScheme}.png`),
          });
          await input.focus();
        }
      }
    }
    fixture.refuse = true;
    await video.press("Space");
    const error = page.getByRole("alertdialog", {
      name: "Couldn’t confirm the recording preference",
    });
    await expect(error).toBeVisible();
    await expect(video).not.toBeChecked();
    fixture.refuse = false;
    await error.getByRole("button", { name: "Try again" }).press("Enter");
    await expect(error).not.toBeVisible();
    await expect(video).toBeChecked();
    await expect(video).toBeFocused();

    fixture.mac();
    await expect(
      page.getByRole("combobox", { name: "Language" }),
    ).toBeVisible();
    await expect(
      page.getByText("Downloading the speech model… 40%"),
    ).toBeVisible();
    await expect(page.getByRole("slider", { name: "Lower to" })).toBeEnabled();
    fixture.hex();
    await expect(
      page.getByRole("textbox", { name: "Hex language" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Hex model" }),
    ).toBeVisible();
    await expect(page.getByRole("meter")).toHaveCount(0);
    await expect
      .poll(() =>
        actions.some(
          (action) =>
            action.action === "recording-meter" && action.visible === false,
        ),
      )
      .toBe(true);

    const startUrl = page.url();
    const navigate = async (pane: string) => {
      await page
        .getByRole("button", { name: /^Settings pages,/ })
        .press("Enter");
      await page
        .getByRole("button", { name: pane, exact: true })
        .press("Enter");
      await expect(page).toHaveTitle(`Apparent Settings — ${pane}`);
    };
    await navigate("General");
    assert.equal(
      await page.evaluate(async () => {
        try {
          await Reflect.get(window, "apparentRecording").save({
            key: "videoExport",
            value: false,
          });
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    await navigate("Recording");
    assert.equal(page.url(), startUrl);
    await expect(video).toBeChecked();
    const notes = page.getByRole("switch", {
      name: "Double-tap Shift for notes",
    });
    await expect(notes).toBeChecked();
    await notes.press("Space");
    await expect(notes).not.toBeChecked();
    await navigate("Labs");
    await expect(notes).toHaveCount(0);
    await navigate("Recording");
    await expect(notes).not.toBeChecked();
  } finally {
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
});
