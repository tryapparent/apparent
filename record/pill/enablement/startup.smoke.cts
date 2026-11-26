const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const frontend = path.resolve(
  __dirname,
  "../../../capture/desktop/ui/frontend",
);
const requireFrontend = require("node:module").createRequire(
  path.join(frontend, "package.json"),
);
const { _electron: electron, expect } = requireFrontend("@playwright/test");

async function launchPill(t, prefix, extraEnvironment = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const application = await electron.launch({
    args: [path.join(frontend, "tests/pill/host.cjs"), "--no-sandbox"],
    env: {
      ...process.env,
      ...extraEnvironment,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, "config"),
    },
  });
  t.after(async () => {
    await application.close().catch(() => {});
    await fs.rm(home, { recursive: true, force: true });
  });
  return application;
}

const hidden = {
  revision: 1,
  phase: "hidden",
  clock: "00:00",
  label: "Recording",
  warning: null,
  notice: null,
  reducedMotion: false,
  draggable: true,
  inputWaveform: null,
  noteCount: 0,
  actions: [],
};
const recording = {
  ...hidden,
  revision: 2,
  phase: "recording",
  inputWaveform: Array(24).fill(0.2),
  actions: [
    {
      id: "finish",
      label: "Finish",
      enabled: true,
      selected: false,
      primary: true,
    },
    {
      id: "whiteboard",
      label: "Whiteboard",
      enabled: true,
      selected: false,
      primary: false,
    },
    {
      id: "cancel",
      label: "Cancel",
      enabled: true,
      selected: false,
      primary: false,
    },
  ],
};

test("the first Linux spinner shows after layout without waiting for hidden-window paints", {
  skip: process.platform !== "linux",
}, async (t) => {
  const application = await launchPill(t, "pill-early-spinner-", {
    HYPRLAND_INSTANCE_SIGNATURE: "startup-test",
  });
  const page = await application.firstWindow();
  const publish = (view) =>
    application.evaluate(
      (_e, view) =>
        process.stdin.emit(
          "data",
          JSON.stringify({ type: "state", view }) + "\n",
        ),
      view,
    );
  await publish(hidden);
  await page.waitForFunction(
    async () => (await window.apparentPill?.read())?.revision === 1,
  );
  await page.evaluate(() => window.apparentPill.layout(1));
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const evaluate = window.webContents.executeJavaScript.bind(
      window.webContents,
    );
    window.restoreEvaluation = () => {
      window.webContents.executeJavaScript = evaluate;
    };
    window.webContents.executeJavaScript = (code, ...args) =>
      code.includes("requestAnimationFrame(()=>requestAnimationFrame(")
        ? new Promise(() => {})
        : evaluate(code, ...args);
  });
  await publish({
    ...recording,
    label: "Starting recording…",
    draggable: false,
    actions: [
      {
        id: "whiteboard",
        label: "Whiteboard",
        enabled: false,
        selected: false,
        primary: false,
      },
      { ...recording.actions[0], enabled: false, primary: false },
      recording.actions[2],
    ],
  });
  await expect(page.locator(".indicator.starting")).toHaveCount(1);
  const visible = () =>
    application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    );
  assert.equal(await visible(), false);
  await application.evaluate(({ BrowserWindow }) => {
    const id = Number(
      BrowserWindow.getAllWindows()[0].getMediaSourceId().split(":")[1],
    );
    process.stdin.emit(
      "data",
      JSON.stringify({ type: "activate", windowId: id }) + "\n",
    );
  });
  await expect.poll(visible, { timeout: 1500 }).toBe(true);
  assert.equal(
    await application.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width,
    ),
    Math.ceil((await page.locator(".pill-row").boundingBox()).width),
  );
  await expect(
    page.getByRole("button", { name: "Finish", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeEnabled();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].restoreEvaluation(),
  );
  const geometry = async (revision) => {
    await expect(page.locator("main")).toHaveAttribute(
      "data-revision",
      String(revision),
    );
    await page.evaluate((value) => window.apparentPill.layout(value), revision);
    return {
      row: await page.locator(".pill-row").boundingBox(),
      native: await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBounds(),
      ),
    };
  };
  await publish({ ...recording, revision: 3 });
  const empty = await geometry(3);
  assert.equal(empty.native.width, Math.ceil(empty.row.width));
  const micWarning = "Microphone unavailable; screen recording continues";
  await publish({ ...recording, revision: 4, micWarning });
  const microphone = await geometry(4);
  await expect(page.locator(".microphone-warning svg")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: micWarning }),
  ).toHaveCount(1);
  await expect(page.locator(".warning")).toHaveCount(0);
  assert.equal(microphone.native.height, empty.native.height);
  const proof = process.env.APPARENT_PILL_EVIDENCE;
  for (const scheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator(".microphone-warning")).toHaveAttribute(
      "title",
      micWarning,
    );
    await expect(page.getByRole("button", { name: "Finish" })).toBeInViewport();
    if (proof) {
      await fs.mkdir(proof, { recursive: true });
      await page.locator(".pill-row").screenshot({
        path: path.join(proof, `microphone-${scheme}.png`),
      });
    }
  }
  await publish({ ...recording, revision: 5, noteCount: 1 });
  const populated = await geometry(5);
  assert.deepEqual(populated.row, empty.row);
  assert.equal(populated.native.x, empty.native.x);
  assert.equal(populated.native.width, empty.native.width + 72);

  await publish({ ...recording, revision: 6 });
  const reset = await geometry(6);
  await application.evaluate(({ BrowserWindow }, originalWidth) => {
    const pill = BrowserWindow.getAllWindows()[0];
    const setBounds = pill.setBounds.bind(pill);
    pill.setBounds = (bounds) => {
      if (bounds.width === originalWidth) setBounds(bounds);
    };
  }, reset.native.width);
  await publish({ ...recording, revision: 7, noteCount: 1 });
  const clipped = await geometry(7);
  const layout = await page.evaluate(() => ({
    requestedWidth: Math.ceil(
      document.querySelector("main").getBoundingClientRect().width,
    ),
    viewportWidth: innerWidth,
    noteRight: Math.ceil(
      document.querySelector(".pill-notes-layer").getBoundingClientRect().right,
    ),
  }));
  t.diagnostic(
    JSON.stringify({
      simulatedResizeIgnored: true,
      windowWidth: clipped.native.width,
      ...layout,
    }),
  );
  assert.equal(clipped.native.width, reset.native.width);
  assert.equal(layout.viewportWidth, reset.native.width);
  assert.equal(layout.requestedWidth, populated.native.width);
  assert.equal(layout.noteRight, populated.native.width);
});
