import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as pause } from "node:timers/promises";
import { promisify } from "node:util";

const now = () => Number(process.hrtime.bigint()) / 1e6;
const run = promisify(execFile);
const mime = "text/plain;charset=utf-8";
const originalClipboard = "Independent clipboard change";
const editorTitle = "Apparent synthetic draft";
const version = "handoff-linux-focused-transcript-draft-v1";
const report = (value: object) =>
  appendFileSync("/out/replay.jsonl", JSON.stringify(value) + "\n");
const command = (file: string, args: string[]) =>
  execFileSync(file, args, {
    timeout: 4000,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trimEnd();
const readClipboard = () =>
  execFileSync("/usr/bin/wl-paste", ["--no-newline", "--type", mime], {
    timeout: 4000,
  });
type Window = { address: string; pid: number; title: string; class: string };
const active = (): Window =>
  JSON.parse(command("hyprctl", ["-j", "activewindow"]));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const revisions = JSON.parse(readFileSync("/bench/revisions.json", "utf8")) as {
  control: string;
  candidate: string;
};
const ticksPerSecond = Number(command("getconf", ["CLK_TCK"]));
assert.ok(ticksPerSecond > 0 && Number.isSafeInteger(ticksPerSecond));
assert.equal(process.getuid?.(), 2000);
assert.equal(command("ls", ["/sys/class/net"]), "lo");
const compositor = JSON.parse(command("hyprctl", ["-j", "version"]));
assert.match(compositor.version, /^0\.56\./);
assert.match(
  command("hyprctl", ["keyword", "apparent_probe", "1"]),
  /non-legacy/,
);
const monitors = JSON.parse(command("hyprctl", ["-j", "monitors"]));
assert.equal(monitors.length, 1);
assert.ok(monitors[0].width > 0 && monitors[0].height > 0);
report({
  version,
  revisions,
  compositor,
  monitors,
  ticksPerSecond,
  network: "loopback only",
});

function guestPressure() {
  const cpu = /^cpu\s+(.+)$/m
    .exec(readFileSync("/proc/stat", "utf8"))?.[1]
    .trim()
    .split(/\s+/)
    .map(Number);
  const ioUs = Number(
    /^some .* total=(\d+)$/m.exec(
      readFileSync("/proc/pressure/io", "utf8"),
    )?.[1],
  );
  assert.ok(
    cpu &&
      cpu.length >= 8 &&
      cpu.every(Number.isSafeInteger) &&
      Number.isSafeInteger(ioUs),
  );
  return {
    atMs: now(),
    ioUs,
    ticks: cpu.slice(0, 8).reduce((sum, value) => sum + value, 0),
    steal: cpu[7],
  };
}

async function until<T>(
  test: () => T | undefined | false,
  name: string,
): Promise<T> {
  const deadline = now() + 10_000;
  while (now() < deadline) {
    const result = test();
    if (result) return result;
    await pause(15);
  }
  throw Error("Timed out waiting for " + name);
}

function logged(
  file: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  log: string,
) {
  const fd = openSync(log, "wx", 0o600);
  try {
    return spawn(file, args, { env: environment, stdio: ["ignore", fd, fd] });
  } finally {
    closeSync(fd);
  }
}

function resources(pid: number) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    .split(") ")[1]
    .split(" ");
  const rssKiB = Number(
    /^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1],
  );
  const cpuTicks = Number(stat[11]) + Number(stat[12]);
  assert.ok(Number.isSafeInteger(cpuTicks) && rssKiB > 0);
  return { cpuTicks, rssKiB };
}

