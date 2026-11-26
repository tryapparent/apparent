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
test("real pill keeps Paste by default, then selects during processing and dispatches through main only", {
  timeout: 60000,
}, async (t) => {
  let app;
  t.after(async () => {
    await app?.close().catch(() => {});
  });
  const { fixture } = await import("./testing/server.ts");
  const f = await fixture(t);
  f.many();
  await f.save(false);
  app = await electron.launch({
    args: [
      path.join(frontend, "tests/pill/host.cjs"),
      "--no-sandbox",
      "--ozone-platform=x11",
      `--force-device-scale-factor=${process.env.APPARENT_T3_SCALE ?? "1"}`,
    ],
    env: {
      ...process.env,
      APPARENT_CONFIG: f.config,
      HOME: f.home,
      XDG_CONFIG_HOME: path.join(f.home, "config"),
      HYPRLAND_INSTANCE_SIGNATURE: "focus-test",
    },
  });
  const page = await app.firstWindow();
  const initialWindowId = await app.evaluate(({ BrowserWindow }) =>
    Number(BrowserWindow.getAllWindows()[0].getMediaSourceId().split(":")[1]),
  );

  let parentBuffer = "";
  const readyIds = [],
    releasedIds = [];
  const activate = (id) =>
    app.evaluate(
      (_electron, id) =>
        process.stdin.emit(
          "data",
          JSON.stringify({ type: "activate", windowId: id }) + "\n",
        ),
      id,
    );
  app.process().stdout.on("data", (chunk) => {
    parentBuffer += String(chunk);
    let end;
    while ((end = parentBuffer.indexOf("\n")) >= 0) {
      const line = parentBuffer.slice(0, end);
      parentBuffer = parentBuffer.slice(end + 1);
      try {
        const message = JSON.parse(line);
        if (message.ready) {
          readyIds.push(message.windowId);
          void activate(message.windowId).catch(() => {});
        }
        if (message.releaseFocus) releasedIds.push(message.releaseFocus);
      } catch {}
    }
  });
  async function proofThemes(name) {
    for (const colorScheme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await proof(name + "-" + colorScheme);
    }
  }
  async function proof(name) {
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const r = document.querySelector("main")!.getBoundingClientRect();
          return (
            innerWidth === Math.ceil(r.width) &&
            innerHeight >= Math.ceil(r.height)
          );
        }),
      )
      .toBe(true);
    if (process.env.APPARENT_T3_PROOF) {
      await fs.mkdir(process.env.APPARENT_T3_PROOF, { recursive: true });
      await page.locator("main").screenshot({
        path: path.join(process.env.APPARENT_T3_PROOF, name + ".png"),
      });
    }
  }

  let frame = {
    type: "state",
    capture: "off",
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
        {
          id: "dismiss",
          label: "Dismiss",
          enabled: true,
          selected: false,
          primary: false,
        },
      ],
    },
  };
  const publish = async () =>
    app.evaluate(
      (_electron, frame) =>
        process.stdin.emit("data", JSON.stringify(frame) + "\n"),
      frame,
    );
  if (process.platform === "linux")
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents,
        execute = contents.executeJavaScript.bind(contents),
        until = Date.now() + 300;
      contents.executeJavaScript = (source, ...args) => {
        if (source.includes("--pill-limit"))
          return new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, until - Date.now())),
          ).then(() => execute(source, ...args));
        return execute(source, ...args);
      };
    });
  await publish();
  const heartbeat = setInterval(() => void publish().catch(() => {}), 500);
  t.after(() => clearInterval(heartbeat));
  await expect(
    page.getByRole("button", { name: "Paste", exact: true }),
  ).toBeVisible();
  assert.equal(f.reads, 0);
  if (process.platform === "linux") {
    await expect.poll(() => readyIds.length).toBe(1);
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible(),
        ),
      )
      .toBe(true);
  }
  if (process.platform === "linux")
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.pickerReshapes = [];
      window.handoffHidden = false;
      window.once("hide", () => {
        window.handoffHidden = true;
      });
      const setShape = window.setShape.bind(window);
      window.setShape = (rectangles) => {
        window.pickerReshapes.push(rectangles.length);
        setShape(rectangles);
      };
    });
  await f.save(true);
  frame = {
    ...frame,
    capture: "on",
    view: {
      ...frame.view,
      revision: 2,
      phase: "processing",
      label: "Processing recording…",
      actions: [],
    },
  };
  await publish();
  const trigger = page.getByRole("combobox");
  const search = page.getByRole("combobox", { name: "Search threads" });
  const list = page.getByRole("listbox"),
    options = page.getByRole("option");
  const fade = page.locator(".destination-fade");
  await expect(trigger).toBeEnabled();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  if (process.platform === "linux") {
    await expect
      .poll(() => readyIds.slice(0, 2))
      .toEqual([initialWindowId, initialWindowId]);
    assert.deepEqual(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => ({
          id: Number(window.getMediaSourceId().split(":")[1]),
          hiddenDuringHandoff: window.handoffHidden,
          focusable: window.isFocusable(),
        })),
      ),
      [{ id: initialWindowId, hiddenDuringHandoff: false, focusable: true }],
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const size = document.querySelector("main")!.getBoundingClientRect();
          return innerHeight === Math.ceil(size.height);
        }),
      )
      .toBe(true);
    const masks = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].pickerReshapes,
    );
    assert.ok(masks.length > 0 && masks.every((rows) => rows > 1));
  }
  await proofThemes("processing-keyboard-focus");
  await page.keyboard.press("ArrowDown");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);

  const destination = await page.evaluate(() =>
    window.apparentPill.destinations(),
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send(
      "pill:destinations",
      null,
    ),
  );
  await expect(page.locator(".pill-row")).toBeVisible();
  await proof("destination-pending");
  await app.evaluate(
    ({ BrowserWindow }, value) =>
      BrowserWindow.getAllWindows()[0].webContents.send(
        "pill:destinations",
        value,
      ),
    destination,
  );
  await expect(trigger).toBeEnabled();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(search).toBeFocused();
  await expect(options).toHaveCount(6);
  await expect(fade).toBeVisible();
  await list.hover();
  await page.mouse.wheel(0, 700);
  await expect(fade).toHaveCount(0);
  await proofThemes("processing-expanded");
  assert.ok(
    (
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBounds(),
      )
    ).height > 160,
    "native window must fit the expanded tray",
  );
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toContainText("New thread");
  assert.equal(f.calls.length, 0);
  await page.keyboard.press("c");
  await search.fill("chosen");
  await proofThemes("search");
  await search.press("Enter");
  await expect(
    page.getByRole("button", { name: /Will send when ready/ }),
  ).toBeVisible();
  assert.equal(f.calls.length, 0);
  if (process.platform === "linux")
    await expect.poll(() => releasedIds).toEqual([readyIds.at(-1)]);
  const handoff = "PRIVATE exact recording handoff";
  await app.evaluate(
    (_electron, args) =>
      process.stdin.emit(
        "data",
        JSON.stringify({ type: "handoff-ready", capture: "on", text: args }) +
          "\n",
      ),
    handoff,
  );
  frame = {
    ...frame,
    view: {
      ...frame.view,
      revision: 3,
      phase: "completed",
      label: "Saved",
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
  await publish();
  await expect.poll(() => f.calls.length).toBe(1);
  await expect(trigger).toBeDisabled();
  assert.equal(f.calls[0].payload.threadId, "thread");
  assert.equal(f.calls[0].payload.text, handoff);
  assert.equal(
    await page.evaluate(() => document.body.textContent.includes("PRIVATE")),
    false,
  );
  await page.reload();
  await expect(trigger).toBeDisabled();
  assert.equal(f.accepted.size, 1);
  frame = { ...frame, capture: "retry", view: { ...frame.view, revision: 4 } };
  await publish();
  await expect(trigger).toContainText("Chosen thread");
  await app.evaluate(() =>
    process.stdin.emit(
      "data",
      JSON.stringify({
        type: "handoff-ready",
        capture: "retry",
        text: "COPY THIS EXACT HANDOFF",
      }) + "\n",
    ),
  );
  f.lose();
  await trigger.click();
  await search.fill("settled");
  await expect(options).toHaveCount(1);
  await search.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Delivery not confirmed");
  if (process.platform === "linux") assert.equal(releasedIds.length, 1);
  await expect(page.locator(".destination-confirmed")).toContainText(
    "Settled onboarding notes",
  );
  assert.equal(f.calls[1].payload.threadId, "settled");
  await page
    .getByRole("button", { name: "Copy recording", exact: true })
    .click();
  await expect(page.getByText("Copied", { exact: true })).toBeVisible();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    "COPY THIS EXACT HANDOFF",
  );
  await proofThemes("error");
  const retry = page.getByRole("button", {
    name: "Retry same send",
    exact: true,
  });
  await expect(retry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("img", { name: "Submitted", exact: true }),
  ).toBeVisible();
  await expect.poll(() => f.calls.length).toBe(3);
  assert.equal(f.accepted.size, 2);
  assert.deepEqual(f.calls[1], f.calls[2]);
  if (process.platform === "linux")
    await expect
      .poll(() => releasedIds)
      .toEqual([readyIds.at(-1), readyIds.at(-1)]);
  await app.evaluate(({ screen }) => {
    const matching = screen.getDisplayMatching.bind(screen);
    screen.getDisplayMatching = (bounds) => {
      const display = matching(bounds);
      return { ...display, workArea: { ...display.workArea, width: 320 } };
    };
  });
  frame = { ...frame, capture: "narrow", view: { ...frame.view, revision: 5 } };
  await publish();
  await expect(trigger).toBeEnabled();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const firstTray = await page.locator(".destination-tray").boundingBox();
  for (let i = 0; i < 5; i++) await search.press("ArrowDown");
  await expect(options.last()).toHaveAttribute("aria-selected", "true");
  await proofThemes("narrow-expanded");
  assert.ok(firstTray.width <= 320);
  assert.deepEqual(
    await page.locator(".destination-tray").boundingBox(),
    firstTray,
  );
  await expect(fade).toHaveCount(0);
  if (process.platform === "linux") {
    await page.evaluate(
      (revision) => window.apparentPill.layout(revision),
      frame.view.revision,
    );
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0],
        shape = w.setShape.bind(w);
      w.__pickerShapes = [];
      w.setShape = (rects) => {
        w.__pickerShapes.push(rects);
        return shape(rects);
      };
    });
    await page.evaluate(() => {
      window.__originalPickerFrame = window.requestAnimationFrame;
      window.__pickerFrames = [];
      window.requestAnimationFrame = (callback) =>
        window.__pickerFrames.push(callback);
    });
    await page.keyboard.press("Escape");
    await expect
      .poll(() => page.evaluate(() => window.__pickerFrames.length))
      .toBeGreaterThan(0);
    assert.ok(
      (await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getBounds().height,
      )) > 160,
      "the expanded native bounds survive a pending collapse",
    );
    await expect(trigger).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(options).toHaveCount(6);
    await page.evaluate(async (revision) => {
      for (let i = 0; i < 8; i++) {
        for (const callback of window.__pickerFrames.splice(0))
          callback(performance.now());
        await new Promise((r) => setTimeout(r, 10));
      }
      window.requestAnimationFrame = window.__originalPickerFrame;
      await window.apparentPill.layout(revision);
    }, frame.view.revision);
    const masks = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return {
        height: w.getBounds().height,
        rounded: w.__pickerShapes
          .filter((shape) => shape.length > 1)
          .map((shape) => Math.max(...shape.map((r) => r.y + r.height))),
      };
    });
    assert.ok(masks.height > 160);
    assert.ok(masks.rounded.every((h) => Math.abs(h - masks.height) <= 2));
    const expandedHeight = await page.evaluate(() => innerHeight);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => {
          const shape = BrowserWindow.getAllWindows()[0].__pickerShapes.at(-1);
          return shape
            ? Math.max(...shape.map((r) => r.y + r.height))
            : Infinity;
        }),
      )
      .toBeLessThan(60);
    assert.equal(await page.evaluate(() => innerHeight), expandedHeight);
  }
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("https://example.com");
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  const reads = f.reads;
  await f.save(false);
  frame = {
    ...frame,
    capture: "off-next",
    view: { ...frame.view, revision: 6 },
  };
  await publish();
  await expect(
    page.getByRole("button", { name: "Paste", exact: true }),
  ).toBeVisible();
  await expect.poll(() => app.windows().length).toBe(1);
  assert.equal(f.reads, reads);
  if (process.platform === "linux")
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isFocusable(),
      ),
      false,
      "turning off restores the original non-focusable recording role",
    );
});
