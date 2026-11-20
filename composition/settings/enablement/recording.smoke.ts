import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  expect,
  launchRecording,
  recordingFixture,
} from "./recording-fixture.ts";

test("staged Recording opens directly, receives native facts and saves only on its active route", {
  timeout: 60_000,
}, async () => {
  const { child, send, open, close } = await launchRecording();
  const fixture = recordingFixture(send);
  const actions: Record<string, unknown>[] = [];
  let heldT3: unknown;
  const disconnected = { saved: null, t3Saved: false, t3Configured: false };
  let t3Facts: typeof disconnected & {
    t3Connections?: { origin: string; expiresAt: number }[];
  } = disconnected;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const action = JSON.parse(line);
    actions.push(action);
    if (action.action === "agents-preference") {
      if (action.setting === "t3" && typeof action.enabled === "boolean") {
        heldT3 = action.request;
      } else {
        send({
          type: "agents-result",
          request: action.request,
          facts: t3Facts,
        });
      }
    }
    fixture.receive(action);
  });
  try {
    const browser = await open();
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    const proof = process.env.APPARENT_RECORDING_PROOF;
    if (proof) await mkdir(proof, { recursive: true });
    async function screenshot(name: string) {
      if (proof)
        await page.screenshot({
          path: join(proof, `${name}.png`),
          animations: "disabled",
        });
    }
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
        if (proof) {
          await screenshot(`recording-${width}-${colorScheme}`);
          await video.focus();
          await screenshot(`volume-export-${width}-${colorScheme}`);
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
    const language = page.getByRole("textbox", { name: "Hex language" });
    const apply = page.getByRole("button", { name: "Apply", exact: true });
    await expect(language).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Hex model" }),
    ).toBeVisible();
    for (const width of [720, 640]) {
      for (const theme of ["light", "dark"] as const) {
        await session.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 530,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => innerWidth), width);
        await language.focus();
        await expect(apply).toBeDisabled();
        await expect(apply).toBeInViewport({ ratio: 1 });
        await expect(apply).toHaveCSS("background-color", "rgb(245, 240, 232)");
        assert.notEqual(
          await apply.evaluate((el) => getComputedStyle(el).color),
          await apply.evaluate((el) => getComputedStyle(el).backgroundColor),
        );
        await screenshot(`hex-disabled-${width}-${theme}`);
        await language.fill("9");
        await expect(language).toHaveAttribute("aria-invalid", "true");
        await expect(page.getByText(/^Invalid code\./)).toBeInViewport();
        await expect(apply).toBeDisabled();
        await screenshot(`hex-invalid-${width}-${theme}`);
        await language.fill("nl");
        await page.keyboard.press("Tab");
        await expect(apply).toBeEnabled();
        await expect(apply).toHaveCSS("background-color", "rgb(183, 165, 216)");
        await expect(apply).toBeFocused();
        await expect(apply).toHaveCSS("outline-style", "solid");
        await screenshot(`hex-apply-focus-${width}-${theme}`);
        await language.fill("en");
      }
    }
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

    const index = page.getByRole("navigation", {
      name: "Jump to a setting",
    });
    async function openTask(label: string, heading: string) {
      await index
        .getByRole("button", { name: label, exact: true })
        .press("Enter");
      const target = page
        .getByText(heading, { exact: true })
        .and(page.locator("h1, h2, legend"));
      await expect(target).toBeFocused();
      await expect(target).toBeInViewport();
    }
    async function openRecording() {
      const compact = page.locator(".settings-navigation-compact");
      if (await compact.isVisible())
        await compact
          .getByRole("button", { name: /^Settings pages,/ })
          .press("Enter");
      await page
        .getByRole("button", { name: "Recording", exact: true })
        .press("Enter");
      await expect(index).toBeVisible();
      await expect(page.locator("h1")).toBeInViewport();
    }

    for (const width of [720, 640])
      for (const theme of ["light", "dark"] as const) {
        const variant = `${width}-${theme}`;
        await session.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 530,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => innerWidth), width);
        assert.equal(
          await page
            .locator(".settings-content")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
          true,
        );
        const videoJump = index.getByRole("button", { name: "Video export" });
        await expect(videoJump).toBeEnabled();
        await expect(videoJump).toBeInViewport();
        await expect(videoJump).toHaveCSS("opacity", "1");
        await expect(input).toBeInViewport({ ratio: 1 });
        const jumps = await index.getByRole("button").all();
        for (const jump of jumps) {
          const bounds = await jump.boundingBox();
          assert.ok(bounds && bounds.width >= 24 && bounds.height >= 36);
        }
        await screenshot(`index-${variant}`);

        await openTask("Change record shortcut", "Keyboard shortcuts");
        await page.keyboard.press("Tab");
        await expect(
          page.getByRole("button", {
            name: "Change Record shortcut, currently F1",
          }),
        ).toBeFocused();
        await screenshot(`shortcut-${variant}`);
        await openRecording();

        fixture.pickerSupported = theme === "light";
        await openTask("Screen selection", "When you press Record");
        const chooseScreen = page.getByRole("radio", {
          name: "Choose a screen each time",
        });
        if (fixture.pickerSupported) await expect(chooseScreen).toBeEnabled();
        else await expect(chooseScreen).toBeDisabled();
        await screenshot(`screen-selection-${variant}`);
        await openRecording();

        await openTask("Send to T3", "Send recordings to T3");
        const t3 = page.getByRole("switch", { name: "Enable sending to T3" });
        await expect(t3).toBeEnabled();
        await expect(t3).toHaveAccessibleDescription(
          /Pair a computer to send.*You choose what to send/,
        );
        await expect(
          page.getByRole("button", { name: "Connect T3", exact: true }),
        ).toBeEnabled();
        const steps = page.locator(".settings-t3-steps").getByRole("listitem");
        await expect(steps).toHaveText([
          /Connect a computer/,
          /Enable sending to T3/,
          /Choose a thread.*recording pill/,
        ]);
        await expect(t3).not.toBeChecked();
        await screenshot(`send-${variant}`);
        await openRecording();

        t3Facts = {
          ...disconnected,
          t3Configured: true,
          t3Connections: [
            { origin: "https://studio.example", expiresAt: 4_000_000_000_000 },
            { origin: "https://expired.example", expiresAt: 0 },
          ],
        };
        await openTask("Send to T3", "Send recordings to T3");
        await expect(
          page.getByRole("button", { name: "Add computer", exact: true }),
        ).toBeEnabled();
        await expect(
          page.getByText(
            "expired.example · Expired. Use Add computer to pair it again.",
          ),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Add computer", exact: true })
          .press("Enter");
        await expect(
          page.getByRole("dialog", { name: "Connect T3" }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("dialog", { name: "Connect T3" }),
        ).toHaveCount(0);
        await expect(t3).not.toBeChecked();
        await screenshot(`send-connected-off-${variant}`);
        heldT3 = undefined;
        await t3.press("Space");
        await expect.poll(() => heldT3).toBeDefined();
        await expect(t3).toHaveAttribute("aria-busy", "true");
        await expect(t3).toHaveCSS("cursor", "wait");
        await expect(
          page.getByRole("status").filter({
            hasText: "Saving the T3 sending preference…",
          }),
        ).toBeInViewport();
        await expect(t3).not.toBeChecked();
        await screenshot(`send-pending-${variant}`);
        send({
          type: "agents-result",
          request: heldT3,
          facts: { error: "config_write_failed" },
        });
        const t3Failure = page.getByRole("alertdialog", {
          name: "Unable to save T3 sending preference",
        });
        await expect(t3Failure).toBeVisible();
        await screenshot(`send-failure-${variant}`);
        const recover = t3Failure.getByRole("button", {
          name: "Refresh T3 sending",
        });
        await expect(recover).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(t3Failure).not.toBeVisible();
        await expect(t3).toBeEnabled();
        await expect(t3).toBeFocused();
        await screenshot(`send-recovered-${variant}`);
        heldT3 = undefined;
        await t3.press("Space");
        await expect.poll(() => heldT3).toBeDefined();
        t3Facts = { ...t3Facts, t3Saved: true };
        send({ type: "agents-result", request: heldT3, facts: t3Facts });
        await expect(t3).toBeChecked();
        await steps.last().scrollIntoViewIfNeeded();
        await screenshot(`send-connected-on-${variant}`);
        await page
          .getByRole("heading", { name: "Compact recording prompts" })
          .scrollIntoViewIfNeeded();
        await screenshot(`send-group-end-${variant}`);
        t3Facts = disconnected;
        await openRecording();

        await openTask("Fix permissions", "Permissions");
        await expect(
          page.getByText("Input devices", { exact: true }),
        ).toBeVisible();
        await screenshot(`permissions-${variant}`);
        await openRecording();

        for (const [label, heading, name] of [
          [
            "Transcription after recording",
            "Transcription after recording",
            "transcription",
          ],
          ["Live transcription", "Live transcription", "transcription-live"],
          ["Double-tap Shift for notes", "Double-tap Shift for notes", "notes"],
          ["Public links", "Public sharing links", "public-links"],
          ["Auto paste", "Auto paste", "auto-paste-unavailable"],
          ["Video export", "Export", "video-export"],
        ]) {
          await openTask(label, heading);
          if (label === "Auto paste") {
            await expect(
              page.getByRole("switch", { name: label }),
            ).toBeDisabled();
            await expect(
              page.getByText("Unavailable in this session.", { exact: false }),
            ).toBeVisible();
            await expect(
              page.getByText(
                /Apparent pastes.*automatically presses Enter.*leave the message unsent/,
              ),
            ).toBeVisible();
          }
          await screenshot(`${name}-${variant}`);
          await openRecording();
          if (label === "Auto paste") {
            fixture.autoPasteSaved = true;
            await openTask(label, heading);
            const autoPaste = page.getByRole("switch", { name: label });
            await expect(autoPaste).toBeChecked();
            await expect(autoPaste).toBeEnabled();
            await expect(autoPaste).toHaveAccessibleDescription(
              /Paste on the saved recording.*submit it yourself/,
            );
            await screenshot(`auto-paste-unavailable-saved-${variant}`);
            await autoPaste.press("Space");
            await expect(autoPaste).not.toBeChecked();
            await expect(autoPaste).toBeDisabled();
            await openRecording();

            fixture.autoPasteSupported = true;
            await openTask(label, heading);
            await expect(autoPaste).toBeEnabled();
            await autoPaste.press("Space");
            await expect(autoPaste).toBeChecked();
            await expect(autoPaste).toHaveAccessibleDescription(
              /automatically presses Enter.*supported Hyprland/,
            );
            await screenshot(`auto-paste-supported-${variant}`);
            await autoPaste.press("Space");
            await expect(autoPaste).not.toBeChecked();
            fixture.autoPasteSupported = false;
            await openRecording();
          }
        }
      }
    await navigate("Agents");
    await page
      .getByRole("button", { name: "Send recordings to T3", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("heading", { name: "Send recordings to T3" }),
    ).toBeFocused();
    assert.equal(page.url(), startUrl);
  } finally {
    await close();
  }
});
