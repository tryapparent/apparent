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
test("enabled unpaired pill opens Labs through the native pipe and can copy the kept recording", {
  timeout: 30000,
}, async (t) => {
  let app;
  t.after(async () => {
    await app?.close().catch(() => {});
  });
  const { fixture } = await import("./testing/server.ts");
  const f = await fixture(t);
  await fs.writeFile(
    f.config,
    JSON.stringify({ experiments: { t3DestinationPicker: true } }),
  );
  app = await electron.launch({
    args: [
      path.join(frontend, "tests/pill/host.cjs"),
      "--no-sandbox",
      "--ozone-platform=x11",
    ],
    env: { ...process.env, APPARENT_CONFIG: f.config, HOME: f.home },
  });
  let page = await app.firstWindow(),
    buffer = "",
    setup = false,
    diagnostics = "";
  const readyWindows = new Set();
  app.process().stderr.on("data", (chunk) => {
    diagnostics = (diagnostics + String(chunk)).slice(-2048);
  });
  app.process().stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const value = JSON.parse(line);
        if (value.ready) readyWindows.add(value.windowId);
        if (value.action === "settings-labs") setup = true;
      } catch {}
    }
  });
  const frame = {
    type: "state",
    capture: "unpaired",
    t3Eligible: true,
    view: {
      revision: 1,
      phase: "completed",
      clock: "00:04",
      label: "Saved",
      warning: null,
      notice: null,
      reducedMotion: true,
      draggable: false,
      inputWaveform: null,
      noteCount: 0,
      actions: [
        {
          id: "paste",
          label: "Paste",
          enabled: true,
          selected: false,
          primary: true,
        },
      ],
    },
  };
  const linux = process.platform === "linux";
  if (linux) {
    await page.clock.install();
    await page.clock.pauseAt(Date.now() + 1000);
  }
  const next = linux ? app.waitForEvent("window") : null;
  const publish = () =>
    app.evaluate(
      (_electron, value) =>
        process.stdin.emit("data", JSON.stringify(value) + "\n"),
      frame,
    );
  await publish();
  const heartbeat = setInterval(() => void publish().catch(() => {}), 500);
  t.after(() => clearInterval(heartbeat));
  if (next) page = await next;
  const connect = page.getByRole("button", { name: "Connect T3", exact: true });
  await expect(connect).toBeVisible();
  const nativeWindow = await app.browserWindow(page);
  const windowId = await nativeWindow.evaluate((window) =>
    Number(window.getMediaSourceId().split(":")[1]),
  );
  try {
    await expect
      .poll(
        async () => {
          if (linux && !readyWindows.has(windowId)) await page.clock.runFor(64);
          return [...readyWindows];
        },
        {
          message: `Pill never reported readiness for native window ${windowId}`,
        },
      )
      .toContain(windowId);
  } catch (error) {
    t.diagnostic(diagnostics);
    throw error;
  }
  if (linux) await page.clock.resume();
  assert.equal(
    await nativeWindow.evaluate((window) => window.isVisible()),
    false,
  );
  await app.evaluate(
    (_electron, id) =>
      process.stdin.emit(
        "data",
        JSON.stringify({ type: "activate", windowId: id }) + "\n",
      ),
    windowId,
  );
  await expect
    .poll(() => nativeWindow.evaluate((window) => window.isVisible()))
    .toBe(true);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  assert.equal(f.reads, 0);
  await connect.click();
  await expect.poll(() => setup).toBe(true);
  await app.evaluate(() =>
    process.stdin.emit(
      "data",
      JSON.stringify({
        type: "handoff-ready",
        capture: "unpaired",
        text: "Kept synthetic recording",
      }) + "\n",
    ),
  );
  await page.getByRole("button", { name: "Copy instead", exact: true }).click();
  await expect(page.getByText("Copied", { exact: true })).toBeVisible();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    "Kept synthetic recording",
  );
  assert.equal(f.calls.length, 0);
  if (process.env.APPARENT_T3_PROOF)
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({
        path: path.join(
          process.env.APPARENT_T3_PROOF,
          "unpaired-" + colorScheme + ".png",
        ),
      });
    }
});

