const { test } = require("node:test");
const assert = require("node:assert/strict");
const { _electron: electron, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");

test("Soft Bloom holds in silence and gives a static sound cue in reduced motion", async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pill-bloom-"));
  const application = await electron.launch({
    args: [path.resolve(__dirname, "host.cjs"), "--no-sandbox"],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, "config") },
  });
  t.after(async () => {
    await application.close().catch(() => {});
    await fs.rm(home, { recursive: true, force: true });
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => window.apparentPill);
  const view = {
    revision: 1, phase: "recording", clock: "00:12", label: "Recording",
    warning: null, notice: null, reducedMotion: false, draggable: false,
    noteCount: 0, inputWaveform: Array(24).fill(0), doodleInk: false,
    actions: [
      { id: "whiteboard", label: "Whiteboard", enabled: true, selected: false, primary: false },
      { id: "finish", label: "Finish", enabled: true, selected: false, primary: true },
      { id: "cancel", label: "Cancel", enabled: true, selected: false, primary: false },
    ],
  };
  const publish = changes => application.evaluate((_electron, state) => {
    process.stdin.emit("data", JSON.stringify({ type: "state", view: state }) + "\n");
    process.stdin.emit("data", '{"type":"activate"}\n');
  }, { ...view, ...changes });
  const bloom = page.locator(".input-bloom");
  const ring = page.locator(".input-bloom__ring");
  const radius = async () => Number(await ring.getAttribute("r"));
  const row = page.locator(".pill-row");
  const capture = async name => {
    if (process.env.PILL_EVIDENCE) {
      const clip = await row.boundingBox();
      await page.screenshot({
        clip, timeout: 2000,
        path: path.join(process.env.PILL_EVIDENCE, name + ".png"),
      });
    }
  };
  const quiet = { inputWaveform: [...Array(23).fill(0.8), 0] };
  const sound = { inputWaveform: [...Array(23).fill(0), 0.18] };
  await publish({doodleInk: null});
  await expect(row.locator(".pill-doodles")).toBeVisible();
  await publish({});
  await expect(ring).toBeVisible();
  await expect(row.locator(".pill-doodles")).toHaveCount(0);
  await page.evaluate(() => window.apparentPill.layout(1));
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 60_000);
  const resting = await radius();
  await publish(sound);
  await expect.poll(radius).toBeGreaterThan(resting);
  const expanded = await radius();
  await publish(quiet);
  await expect(bloom).toHaveAccessibleName("Microphone listening, quiet");
  assert.equal(await radius(), expanded);
  await page.clock.runFor(320);
  await expect(bloom).toHaveAccessibleName("Microphone level unavailable");
  assert.equal(await radius(), expanded);
  await publish(sound);
  await expect(bloom).toHaveAccessibleName("Microphone input detected");
  await page.clock.resume();

  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "no-preference" });
    await publish(quiet);
    await capture(colorScheme + "-quiet");
  }

  await application.evaluate(({ screen }) => {
    const original = screen.getDisplayMatching.bind(screen);
    screen.getDisplayMatching = bounds => {
      const display = original(bounds);
      return { ...display, workArea: { ...display.workArea, width: 320 } };
    };
  });
  await publish(quiet);
  await page.evaluate(() => window.apparentPill.layout(1));
  await expect.poll(() => row.evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(320);
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await publish({...quiet, doodleInk: true});
    await expect(bloom).toHaveAttribute("data-reduced", "true");
    const doodles = row.locator(".pill-doodles");
    await expect(doodles).toBeVisible();
    await expect(doodles).toHaveAttribute("aria-hidden", "true");
    assert.equal(await doodles.evaluate(el => getComputedStyle(el).pointerEvents), "none");
    assert.equal(await doodles.evaluate(el =>
      el.getContext("2d").getImageData(0, 0, el.width, el.height).data.some((value, index) => index % 4 === 3 && value > 0)
    ), true);
    await page.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    ));
    const ink = () => doodles.evaluate(el => el.toDataURL());
    const still = await ink();
    const fixedRadius = await radius();
    await expect(bloom.locator("path")).toHaveCount(0);
    await publish({...sound, doodleInk: true});
    await expect(bloom.locator("path")).toHaveCount(1);
    assert.equal(await radius(), fixedRadius);
    assert.equal(await ink(), still);
    const finish = page.getByRole("button", { name: "Finish", exact: true });
    await finish.focus();
    await expect(finish).toBeFocused();
    await capture(colorScheme + "-narrow-reduced");
  }

  await publish({ revision: 2, warning: "Mic unavailable", inputWaveform: null });
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Mic unavailable" })).toBeVisible();
  await expect(bloom).toHaveCount(0);
  await expect(page.locator(".indicator.recording")).toBeVisible();
  await publish({ revision: 3, phase: "processing", inputWaveform: null });
  await expect(bloom).toHaveCount(0);
  await expect(row.locator(".pill-doodles")).toHaveCount(0);
});
