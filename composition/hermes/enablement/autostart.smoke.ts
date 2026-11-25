import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, electron, frontend as root } from "./testing/dependencies.ts";
import { randomBytes } from "node:crypto";
import { availablePort, until, waitForKey } from "./testing/port.ts";
import { keyDirectory } from "../main/key.ts";
import {
  mailboxId,
  sign,
  authenticatedState,
} from "../../../hermes/desktop/controller.ts";

test("trusted local autostart records through the signed mailbox without creating a Hermes-facing window", {
  timeout: 45000,
}, async () => {
  const token = randomBytes(16).toString("hex");
  const job = await mkdtemp(
    path.join(tmpdir(), "apparent-dev-hermes-autostart-"),
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
  const mainBundle = path.join(root, "dist/hermes-main.cjs");
  const keyFile = path.join(
    process.platform === "linux" ? runtime : keyDirectory(),
    "apparent-hermes",
    `${token}.key`,
  );
  const port = await availablePort();
  const id = await mailboxId(token);
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let passed = false;
  try {
    application = await electron.launch({
      args: [
        bootstrap,
        mainBundle,
        "--hermes-request",
        `${token}/${port}`,
        "--hermes-autostart",
        "--apparent-executable",
        path.join(import.meta.dirname, "testing/cli.ts"),
      ],
      env: {
        ...process.env,
        HOME: home,
        APPARENT_SYNTHETIC_APP_DATA: appData,
        XDG_RUNTIME_DIR: runtime,
        XDG_CONFIG_HOME: path.join(job, "config"),
        APPARENT_SYNTHETIC_NEEDS_LAUNCH: "1",
        APPARENT_SYNTHETIC_STARTUP_DELAY_MS: "8000",
        APPARENT_SYNTHETIC_RECEIPT: path.join(job, "receipt.json"),
        APPARENT_SYNTHETIC_TRACE: path.join(job, "trace.jsonl"),
      },
    });
    const key = await waitForKey(() => readFile(keyFile, "utf8"));
    const stateURL = `http://127.0.0.1:${port}/${id}/state/${await sign(key, `state:${id}`)}`;
    const readState = async () =>
      authenticatedState(
        key,
        await (await fetch(stateURL, { headers: { Origin: "null" } })).json(),
      );
    await until(async () => (await readState())?.phase === "recording", 20000);
    assert.equal(
      await application.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
      0,
    );
    const calls = (await readFile(path.join(job, "trace.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      calls.some((call) => call[0] === "launch" && call[1] === "--background"),
    );
    assert.equal(calls.filter((call) => call[1] === "start").length, 1);
    await writeFile(path.join(job, "receipt.json.finished"), "1");
    await until(async () => (await readState())?.phase === "saved");
    assert.equal(
      await application.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
      0,
    );
    const ackURL = `http://127.0.0.1:${port}/${id}/ack/${await sign(key, `ack:${id}`)}`;
    assert.equal(
      (await fetch(ackURL, { method: "POST", headers: { Origin: "null" } }))
        .status,
      200,
    );
    await new Promise<void>((resolve) => {
      if (application!.process().exitCode !== null) resolve();
      else application!.process().once("exit", () => resolve());
    });
    await assert.rejects(readFile(keyFile), { code: "ENOENT" });
    passed = true;
  } finally {
    await application?.close().catch(() => {});
    if (passed) await rm(job, { recursive: true, force: true });
    else console.log(`Failed synthetic autostart evidence: ${job}`);
  }
});