async function arm(
  batch: string,
  index: number,
  build: "control" | "candidate",
) {
  const name = batch + "-" + index;
  const work = join("/home/benchmark", name);
  const config = join(work, "config");
  const captures = join(work, "captures");
  const bundle = join(captures, "synthetic.apparent");
  const fault = join(work, "fault");
  const overrides = join(work, "overrides");
  const log = join("/out", name + ".log");
  mkdirSync(join(config, "apparent"), { recursive: true });
  mkdirSync(bundle, { recursive: true });
  mkdirSync(overrides);
  const manifest = join(bundle, "apparent.json");
  const sheet = join(bundle, "contact-sheet.png");
  writeFileSync(
    sheet,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  writeFileSync(
    join(config, "apparent/config.json"),
    JSON.stringify({
      onboarding: { seen: true, firstCaptureCompleted: true },
      launchAtLogin: false,
      errorReporting: false,
      labs: { autoPasteDraft: false },
      agents: { t3DestinationPicker: false },
    }),
  );
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: join(work, "data"),
    XDG_CACHE_HOME: join(work, "cache"),
    APPARENT_CAPTURES_DIR: captures,
    APPARENT_NO_ONBOARDING: "1",
    PASTE_CLIPBOARD_FAULT: fault,
    PATH: overrides + ":" + process.env.PATH,
  };
  const executable = "/bench/" + build + "/apparent";
  const appVersion = command(executable, ["--version"]);
  assert.ok(
    appVersion.endsWith(" · " + revisions[build].slice(0, 7)),
    appVersion,
  );
  const app = logged(executable, ["launch", "--background"], env, log);
  const editor = spawn("gjs", ["-m", "/bench/editor.mjs"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const draftEvents: { ms: number; focused: boolean; bytes: Buffer }[] = [];
  let enters = 0;
  const lines = createInterface({ input: editor.stdout });
  lines.on("line", (line) => {
    if (line === "enter") {
      enters += 1;
      return;
    }
    const match = /^draft (\d+) ([01]) ([0-9a-f]*)$/.exec(line);
    assert.ok(match, line);
    draftEvents.push({
      ms: Number(match[1]) / 1000,
      focused: match[2] === "1",
      bytes: Buffer.from(match[3], "hex"),
    });
  });
  const stop = (child: typeof app) => {
    if (child.exitCode !== null || child.signalCode !== null)
      return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  };
  try {
    const supervisor = app.pid!;
    const socket = join(process.env.XDG_RUNTIME_DIR!, "apparent.sock");
    const pid = await until(() => {
      assert.equal(app.exitCode, null, "Apparent exited during startup");
      const gui = Number(
        /run_app started pid=(\d+)/.exec(readFileSync(log, "utf8"))?.[1],
      );
      if (!gui) return;
      const status = readFileSync(`/proc/${gui}/status`, "utf8");
      assert.equal(Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]), supervisor);
      if (
        command("ss", ["-xlpnH"])
          .split("\n")
          .some(
            (row) =>
              row.includes(socket + " ") && row.includes("pid=" + gui + ","),
          )
      )
        return gui;
    }, "owned Apparent launch and shortcut socket");
    assert.equal(realpathSync(`/proc/${pid}/exe`), executable);
    const editorWindow = await until(() => {
      assert.equal(editor.exitCode, null, "Draft editor exited");
      const clients: Window[] = JSON.parse(
        command("hyprctl", ["-j", "clients"]),
      );
      return clients.find(
        (window) => window.pid === editor.pid && window.title === editorTitle,
      );
    }, "native editor window");
    assert.match(editorWindow.address, /^0x[0-9a-f]+$/i);

    let expectedDraft = "";
    const admitted = () =>
      readFileSync(log, "utf8").match(
        /emit_paste_shortcut -> sending PasteLatestShortcut/g,
      )?.length ?? 0;
    for (const [sample, kind] of [
      "warmup",
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "rapid",
      "clipboard-change",
    ].entries()) {
      await pause(530);
      const text = `Synthetic transcript ${sample} — café. Draft remains unsent.\nSecond line.\n`;
      writeFileSync(
        manifest,
        JSON.stringify({
          version: 1,
          id: "synthetic-paste",
          createdAtMs: 1000,
          durationMs: 1000,
          target: {
            mode: "display",
            displayId: 0,
            frame: { x: 0, y: 0, width: 1280, height: 720, scale: 1 },
          },
          transcript: { source: "test", text, segments: [] },
          strokes: [],
          marks: [],
          events: [],
          keyframes: [],
          contactSheet: "contact-sheet.png",
        }),
      );
      const inventory = () =>
        [manifest, sheet].map((path) => sha(readFileSync(path)));
      const before = inventory();
      const beforeApp = resources(pid);
      const count = draftEvents.length;
      const actions = admitted();
      const replaced = kind === "clipboard-change";
      execFileSync("/usr/bin/wl-copy", ["--type", mime], {
        input: "Prior clipboard",
        timeout: 4000,
        stdio: ["pipe", "ignore", "ignore"],
      });
      assert.deepEqual(readClipboard(), Buffer.from("Prior clipboard"));
      if (replaced) {
        writeFileSync(fault, "");
        symlinkSync("/bench/clipboard-fault.ts", join(overrides, "wl-paste"));
      }
      command("hyprctl", [
        "eval",
        `hl.dispatch(hl.dsp.focus({ window = 'address:${editorWindow.address}' }))`,
      ]);
      await until(
        () => active().address === editorWindow.address,
        "editor focus at action",
      );
      const pressureBefore = guestPressure();
      const start = now();
      await run(executable, ["shortcut", "paste"], { env, timeout: 4000 });
      let rapidGapMs: number | undefined;
      if (kind === "rapid") {
        rapidGapMs = now() - start;
        await run(executable, ["shortcut", "paste"], { env, timeout: 4000 });
        assert.ok(
          now() - start < 400,
          "Both rapid actions must be inside the debounce window",
        );
      }
      let endpointMs: number | undefined;
      const expectedClipboard = Buffer.from(
        replaced ? originalClipboard : text.trim(),
      );
      if (replaced) {
        await until(
          () =>
            !existsSync(fault) &&
            readFileSync(log, "utf8").includes(
              "Clipboard changed before text paste",
            ),
          "product refusal after replacing clipboard",
        );
      } else {
        const event = await until(
          () => draftEvents[count],
          "independent native draft input",
        );
        expectedDraft += text.trim();
        assert.deepEqual(event.bytes, Buffer.from(expectedDraft));
        assert.equal(event.focused, true);
        endpointMs = event.ms - start;
        assert.ok(endpointMs > 0 && endpointMs < 500);
      }
      const pressureAfter = guestPressure();
      if (kind === "rapid" || replaced) await pause(450);
      assert.deepEqual(readClipboard(), expectedClipboard);
      assert.doesNotMatch(
        command("/usr/bin/wl-paste", ["--list-types"]),
        /^image\//m,
      );
      assert.equal(draftEvents.length, count + Number(!replaced));
      assert.equal(admitted(), actions + 1);
      assert.equal(enters, 0);
      assert.equal(active().address, editorWindow.address);
      assert.deepEqual(inventory(), before);
      const post = resources(pid);
      const appCpuMs =
        (1000 * (post.cpuTicks - beforeApp.cpuTicks)) / ticksPerSecond;
      assert.ok(appCpuMs >= 0 && appCpuMs <= 250);
      assert.ok(post.rssKiB <= 384 * 1024);
      report({
        batch,
        index,
        build,
        kind,
        endpointMs,
        rapidGapMs,
        appCpuMs,
        appRssKiB: post.rssKiB,
        guestPressure: { before: pressureBefore, after: pressureAfter },
        clipboardBytes: expectedClipboard.length,
        clipboardSha256: sha(expectedClipboard),
        draftBytes: Buffer.byteLength(expectedDraft),
        draftSha256: sha(Buffer.from(expectedDraft)),
        durableInputs: before,
        admittedActions: 1,
        enters,
        blockedClipboardChange: replaced,
      });
    }
  } finally {
    await Promise.all([stop(editor), stop(app)]);
    lines.close();
    rmSync(work, { recursive: true, force: true });
  }
}

for (let index = 0; index < 4; index++)
  await arm("calibration", index, "control");
if (revisions.candidate !== revisions.control) {
  for (const [index, build] of (
    ["control", "candidate", "candidate", "control"] as const
  ).entries())
    await arm("comparison", index, build);
}
writeFileSync("/out/passed", version + "\n");
