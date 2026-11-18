import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";

const frontend = path.resolve(
  import.meta.dirname,
  "../../../capture/desktop/ui/frontend",
);
const require = createRequire(path.join(frontend, "package.json"));
const { chromium } =
  require("@playwright/test") as typeof import("@playwright/test");

test("Quit choices persist a changed preference and recover after native failure", {
  timeout: 30_000,
}, async () => {
  const userData = await mkdtemp(path.join(tmpdir(), "apparent-quit-test-"));
  const child = spawn(require("electron") as string, [
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${userData}`,
    path.join(frontend, "dist/quit/main.cjs"),
    JSON.stringify({
      checked: true,
      available: true,
      needsApproval: false,
      desktopShortcutPossible: false,
    }),
  ]);
  const exited = once(child, "exit");
  const messages = readline.createInterface({ input: child.stdout });
  const lines = messages[Symbol.asyncIterator]();
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-4000);
        const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\S+)/.exec(
          stderr,
        );
        if (match) resolve(match[1]);
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(Error(`Quit dialog exited ${code}: ${stderr}`)),
      );
    });
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const window = context.pages()[0] ?? (await context.waitForEvent("page"));
    const checkbox = window.getByRole("checkbox", {
      name: "Start Apparent when I sign in",
    });
    const keep = window.getByRole("button", { name: "Keep shortcut active" });
    const quit = window.getByRole("button", { name: "Quit", exact: true });
    await keep.waitFor();
    assert.equal((await lines.next()).value, "ready");
    assert.equal(
      await window.evaluate(() => document.activeElement?.textContent),
      "Keep shortcut active",
    );
    assert.equal(await checkbox.isChecked(), true);
    const proof = process.env.APPARENT_QUIT_PROOF;
    const cdp = await context.newCDPSession(window);
    if (proof) await mkdir(proof, { recursive: true });
    for (const width of [480, 320])
      for (const colorScheme of ["light", "dark"] as const) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 280,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await window.emulateMedia({ colorScheme });
        await window.evaluate(() => document.fonts.ready.then(() => undefined));
        assert.equal(await window.evaluate(() => innerWidth), width);
        assert.equal(
          await window.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
          0,
        );
        if (proof)
          await window.screenshot({
            path: path.join(proof, `quit-${width}-${colorScheme}-on.png`),
          });
      }
    await checkbox.uncheck();
    if (proof)
      await window.screenshot({
        path: path.join(proof, "quit-320-dark-off.png"),
      });

    await keep.click();
    assert.deepEqual(JSON.parse((await lines.next()).value), {
      quit: false,
      checked: false,
    });
    assert.equal(await quit.isDisabled(), true);
    child.stdin.write("failed\n");
    const error = window.getByRole("alertdialog");
    await error.waitFor();
    if (proof)
      await window.screenshot({ path: path.join(proof, "quit-error.png") });
    await error.getByRole("button", { name: "Close" }).click();
    assert.equal(await checkbox.isChecked(), false);
    assert.equal(
      await window.evaluate(() => document.activeElement?.textContent),
      "Keep shortcut active",
    );

    await quit.click();
    assert.deepEqual(JSON.parse((await lines.next()).value), {
      quit: true,
      checked: false,
    });
    child.stdin.write("saved\n");
    assert.deepEqual(await exited, [0, null]);
  } finally {
    child.kill();
    await exited.catch(() => {});
    await rm(userData, { recursive: true, force: true });
  }
});