test("a first Enter and a mouse selection both launch New thread when it is the only destination", {
  timeout: 30000,
}, async (t) => {
  let app;
  t.after(async () => {
    await app?.close().catch(() => {});
  });
  const { fixture } = await import("./testing/server.ts");
  const f = await fixture(t);
  f.empty();
  app = await electron.launch({
    args: [
      path.join(frontend, "tests/pill/host.cjs"),
      "--no-sandbox",
      "--ozone-platform=x11",
    ],
    env: { ...process.env, APPARENT_CONFIG: f.config, HOME: f.home },
  });
  let buffer = "";
  app.process().stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const message = JSON.parse(line);
        if (message.ready)
          void app
            .evaluate(
              (_electron, id) =>
                process.stdin.emit(
                  "data",
                  JSON.stringify({ type: "activate", windowId: id }) + "\n",
                ),
              message.windowId,
            )
            .catch(() => {});
      } catch {}
    }
  });
  const send = (value) =>
    app.evaluate(
      (_electron, value) =>
        process.stdin.emit("data", JSON.stringify(value) + "\n"),
      value,
    );
  let frame = {
    type: "state",
    capture: "keyboard",
    t3Eligible: true,
    view: {
      revision: 1,
      phase: "completed",
      clock: "00:04",
      label: "Saved",
      warning: null,
      notice: null,
      reducedMotion: true,
      draggable: false,
      inputWaveform: null,
      noteCount: 0,
      actions: [],
    },
  };

  let page = await app.firstWindow();
  const next = process.platform === "linux" ? app.waitForEvent("window") : null;
  await send(frame);
  const heartbeat = setInterval(() => void send(frame).catch(() => {}), 500);
  t.after(() => clearInterval(heartbeat));
  if (next) page = await next;
  await expect(page.getByRole("combobox")).toBeVisible();
  const trigger = () => page.getByRole("combobox");
  await expect(trigger()).toBeFocused();
  await send({
    type: "handoff-ready",
    capture: "keyboard",
    text: "Synthetic first Enter",
  });
  await page.keyboard.press("Enter");
  await expect.poll(() => f.calls.length).toBe(1);
  assert.equal(f.calls[0].tag, "orchestration.launchThread");
  frame = { ...frame, capture: "mouse", view: { ...frame.view, revision: 2 } };
  await send(frame);
  await expect(trigger()).toBeEnabled();
  await send({
    type: "handoff-ready",
    capture: "mouse",
    text: "Synthetic mouse choice",
  });
  await trigger().click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option").click();
  await expect.poll(() => f.calls.length).toBe(2);
  assert.equal(f.calls[1].tag, "orchestration.launchThread");
});

