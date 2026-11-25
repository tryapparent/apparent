import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, electron, frontend as root } from "./testing/dependencies.ts";
import "./composer.smoke.ts";
import "./autostart.smoke.ts";
import { randomBytes } from "node:crypto";
import { availablePort, until } from "./testing/port.ts";
import { keyDirectory } from "../main/key.ts";
import {
  mailboxId,
  sign,
  authenticatedState,
} from "../../../hermes/desktop/controller.ts";
for (const scenario of [
  "running",
  "closed",
  "opening-occupied",
  "prepare-occupied",
  "native-occupied",
] as const)
  test(`real Electron interactive confirmation with synthetic CLI (${scenario})`, {
    timeout: 45000,
  }, async () => {
    const needsLaunch = scenario === "closed";
    const token = randomBytes(16).toString("hex");
    const job = await mkdtemp(
      path.join(tmpdir(), "apparent-dev-hermes-native-"),
    );
    const home = path.join(job, "home");
    await mkdir(home, { mode: 0o700 });
    const runtime = path.join(job, "runtime");
    await mkdir(runtime, { mode: 0o700 });
    const appData = path.join(job, "app-data");
    await mkdir(appData, { mode: 0o700 });
    const bootstrap = path.join(job, "bootstrap.cjs");
    await build({
      entryPoints: [path.join(import.meta.dirname, "testing/bootstrap.cts")],
      outfile: bootstrap,
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
    });
    const appAssets = path.join(job, "dist");
    await cp(path.join(root, "dist"), appAssets, { recursive: true });
    const mainBundle = path.join(appAssets, "hermes-main.cjs");
    const keyFile = path.join(
      process.platform === "linux" ? runtime : keyDirectory(),
      "apparent-hermes",
      `${token}.key`,
    );
    const bridgePort = await availablePort();
    const id = await mailboxId(token);
    let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
    let passed = false;
    const diagnostics: unknown[] = [];
    const gate = path.join(job, "release-probe");
    const trace = path.join(job, "trace.jsonl");
    const receipt = path.join(job, "receipt.json");
    const readCalls = async (): Promise<string[][]> =>
      (await readFile(trace, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    if (scenario === "opening-occupied")
      await writeFile(receipt + ".occupied", "1");
    const launch = async (port: number) =>
      electron.launch({
        args: [
          bootstrap,
          mainBundle,
          "--hermes-request",
          `${token}/${port}`,
          "--apparent-executable",
          path.join(import.meta.dirname, "testing/cli.ts"),
        ],
        env: {
          ...process.env,
          HOME: home,
          APPARENT_SYNTHETIC_APP_DATA: appData,
          XDG_RUNTIME_DIR: runtime,
          XDG_CONFIG_HOME: path.join(job, "config"),
          APPARENT_SYNTHETIC_NEEDS_LAUNCH: needsLaunch ? "1" : "0",
          APPARENT_SYNTHETIC_RECEIPT: receipt,
          APPARENT_SYNTHETIC_TRACE: trace,
          APPARENT_SYNTHETIC_PROBE_GATE: gate,
          APPARENT_SYNTHETIC_NATIVE_OCCUPIED:
            scenario === "native-occupied" ? "1" : "0",
        },
      });
    try {
      application = await launch(bridgePort);
      assert.equal(
        await application.evaluate(({ app }) => app.getPath("userData")),
        path.join(appData, "apparent-hermes"),
      );
      const page = await application.firstWindow();
      const key = await readFile(keyFile, "utf8");
      assert.notEqual(key, token);
      page.on("console", (entry) =>
        diagnostics.push({ console: entry.text() }),
      );
      page.on("requestfailed", (request) =>
        diagnostics.push({
          request: request.url(),
          failure: request.failure(),
        }),
      );
      page.on("response", (response) => {
        if (response.url().startsWith("http://127.0.0.1:"))
          diagnostics.push({
            response: response.url(),
            status: response.status(),
            headers: response.headers(),
          });
      });
      const record = page.getByRole("button", {
        name: "Record and send when finished",
      });
      await page
        .getByRole("status")
        .filter({ hasText: "Checking capture availability" })
        .waitFor();
      await until(() =>
        application!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible(),
        ),
      );
      assert.equal(await record.isDisabled(), true);
      await page.keyboard.press("Tab");
      assert.equal(
        await record.evaluate((button) => button === document.activeElement),
        false,
      );
      await page.keyboard.press("Enter");
      assert.deepEqual(
        await page.evaluate(() => window.hermesRecording!.start()),
        { phase: "confirm", availability: "pending" },
      );
      await until(async () => (await readCalls().catch(() => [])).length > 0);
      assert.deepEqual(await readCalls(), [["capture", "state"]]);
      await writeFile(gate, "1");
      assert.equal(
        await page.evaluate(() => typeof Reflect.get(window, "require")),
        "undefined",
      );
      const stateURL = `http://127.0.0.1:${bridgePort}/${id}/state/${await sign(key, `state:${id}`)}`;
      if (scenario.includes("occupied")) {
        if (scenario !== "opening-occupied") {
          if (scenario === "prepare-occupied") {
            await page.waitForFunction(() =>
              document.querySelector("main button:not(:disabled)"),
            );
            await writeFile(receipt + ".occupied", "1");
          }
          await record.click();
        }
        await page
          .getByRole("status")
          .filter({ hasText: "Finish the current Apparent capture" })
          .waitFor();
        assert.equal(await record.count(), 0);
        assert.deepEqual(
          await authenticatedState(
            key,
            await (
              await fetch(stateURL, { headers: { Origin: "null" } })
            ).json(),
          ),
          { phase: "error", code: "occupied" },
        );
        assert.equal(
          (await page.evaluate(() => window.hermesRecording!.start()))?.code,
          "occupied",
        );
        const calls = await readCalls();
        assert.equal(
          calls.filter((call) => call[1] === "start").length,
          scenario === "native-occupied" ? 1 : 0,
        );
        assert.ok(
          calls.every(
            (call) =>
              call[0] === "capture" && ["state", "start"].includes(call[1]),
          ),
        );
        passed = true;
        return;
      }
      const receiverHTML = path.join(job, "hermes-receiver.html");
      await writeFile(
        receiverHTML,
        '<!doctype html><meta charset="UTF-8"><title>Synthetic Hermes receiver</title><main>Transport probe only</main>',
      );
      const receiverReady = application.waitForEvent("window");
      await application.evaluate(async ({ BrowserWindow }, file) => {
        const receiver = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        await receiver.loadFile(file);
      }, receiverHTML);
      const receiver = await receiverReady;
      receiver.on("console", (entry) =>
        diagnostics.push({ receiverConsole: entry.text() }),
      );
      receiver.on("request", (request) => {
        void request
          .allHeaders()
          .then((headers) =>
            diagnostics.push({ receiverRequest: request.url(), headers }),
          );
      });
      const rendererReply = await receiver.evaluate(async (url) => {
        const response = await fetch(url, {
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
        });
        return {
          status: response.status,
          type: response.type,
          body: await response.text(),
          headers: Object.fromEntries(response.headers),
        };
      }, stateURL);
      diagnostics.push({ rendererReply });
      assert.equal(rendererReply.status, 200);
      assert.deepEqual(
        await authenticatedState(key, JSON.parse(rendererReply.body)),
        { phase: "confirm" },
      );
      await receiver.close();
      assert.deepEqual(
        await authenticatedState(
          key,
          await (await fetch(stateURL, { headers: { Origin: "null" } })).json(),
        ),
        { phase: "confirm" },
      );
      await record.focus();
      await page.keyboard.press("Enter");
      await page.evaluate(() => {
        void window.hermesRecording!.start();
      });
      await page
        .getByRole("status")
        .filter({ hasText: "Talk, point and draw." })
        .waitFor({ state: "attached" });
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((window) => window.isVisible()),
        ),
        false,
        "confirmation must stay hidden while native recording is active",
      );
      if (process.platform === "darwin") {
        assert.equal(
          await application.evaluate(({ app }) => app.isHidden()),
          true,
          "the entire confirmation app must hide on macOS",
        );
        assert.equal(
          await application.evaluate(({ app }) => app.isActive()),
          false,
          "the confirmation app must relinquish native focus",
        );
      }
      await writeFile(path.join(job, "receipt.json.finished"), "1");
      await page.getByText("Recording saved.", { exact: false }).waitFor();
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible(),
        ),
        true,
        "completion must be visible after the recording app was hidden",
      );
      if (process.platform === "darwin")
        assert.equal(
          await application.evaluate(({ app }) => app.isHidden()),
          false,
        );
      assert.deepEqual(
        await authenticatedState(
          key,
          await (await fetch(stateURL, { headers: { Origin: "null" } })).json(),
        ),
        {
          phase: "saved",
          bundlePath: "/synthetic/owned.apparent",
          remoteSource: null,
          source: "/synthetic/owned.apparent",
        },
      );
      const calls = await readCalls();
      assert.equal(
        calls.filter((c) => c[0] === "launch").length,
        needsLaunch ? 1 : 0,
        "only an unavailable recorder should be launched",
      );
      assert.equal(await page.title(), "Record for Hermes");
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getTitle(),
        ),
        "Record for Hermes",
      );
      assert.equal(calls.filter((c) => c[1] === "start").length, 1);
      assert.ok(
        calls
          .filter((c) => ["inspect", "handoff"].includes(c[1]))
          .every((c) => c[2] === token),
      );
      assert.ok(!calls.some((c) => ["stop", "cancel"].includes(c[1])));
      assert.equal(
        (
          await fetch(stateURL, {
            headers: { Origin: "https://example.invalid" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(
            `http://127.0.0.1:${bridgePort}/${id}/ack/${await sign(token, `ack:${id}`)}`,
            { method: "POST", headers: { Origin: "null" } },
          )
        ).status,
        404,
      );
      await fetch(
        `http://127.0.0.1:${bridgePort}/${id}/ack/${await sign(key, `ack:${id}`)}`,
        { method: "POST", headers: { Origin: "null" } },
      );
      await new Promise<void>((resolve) => {
        if (application!.process().exitCode !== null) resolve();
        else application!.process().once("exit", () => resolve());
      });
      await assert.rejects(readFile(keyFile), { code: "ENOENT" });
      if (!needsLaunch) {
        application = await launch(await availablePort());
        const replay = await application.firstWindow();
        await replay
          .getByRole("button", { name: "Record and send when finished" })
          .click();
        await replay
          .getByText(
            "Any recording already started remains in Apparent. Nothing is retried automatically.",
          )
          .waitFor();
        const after = (await readFile(path.join(job, "trace.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.equal(
          after.filter((call) => call[1] === "start").length,
          1,
          "replayed ID must never start another take",
        );
        assert.equal(after.filter((call) => call[0] === "launch").length, 0);
      }
      passed = true;
    } catch (error) {
      const view = await application
        ?.windows()[0]
        ?.evaluate(() => window.hermesRecording!.read())
        .catch(() => undefined);
      const trace = await readFile(path.join(job, "trace.jsonl"), "utf8").catch(
        () => "unavailable",
      );
      console.error("Synthetic Hermes smoke failure", { view, trace });
      throw error;
    } finally {
      await writeFile(
        path.join(job, "diagnostics.json"),
        JSON.stringify(diagnostics, null, 2),
      );
      await application?.close().catch(() => {});
      if (passed) await rm(job, { recursive: true, force: true });
      else console.log(`Failed synthetic bridge evidence: ${job}`);
    }
  });
