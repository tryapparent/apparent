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
  const disconnected = { t3Saved: false, t3Configured: false };
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
    const { page, setVariant } = await open();
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
    const video = page.getByRole("switch", { name: "Video export" });
    const wordmark = page.getByRole("img", { name: "Apparent", exact: true });
    for (const width of [720, 640]) {
      for (const colorScheme of ["light", "dark"] as const) {
        await setVariant(width, colorScheme);
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
        await setVariant(width, theme);
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
    fixture.linux();

    const startUrl = page.url();
    const navigate = async (pane: string) => {
      if (await page.locator(".settings-navigation-compact").isVisible()) {
        await page
          .getByRole("button", { name: /^Settings pages,/ })
          .press("Enter");
      }
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

    for (const width of [720, 640])
      for (const theme of ["light", "dark"] as const) {
        const variant = `${width}-${theme}`;
        await setVariant(width, theme);
        assert.equal(
          await page
            .locator(".settings-content")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
          true,
        );
        await expect(page.getByRole("navigation", { name: "Jump to" })).toHaveCount(0);
        await expect(input).toBeInViewport({ ratio: 1 });
        await screenshot(`opening-${variant}`);

        fixture.pickerSupported = theme === "light";
        await navigate("Permissions");
        const picker = page.getByRole("switch", {
          name: "Skip screen selection",
        });
        if (fixture.pickerSupported) await expect(picker).toBeEnabled();
        else await expect(picker).toBeDisabled();
        await screenshot(`screen-selection-${variant}`);
        await navigate("Recording");

        await navigate("Agents");
        const t3 = page.getByRole("switch", { name: "Send recordings to T3 Code" });
        await expect(t3).toBeEnabled();
        await expect(t3).toHaveAccessibleDescription(/Choose a T3 Code thread/);
        await expect(t3).not.toBeChecked();
        await expect(page.getByRole("heading", { name: "Computers" })).toHaveCount(0);
        await screenshot(`send-${variant}`);
        await navigate("Recording");

        t3Facts = {
          ...disconnected,
          t3Configured: true,
          t3Connections: [
            { origin: "https://studio.example", expiresAt: 4_000_000_000_000 },
            { origin: "https://expired.example", expiresAt: 0 },
          ],
        };
        await navigate("Agents");
        await expect(t3).not.toBeChecked();
        await expect(page.getByRole("button", { name: "Pair with a link" })).toHaveCount(0);
        heldT3 = undefined;
        await t3.press("Space");
        await expect.poll(() => heldT3).toBeDefined();
        await expect(t3).toHaveAttribute("aria-busy", "true");
        await expect(t3).toHaveCSS("cursor", "wait");
        await expect(t3).not.toBeChecked();
        t3Facts = { ...t3Facts, t3Saved: true };
        send({ type: "agents-result", request: heldT3, facts: t3Facts });
        await expect(t3).toBeChecked();
        await expect(page.getByText("Pairing expired", { exact: true })).toBeVisible();
        const manual = page.getByRole("button", { name: "Pair with a link" });
        await manual.press("Enter");
        await expect(page.getByRole("dialog", { name: "Pair with a link" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(manual).toBeFocused();
        await screenshot(`send-connected-on-${variant}`);
        heldT3 = undefined;
        await t3.press("Space");
        await expect.poll(() => heldT3).toBeDefined();
        send({ type: "agents-result", request: heldT3, facts: { error: "config_write_failed" } });
        const failure = page.getByRole("alertdialog", { name: "Unable to save T3 sending preference" });
        await expect(failure.getByRole("button", { name: "Refresh T3 sending" })).toBeFocused();
        await page.keyboard.press("Escape");
        const refresh = page.getByRole("button", { name: "Refresh T3 sending" });
        await expect(refresh).toBeFocused();
        heldT3 = undefined;
        await refresh.press("Enter");
        await expect(t3).toBeChecked();
        await expect(t3).toBeFocused();
        assert.equal(heldT3, undefined);
        t3Facts = disconnected;
        await navigate("Recording");

        await navigate("Permissions");
        await expect(
          page.getByRole("heading", {
            name: fixture.pickerSupported ? "Input devices" : "Microphone",
            exact: true,
          }),
        ).toBeVisible();
        await screenshot(`permissions-${variant}`);
        await navigate("Recording");

        for (const [pane, heading, name] of [
          ["Recording", "Transcription after recording", "transcription"],
          ["Labs", "Live local transcription", "transcription-live"],
          ["Recording", "Notes", "notes"],
          ["Recording", "Export", "video-export"],
          ["Labs", "Public sharing links", "public-links"],
          ["Labs", "Auto paste", "auto-paste-unavailable"],
        ]) {
          if (pane !== "Recording") await navigate(pane);
          const target = page
            .getByText(heading, { exact: true })
            .and(page.locator("h1, h2, legend"));
          await target.scrollIntoViewIfNeeded();
          if (name === "notes") {
            await expect(
              page.getByText(/tap Shift twice quickly.*open the note editor/),
            ).toBeInViewport();
            await expect(
              page.getByRole("switch", { name: /notes/i }),
            ).toHaveCount(0);
          }
          if (name === "transcription-live") {
            await expect(
              page.getByText(/live preview of your English speech/),
            ).toBeInViewport();
          }
          if (heading === "Auto paste") {
            await expect(
              page.getByRole("switch", { name: heading }),
            ).toBeDisabled();
            await expect(
              page.getByText("Auto paste is unavailable on this platform.", { exact: false }),
            ).toBeVisible();
            await expect(
              page.getByText(
                /Keep the same draft field focused.*You decide when to send/,
              ),
            ).toBeVisible();
          }
          await screenshot(`${name}-${variant}`);
          if (pane !== "Recording") await navigate("Recording");
          if (heading === "Auto paste") {
            fixture.autoPasteSaved = true;
            await navigate("Labs");
            const autoPaste = page.getByRole("switch", { name: heading });
            await expect(autoPaste).toBeChecked();
            await expect(autoPaste).toBeEnabled();
            await expect(autoPaste).toHaveAccessibleDescription(
              /use Paste on the saved recording/,
            );
            await screenshot(`auto-paste-unavailable-saved-${variant}`);
            await autoPaste.press("Space");
            await expect(autoPaste).not.toBeChecked();
            await expect(autoPaste).toBeDisabled();
            await navigate("Recording");

            fixture.autoPasteSupported = true;
            await navigate("Labs");
            await expect(autoPaste).toBeEnabled();
            await autoPaste.press("Space");
            await expect(autoPaste).toBeChecked();
            await expect(autoPaste).toHaveAccessibleDescription(
              /Keep the same draft field focused.*You decide when to send/,
            );
            await screenshot(`auto-paste-supported-${variant}`);
            await autoPaste.press("Space");
            await expect(autoPaste).not.toBeChecked();
            fixture.autoPasteSupported = false;
            await navigate("Recording");
          }
        }
      }
    await navigate("Agents");
    await expect(page.getByRole("heading", { name: "Send recordings to T3 Code" })).toBeVisible();
    assert.equal(page.url(), startUrl);
    await navigate("Recording");
    assert.equal(
      await page.evaluate(async () => {
        try {
          await Reflect.get(window, "apparentRecording").save({
            key: "doubleShiftNotes",
            value: false,
          });
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
  } finally {
    await close();
  }
});
