import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  Operation,
  Paper,
  Point,
} from "../../../../record/pill/whiteboard/renderer";

const frontend = fileURLToPath(
  new URL("../../../../capture/desktop/ui/frontend/", import.meta.url),
);
const require = createRequire(join(frontend, "package.json"));
const { chromium, expect } =
  require("@playwright/test") as typeof import("@playwright/test");
const electron: string = require("electron");

type Edit = {
  type: "edit";
  sequence: number;
  operation: Operation;
  point?: Point;
};
type Ready = { type: "ready"; frame: number[] };

async function launch(t: TestContext, practice: boolean, paper: Paper) {
  const scratch = await mkdtemp(
    join(tmpdir(), "apparent-dev-whiteboard-render-"),
  );
  const staged =
    process.env.APPARENT_WHITEBOARD_STAGE ?? join(frontend, "dist/whiteboard");
  await cp(staged, join(scratch, "app"), {
    recursive: true,
  });
  const child = spawn(
    electron,
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${join(scratch, "profile")}`,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      join(scratch, "app/main.cjs"),
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const exit = new Promise((resolve) => child.once("exit", resolve));
  child.stdin.on("error", () => {});
  t.after(async () => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 3000);
    try {
      await exit;
    } finally {
      clearTimeout(timer);
    }
    await rm(scratch, { recursive: true, force: true });
  });
  const send = (message: object) =>
    child.stdin.write(JSON.stringify(message) + "\n");
  const received: Array<Ready | Edit> = [];
  readline
    .createInterface({ input: child.stdout })
    .on("line", (line) => received.push(JSON.parse(line)));
  const endpoint = new Promise<string>((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () =>
        reject(Error(log || "Electron did not publish a debugger endpoint")),
      8000,
    );
    child.stderr.on("data", (bytes) => {
      log += bytes;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  send({ type: "initial", practice, paper });
  const browser = await chromium.connectOverCDP(await endpoint);
  const home = browser.contexts()[0];
  const page = home.pages()[0] || (await home.waitForEvent("page"));
  await expect(page.getByRole("heading", { name: "Whiteboard" })).toBeVisible();
  await expect.poll(() => received[0]?.type).toBe("ready");
  const edits = () =>
    received.filter((message): message is Edit => message.type === "edit");
  async function reply(operation: Operation, paper: Paper) {
    await expect.poll(() => edits().at(-1)?.operation).toBe(operation);
    send({ type: "paper", sequence: edits().at(-1)?.sequence, paper });
  }
  return { page, home, edits, reply, exit };
}

const blank: Paper = { color: [59, 121, 189], strokes: [] };
const kept: Paper = {
  ...blank,
  strokes: [
    [
      [35, 40],
      [140, 92],
    ],
  ],
};

test("staged Whiteboard renders accepted ink and puts editing behind the parent channel", {
  timeout: 30_000,
}, async (t) => {
  const { page, home, edits, reply, exit } = await launch(t, false, blank);
  const canvas = page.getByRole("img", { name: "Whiteboard drawing canvas" });
  const undo = page.getByRole("button", { name: "Undo" });
  const clear = page.getByRole("button", { name: "Clear" });
  await expect(undo).toBeDisabled();
  await expect(clear).toBeDisabled();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close whiteboard" }),
  ).toBeFocused();
  await expect(page.getByRole("status")).toHaveCount(0);
  const points: Point[] = [];
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  await canvas.dispatchEvent("pointerdown", {
    button: 0,
    pointerId: 1,
    clientX: 42,
    clientY: 140,
  });
  assert.deepEqual(edits(), []);
  await assert.rejects(
    page.evaluate(() => window.apparentWhiteboard.edit("move", [-1, 40])),
  );
  await page.mouse.move(bounds.x + 35, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 140, bounds.y + 92, { steps: 6 });
  await expect(canvas.locator("polyline")).toHaveCount(1);
  await page.mouse.up();
  await reply("end", kept);
  for (const edit of edits()) if (edit.point) points.push(edit.point);
  assert.deepEqual(points[0], [35, 40]);
  assert.deepEqual(points.at(-1), [140, 92]);
  await expect(undo).toBeEnabled();
  await expect(canvas.locator("polyline")).toHaveAttribute(
    "points",
    "35,40 140,92",
  );

  const session = await home.newCDPSession(page);
  for (const width of [720, 320]) {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: width === 720 ? 540 : 280,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const close = await page
        .getByRole("button", { name: "Close whiteboard" })
        .boundingBox();
      assert.ok(close && close.x + close.width <= width && close.width >= 44);
      const evidence = process.env.APPARENT_WHITEBOARD_EVIDENCE;
      if (evidence)
        await page.screenshot({
          path: join(evidence, `board-${width}-${colorScheme}.png`),
        });
    }
  }
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(undo).toBeDisabled();
  await reply("undo", blank);
  await expect(canvas.locator("polyline")).toHaveCount(0);
  void session.send("Page.crash").catch(() => {});
  assert.equal(await exit, 1);
});

test("the practice board keeps accepted ink until the user closes it", {
  timeout: 20_000,
}, async (t) => {
  const { page, home, edits, reply } = await launch(t, true, blank);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByText("Your turn")).toBeVisible();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollHeight),
    await page.evaluate(() => innerHeight),
  );
  assert.deepEqual(edits(), []);
  const canvas = page.getByRole("img", { name: "Whiteboard drawing canvas" });
  await canvas.click({ position: { x: 60, y: 100 } });
  await reply("end", { ...blank, strokes: [[[60, 100]]] });
  await page.waitForTimeout(2100);
  assert.equal(edits().at(-1)?.operation, "end");
  await expect(canvas.locator("circle")).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveText("Close when you’re done.");
  await expect(page.locator(".native-board-lesson path")).toHaveCount(0);
  const metrics = await home.newCDPSession(page);
  for (const width of [720, 320]) {
    await metrics.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: width === 720 ? 540 : 280,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const status = await page.getByRole("status").boundingBox();
      assert.ok(status && status.x >= 0 && status.x + status.width <= width);
      const evidence = process.env.APPARENT_WHITEBOARD_EVIDENCE;
      if (evidence)
        await page.screenshot({
          path: join(evidence, `practice-ink-${width}-${colorScheme}.png`),
        });
    }
  }
  await page.keyboard.press("Escape");
  await expect.poll(() => edits().at(-1)?.operation).toBe("close");
});
