const { test } = require("node:test");
const assert = require("node:assert/strict");

const path = require("node:path");
const fs = require("node:fs/promises");
const frontend = path.resolve(
  __dirname,
  "../../../capture/desktop/ui/frontend",
);
const requireFrontend = require("node:module").createRequire(
  path.join(frontend, "package.json"),
);
const { _electron: electron, expect } = requireFrontend("@playwright/test");

async function pickerGeometry(app, page) {
  const pill = await page.locator(".destination-pill").boundingBox();
  assert.ok(pill);
  const host = await app.evaluate(({ BrowserWindow }) => {
    const { x, y, width } = BrowserWindow.getAllWindows()[0].getBounds();
    return { x, y, width };
  });
  return { pill, host };
}

test("picker warms both computers during recording and keeps the waiting state actionable", {
  timeout: 60000,
}, async (t) => {
  let app;
  t.after(async () => {
    await app?.close().catch(() => {});
  });
  const { fixture } = await import("./testing/server.ts");
  const a = await fixture(t),
    b = await fixture(t);
  a.computer("X1");
  b.computer("Clanker");
  a.label("Apparent");
  b.label("Apparent");
  const resumeClanker = b.delayConfig();
  const credentials = (origin) => ({
    origin,
    token: "private-test-token",
    expiresAt: Date.now() + 3600000,
  });
  await fs.writeFile(
    a.config,
    JSON.stringify({
      t3: { ...credentials(a.origin), connections: [credentials(b.origin)] },
      experiments: { t3DestinationPicker: true },
    }),
  );
  app = await electron.launch({
    args: [
      path.join(frontend, "tests/pill/host.cjs"),
      "--no-sandbox",
      "--ozone-platform=x11",
    ],
    env: { ...process.env, APPARENT_CONFIG: a.config, HOME: a.home },
  });
  let buffer = "",
    finished = false;
  app.process().stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const m = JSON.parse(line);
        if (m.ready)
          void app
            .evaluate(
              (_e, id) =>
                process.stdin.emit(
                  "data",
                  JSON.stringify({ type: "activate", windowId: id }) + "\n",
                ),
              m.windowId,
            )
            .catch(() => {});
        if (m.action === "finish") finished = true;
      } catch {}
    }
  });
  let page = await app.firstWindow();
  const frame = {
    type: "state",
    capture: "names",
    t3Eligible: true,
    view: {
      revision: 1,
      phase: "recording",
      clock: "00:04",
      label: "Recording",
      warning: null,
      notice: null,
      reducedMotion: true,
      draggable: false,
      inputWaveform: null,
      noteCount: 0,
      actions: [
        {
          id: "finish",
          label: "Finish",
          enabled: true,
          selected: false,
          primary: true,
        },
      ],
    },
  };
  const send = (value) =>
    app.evaluate(
      (_e, value) => process.stdin.emit("data", JSON.stringify(value) + "\n"),
      value,
    );
  await send(frame);
  const heartbeat = setInterval(() => void send(frame).catch(() => {}), 500);
  t.after(() => clearInterval(heartbeat));
  const finish = page.getByRole("button", { name: "Finish", exact: true });
  await expect(finish).toBeEnabled();
  await expect.poll(() => [a.reads, b.reads]).toEqual([1, 1]);
  assert.equal(
    await page.evaluate(() => window.apparentPill.destinations()),
    null,
  );
  assert.equal(a.calls.length + b.calls.length, 0);
  const next = process.platform === "linux" ? app.waitForEvent("window") : null;
  await finish.click();
  await expect.poll(() => finished).toBe(true);
  frame.view = {
    ...frame.view,
    revision: 2,
    phase: "processing",
    label: "Processing recording…",
    actions: [],
  };
  await send(frame);
  if (next) page = await next;
  const trigger = page.getByRole("combobox");
  await expect(trigger).toBeEnabled();
  const setWorkArea = async (width) => {
    await app.evaluate(({ screen }, width) => {
      screen.__pickerDisplay ??= screen.getDisplayMatching.bind(screen);
      screen.getDisplayMatching = (bounds) => ({
        ...screen.__pickerDisplay(bounds),
        workArea: { x: 0, y: 0, width, height: 800 },
      });
    }, width);
    const revision = ++frame.view.revision;
    await send(frame);
    await expect(page.locator("main")).toHaveAttribute(
      "data-revision",
      String(revision),
    );
    const measuredLimit = await page.evaluate(async (revision) => {
      await window.apparentPill.layout(revision);
      return document.documentElement.style.getPropertyValue("--pill-limit");
    }, revision);
    assert.equal(measuredLimit, `${width}px`);
  };
  const proof = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const r = document.querySelector("main").getBoundingClientRect();
            return [
              innerWidth - Math.ceil(r.width),
              innerHeight - Math.max(58, Math.ceil(r.height)),
            ];
          }),
        { message: `${name} window matches the rendered picker` },
      )
      .toEqual([0, 0]);
    if (process.env.APPARENT_T3_PROOF)
      await page.screenshot({
        path: path.join(process.env.APPARENT_T3_PROOF, name + ".png"),
      });
  };
  await trigger.click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.getByRole("option", { name: /Chosen thread, X1/ }).click();
  await page.getByRole("button", { name: /Will send when ready/ }).click();
  await expect(page.getByRole("button", { name: "Cancel send" })).toBeVisible();
  assert.equal(a.calls.length + b.calls.length, 0);
  await page.getByRole("button", { name: "Cancel send" }).click();
  resumeClanker();
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.apparentPill.destinations()).choices.length,
      ),
    )
    .toBe(6);
  assert.deepEqual([a.reads, b.reads], [1, 1]);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await proof("friendly-selecting");
  await page
    .getByRole("combobox", { name: "Search threads" })
    .fill("Clanker chosen");
  await expect(
    page.getByRole("option", { name: /Chosen thread, Clanker/ }),
  ).toBeVisible();
  assert.equal(a.calls.length + b.calls.length, 0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Escape");
  await trigger.click();
  await page.getByRole("option", { name: /New thread, Clanker/ }).click();
  const confirmed = page.getByRole("button", { name: /Will send when ready/ });
  await expect(confirmed).toContainText("Will send when ready");
  await expect(confirmed).toHaveAttribute("title", "Clanker · Apparent");
  for (const theme of ["light", "dark"])
    for (const width of [1200, 320]) {
      await setWorkArea(width);
      await page.emulateMedia({ colorScheme: theme });
      await proof("friendly-waiting-" + theme + "-" + width);
    }
  await confirmed.click();
  await page.getByRole("button", { name: "Cancel send", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toBeEnabled();
  assert.equal(a.calls.length, 0);
  assert.equal(b.calls.length, 0);
  for (const theme of ["light", "dark"])
    for (const width of [1200, 320]) {
      await setWorkArea(width);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await proof("friendly-collapsed-" + theme + "-" + width);
      const collapsed = await pickerGeometry(app, page);
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("option")).toHaveCount(6);
      await expect(
        page.getByRole("option", { name: /New thread, Clanker/ }),
      ).toBeVisible();
      await expect(page.locator("main")).not.toContainText("127.0.0.1");
      await proof("friendly-expanded-" + theme + "-" + width);
      assert.deepEqual(await pickerGeometry(app, page), collapsed);
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await proof("friendly-reclosed-" + theme + "-" + width);
      assert.deepEqual(await pickerGeometry(app, page), collapsed);
    }
  await trigger.click();
  await page.getByRole("option", { name: /Chosen thread, Clanker/ }).click();
  await expect(
    page.getByRole("button", { name: /Will send when ready/ }),
  ).toBeVisible();
  await send({
    type: "handoff-ready",
    capture: "names",
    text: "Synthetic name routing check",
  });
  await expect(
    page.getByRole("img", { name: "Submitted", exact: true }),
  ).toBeVisible();
  assert.equal(b.calls.length, 1);
  assert.equal(a.calls.length, 0);

  const resumePrevious = b.delayConfig();
  frame.capture = "follow-up";
  ++frame.view.revision;
  await send(frame);
  await expect.poll(() => [a.reads, b.reads]).toEqual([2, 2]);
  await expect(trigger).toBeDisabled();
  await expect(trigger).toContainText("Loading T3 threads");
  resumePrevious();
  await expect(trigger).toHaveAccessibleName(
    /Chosen thread, recording destination, Clanker/,
  );
  for (const theme of ["light", "dark"])
    for (const width of [1200, 320]) {
      await setWorkArea(width);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await proof("remembered-collapsed-" + theme + "-" + width);
      await trigger.press("ArrowDown");
      const options = page.getByRole("option");
      await expect(options.first()).toHaveAccessibleName(
        /Chosen thread, Clanker/,
      );
      await expect(options.first()).toHaveAttribute("aria-selected", "true");
      await expect(options.nth(1)).toHaveAccessibleName(/New thread, Clanker/);
      await expect(options.nth(2)).toHaveAccessibleName(/New thread, X1/);
      await proof("remembered-expanded-" + theme + "-" + width);
      await page.keyboard.press("Escape");
    }
  await send({
    type: "handoff-ready",
    capture: "follow-up",
    text: "Synthetic quick send",
  });
  await trigger.press("Enter");
  await expect(
    page.getByRole("img", { name: "Submitted", exact: true }),
  ).toBeVisible();
  assert.equal(b.calls.length, 2);
  assert.equal(b.calls[1].payload.threadId, "thread");
  assert.equal(a.calls.length, 0);
});
