const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { once } = require("node:events");
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

test("packaged Record result reaches the pill and survives renderer reload", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "record-pill-"));
  const application = await electron.launch({
    args: [path.join(frontend, "tests/pill/host.cjs"), "--no-sandbox"],
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, "config"),
    },
  });
  t.after(async () => {
    await application.close().catch(() => {});
    await fs.rm(home, { recursive: true, force: true });
  });
  const page = await application.firstWindow();
  const runtime = requireFrontend("electron");
  const worker = spawn(
    runtime,
    [path.join(frontend, "electron/record-completion/worker.js")],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  t.after(() => worker.kill());
  const exit = once(worker, "exit");
  const lines = createInterface({ input: worker.stdout })[
    Symbol.asyncIterator
  ]();
  worker.stdin.write(
    JSON.stringify({
      version: 1,
      current: true,
      context: {
        capture: {
          generation: "9",
          captureId: "synthetic-a",
          requestId: "synthetic-request",
        },
        platform: process.platform === "linux" ? "linux" : "macos",
        source: "screen",
        agentRequested: false,
        autoPasteEnabled: false,
        pasteTargetAvailable: false,
        lab: false,
      },
      outcome: { kind: "saved", bundlePath: "/synthetic/a.apparent" },
    }) + "\n",
  );
  const initial = JSON.parse((await lines.next()).value);
  assert.equal(initial.effects[0].mode, "bundle");
  const text = "Synthetic saved capture handoff";
  assert.equal(
    await application.evaluate(({ clipboard }, text) => {
      clipboard.writeText(text);
      return clipboard.readText();
    }, text),
    text,
  );
  worker.stdin.write(JSON.stringify({ result: "copied" }) + "\n");
  const completed = JSON.parse((await lines.next()).value);
  assert.deepEqual(await exit, [0, null]);
  assert.equal(completed.state.observation.clipboard, "copied");
  const view = {
    revision: 1,
    phase: "completed",
    clock: "00:04",
    label: completed.state.status,
    warning: null,
    notice: null,
    reducedMotion: true,
    draggable: false,
    inputWaveform: null,
    actions: [
      {
        id: "paste",
        label: "Paste",
        enabled: true,
        selected: false,
        primary: true,
      },
      {
        id: "inspect",
        label: "Inspect",
        enabled: true,
        selected: false,
        primary: false,
      },
      {
        id: "dismiss",
        label: "Dismiss",
        enabled: true,
        selected: false,
        primary: false,
      },
    ],
  };
  await application.evaluate((_electron, view) => {
    process.stdin.emit("data", JSON.stringify({ type: "state", view }) + "\n");
    process.stdin.emit("data", JSON.stringify({ type: "activate" }) + "\n");
  }, view);
  await expect(page.getByRole("status")).toHaveText("Saved · copied");
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Saved · copied");
  assert.equal(
    await application.evaluate(({ clipboard }) => clipboard.readText()),
    text,
  );
  await expect(
    page.getByRole("button", { name: "Inspect", exact: true }),
  ).toBeEnabled();
  assert.deepEqual(
    await page
      .locator(".controls button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      ),
    ["Inspect", "Paste", "Dismiss"],
  );
  await expect(
    page.getByRole("button", { name: "Paste", exact: true }),
  ).toHaveAttribute("data-primary", "true");
  await page.getByRole("button", { name: "Inspect", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Paste", exact: true }),
  ).toBeFocused();
  assert.equal(
    await page.evaluate(() =>
      document.body.textContent.includes("/synthetic/"),
    ),
    false,
  );
  const slots = await page
    .locator(".indicator-slot,.controls button")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, width } = node.getBoundingClientRect();
        return { width, center: x + width / 2 };
      }),
    );
  assert.deepEqual(
    slots.map((slot) => slot.width),
    [44, 44, 44, 44],
  );
  assert.deepEqual(
    slots.slice(1).map((slot, index) => slot.center - slots[index].center),
    [46, 46, 46],
  );
  const evidence = process.env.APPARENT_PILL_EVIDENCE;
  if (evidence)
    await page.screenshot({
      path: path.join(evidence, "completion-icon-row.png"),
    });
  await application.evaluate(
    (_electron, view) =>
      process.stdin.emit(
        "data",
        JSON.stringify({ type: "state", view }) + "\n",
      ),
    {
      ...view,
      revision: 2,
      label: "Saved · open bundle (copy failed)",
      copyFailed: true,
      actions: view.actions.map((action) =>
        action.id === "paste" ? { ...action, enabled: false } : action,
      ),
    },
  );
  await expect(page.getByRole("alert")).toHaveText(
    "Couldn’t copy the recording",
  );
  await expect(
    page.getByRole("button", { name: "Paste", exact: true }),
  ).toBeDisabled();
  const recovery = page.getByRole("button", {
    name: "Inspect recording",
    exact: true,
  });
  await expect(recovery).toBeEnabled();
  await recovery.focus();
  await expect(recovery).toBeFocused();
  const row = await page.locator(".pill-row").boundingBox();
  const card = await page
    .locator(".pill-completion-notification")
    .boundingBox();
  assert.ok(row && card);
  assert.equal(card.y - row.y - row.height, 4);
  assert.equal(card.x + card.width / 2, row.x + row.width / 2);
  if (evidence)
    await page.screenshot({
      path: path.join(evidence, "completion-copy-failure.png"),
    });
});
