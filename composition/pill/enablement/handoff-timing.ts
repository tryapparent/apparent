import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("time desktop destination selection and verified isolated handoff", {
  timeout: 45000,
}, async (t) => {
  const out = process.env.APPARENT_BENCH_RESULTS;
  assert.ok(out && isAbsolute(out), "Provide a private results directory");
  const root = process.env.APPARENT_BENCH_HANDOFF_ROOT;
  assert.ok(
    root && root.startsWith("/tmp/apparent-dev-") && isAbsolute(root),
    "Provide a private extracted AppImage",
  );
  assert.ok(
    process.env.DISPLAY &&
      !process.env.WAYLAND_DISPLAY &&
      !process.env.DBUS_SESSION_BUS_ADDRESS,
    "Launch the test in a dedicated Xvfb display without a desktop bus",
  );
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const frontend = join(repo, "capture/desktop/ui/frontend");
  const requireFrontend = createRequire(join(frontend, "package.json"));
  const { _electron: electron, expect } = requireFrontend("@playwright/test");
  const { fixture } = await import("./testing/server.ts");
  const f = await fixture(t);
  f.many();
  await f.save(false);
  const settings = join(root, "usr/share/apparent/settings");
  const hostDir = await mkdtemp(join(settings, "bench-handoff-"));
  t.after(async () => {
    await rm(hostDir, { recursive: true, force: true });
  });
  const pillDir = join(hostDir, "tests/pill");
  await mkdir(pillDir, { recursive: true });
  const host = join(pillDir, "host.cjs");
  const source = await readFile(join(frontend, "tests/pill/host.cts"), "utf8");
  await writeFile(
    host,
    source.replace(
      "../../electron/pill/main.cjs",
      join(settings, "app/electron/pill/main.cjs"),
    ),
    { flag: "wx", mode: 0o600 },
  );
  const app = await electron.launch({
    executablePath: join(settings, "runtime/electron"),
    args: [host, "--no-sandbox", "--ozone-platform=x11"],
    env: {
      ...process.env,
      APPARENT_CONFIG: f.config,
      HOME: f.home,
      XDG_CONFIG_HOME: join(f.home, "config"),
      XDG_RUNTIME_DIR: f.home,
      LD_LIBRARY_PATH: join(root, "usr/lib"),
      HYPRLAND_INSTANCE_SIGNATURE: "synthetic-benchmark",
      APPARENT_DESKTOP_REPORTING: "0",
    },
  });
  t.after(async () => {
    await app.close();
  });
  await app.firstWindow();
  let buffer = "";
  app.process().stdout.on("data", (chunk: Buffer) => {
    buffer += String(chunk);
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.ready)
        void app
          .evaluate(
            (_electron: unknown, id: number) =>
              process.stdin.emit(
                "data",
                JSON.stringify({ type: "activate", windowId: id }) + "\n",
              ),
            message.windowId,
          )
          .catch(() => {});
    }
  });
  const handoff = "Synthetic benchmark recording handoff";
  const frame = {
    type: "state",
    capture: "benchmark-on",
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
  const publish = (value: unknown) =>
    app.evaluate(
      (_electron: unknown, state: unknown) =>
        process.stdin.emit("data", JSON.stringify(state) + "\n"),
      value,
    );
  const initial = app.windows()[0];
  await publish({ ...frame, capture: "benchmark-off" });
  await expect(
    initial.getByRole("button", { name: "Paste", exact: true }),
  ).toBeVisible();
  await f.save(true);
  const replacement = app.waitForEvent("window", { timeout: 10000 });
  await publish(frame);
  const page = await replacement;
  const heartbeat = setInterval(() => void publish(frame).catch(() => {}), 500);
  t.after(() => clearInterval(heartbeat));
  const trigger = page.getByRole("combobox").first();
  await expect(trigger).toBeEnabled();
  await publish({
    type: "handoff-ready",
    capture: frame.capture,
    text: handoff,
  });

  const pickerStart = performance.now();
  await trigger.click();
  const chosen = page.getByRole("option", { name: /Chosen thread/ }).first();
  await expect(chosen).toBeVisible({ timeout: 10000 });
  await expect(chosen).toBeEnabled();
  const pickerMs = performance.now() - pickerStart;
  assert.equal(f.calls.length, 0);

  const sendStart = performance.now();
  await chosen.click();
  await expect(
    page.getByRole("img", { name: "Submitted", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const sendMs = performance.now() - sendStart;
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].payload.threadId, "thread");
  assert.equal(f.calls[0].payload.text, handoff);
  assert.equal(f.accepted.size, 1);
  const version = execFileSync(join(root, "AppRun"), ["--version"], {
    encoding: "utf8",
  }).trim();
  await writeFile(
    join(out, "t3-handoff-waits.json"),
    JSON.stringify(
      {
        version,
        waits: {
          destinations: { ms: pickerMs, verified: true },
          send: { ms: sendMs, verified: true },
        },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
});