test("a confirmed T3 send keeps its tab and stays centered on the next recording", {
  timeout: 60000,
}, async (t) => {
  let app;
  t.after(async () => {
    await app?.close().catch(() => {});
  });
  const { fixture } = await import("./testing/server.ts");
  const f = await fixture(t);
  await f.save(true);
  app = await electron.launch({
    args: [
      path.join(frontend, "tests/pill/host.cjs"),
      "--no-sandbox",
      "--ozone-platform=x11",
    ],
    env: { ...process.env, APPARENT_CONFIG: f.config, HOME: f.home },
  });
  let buffer = "";
  app.process().stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const message = JSON.parse(line);
        if (message.ready)
          void send({ type: "activate", windowId: message.windowId }).catch(
            () => {},
          );
      } catch {}
    }
  });
  const send = (value) =>
    app.evaluate(
      (_electron, value) =>
        process.stdin.emit("data", JSON.stringify(value) + "\n"),
      value,
    );
  const actions = [
    {
      id: "whiteboard",
      label: "Whiteboard",
      enabled: true,
      selected: false,
      primary: false,
    },
    {
      id: "finish",
      label: "Finish",
      enabled: true,
      selected: false,
      primary: true,
    },
    {
      id: "cancel",
      label: "Cancel",
      enabled: true,
      selected: false,
      primary: false,
    },
  ];
  const waveform = [
    0, 0.04, 0.1, 0.3, 0.16, 0.08, 0.02, 0, 0, 0.08, 0.5, 0.7, 0.2, 0.08, 0.02,
    0, 0, 0.03, 0.1, 0.3, 0.02, 0.1, 0.5, 0.8,
  ];
  const frame = {
    type: "state",
    capture: "boot:1",
    t3Eligible: true,
    view: {
      revision: 1,
      phase: "recording",
      clock: "0:04",
      label: "Recording",
      warning: null,
      notice: null,
      reducedMotion: true,
      draggable: false,
      inputWaveform: waveform,
      softBloom: true,
      noteCount: 0,
      actions,
    },
  };
  let page = await app.firstWindow();
  const center = () =>
    page
      .evaluate(() => {
        const row = document
          .querySelector(".pill-row")
          ?.getBoundingClientRect();
        return row ? screenX + row.x + row.width / 2 : null;
      })
      .catch(() => null);
  await send(frame);
  const heartbeat = setInterval(() => void send(frame).catch(() => {}), 500);
  t.after(() => clearInterval(heartbeat));
  await expect(
    page.getByRole("button", { name: "Finish", exact: true }),
  ).toBeVisible();
  await expect.poll(center).not.toBeNull();
  const original = await center();
  const rowHeight = await page
    .locator(".pill-row")
    .evaluate((element) => element.getBoundingClientRect().height);
  const picker =
    process.platform === "linux" ? app.waitForEvent("window") : null;
  frame.view = {
    ...frame.view,
    revision: 2,
    phase: "processing",
    inputWaveform: null,
    actions: [],
  };
  await send(frame);
  if (picker) page = await picker;
  const trigger = page.getByRole("combobox");
  await expect(trigger).toBeEnabled();
  const pickerRow = page.locator(".destination-pill");
  const collapsed = await pickerRow.boundingBox();
  assert.equal(collapsed.height, rowHeight);
  const chipColor = await trigger.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await trigger.click();
  assert.equal((await pickerRow.boundingBox()).height, rowHeight);
  await page.getByRole("option", { name: /Chosen thread/ }).click();
  const confirmed = page.getByRole("button", { name: /Will send when ready/ });
  await expect(confirmed).toBeVisible();
  assert.equal(
    await confirmed.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
    chipColor,
  );
  assert.deepEqual(await pickerRow.boundingBox(), collapsed);
  await expect(page.getByRole("button", { name: "Cancel send" })).toHaveCount(
    0,
  );
  assert.equal(f.calls.length, 0);
  const replacement =
    process.platform === "linux" ? app.waitForEvent("window") : null;
  frame.capture = "boot:2";
  frame.view = {
    ...frame.view,
    revision: 3,
    phase: "recording",
    inputWaveform: waveform,
    softBloom: true,
    actions,
  };
  await send(frame);
  if (replacement) page = await replacement;
  const tab = page.getByRole("button", {
    name: "1 previous recording processing",
  });
  await expect(tab).toBeVisible();
  const bloom = () => page.locator(".input-bloom__ring");
  await expect(bloom()).toBeVisible();
  assert.notEqual(original, null);
  await expect
    .poll(async () => {
      const now = await center();
      return now !== null && Math.abs(now - original) <= 2;
    })
    .toBe(true);
  for (const [theme, width] of [
    ["light", 1200],
    ["dark", 800],
  ]) {
    await app.evaluate(({ screen }, width) => {
      screen.__overlapDisplay ??= screen.getDisplayMatching.bind(screen);
      screen.getDisplayMatching = (b) => ({
        ...screen.__overlapDisplay(b),
        workArea: { x: 0, y: 0, width, height: 800 },
      });
    }, width);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.evaluate(
      (revision) => window.apparentPill.layout(revision),
      frame.view.revision,
    );
    await expect(tab).toBeVisible();
    if (process.env.APPARENT_T3_PROOF)
      await page.screenshot({
        path: path.join(
          process.env.APPARENT_T3_PROOF,
          "overlap-" + theme + "-" + width + ".png",
        ),
      });
  }
  await send({
    type: "handoff-ready",
    capture: "boot:1",
    text: "overlapping capture test",
  });
  const sent = page.getByRole("button", {
    name: "Sent to T3 Code",
    exact: true,
  });
  await expect(sent).toBeVisible();
  await expect(bloom()).toBeVisible();
  await sent.click();
  await expect(page.locator(".pill-background-detail")).toContainText(
    "Chosen thread",
  );
  await expect(
    page.getByRole("button", { name: "Finish", exact: true }),
  ).toBeVisible();
  assert.equal(f.accepted.size, 1);
  assert.equal(f.calls[0].payload.threadId, "thread");
});
