import assert from "node:assert/strict";
import {
  execFile,
  execFileSync,
  spawn,
  type ChildProcess,
} from "node:child_process";
import { closeSync, openSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
  appendFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const {
  SCRAWL_GUI_OUTPUT: root,
  SCRAWL_GUI_BINARY: image,
  SCRAWL_GUI_LIBRARY_PATH: libs,
  SCRAWL_GUI_AUDIO_FILE: audio,
  TMPDIR: scratch,
} = process.env;
assert(root && /^\/home\/[a-z0-9_-]+\/scrawl-gui-output-[a-f0-9]+$/.test(root));
assert(
  scratch && /^\/tmp\/ag-[a-z0-9]+$/.test(scratch) && image && libs && audio,
);
process.umask(0o077);
const out = join(root, "artifacts");
const appRoot = join(scratch, "app");
const models = join(scratch, "models");
const captures = join(root, "captures");
const configHome = join(root, "config");
const dataHome = join(root, "data");
const cacheHome = join(root, "cache");
const config = join(configHome, "apparent/config.json");
const runScratch = join(scratch, "record-scratch");
const files = (name: string) => join(libs, "libbench.so." + name);
const artifact = (name: string) => join(out, name);
const put = (name: string, value: string) =>
  writeFile(artifact(name), value + "\n");
const append = (name: string, values: (number | string)[]) =>
  appendFile(artifact(name), values.join("\t") + "\n");
const asJson = (value: unknown) => JSON.stringify(value);
const metric = (name: string, id: string, ms: number) =>
  append("spans.tsv", [name, id, "measured", ms]);
const phase = (name: string) => put("current-phase", name);
const now = async () =>
  Math.round(
    Number((await readFile("/proc/uptime", "utf8")).split(" ")[0]) * 1000,
  );
const asyncExec = promisify(execFile);
const exec = (command: string, args: string[], timeout = 10_000) =>
  asyncExec(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  }).then((result) => result.stdout.trimEnd());
await Promise.all(
  [
    out,
    appRoot,
    models,
    captures,
    join(configHome, "apparent"),
    dataHome,
    cacheHome,
    runScratch,
  ].map((directory) => mkdir(directory, { recursive: true })),
);
await put(
  "extract.log",
  await asyncExec(image, ["--appimage-extract"], {
    cwd: appRoot,
    maxBuffer: 8 * 1024 * 1024,
  }).then((result) => result.stdout),
);
const appDir = join(appRoot, "squashfs-root");
const app = join(appDir, "AppRun");
const sysApp = join(appDir, "usr/bin/apparent");
const model = join(models, "parakeet-unified-en-0.6b-Q4_K_M.gguf");
await copyFile(files("model"), model);
await copyFile(files("receipt"), model + ".verified.json");
Object.assign(process.env, {
  APPDIR: appDir,
  APPARENT_MODELS_DIR: models,
  APPARENT_CAPTURES_DIR: captures,
  XDG_CONFIG_HOME: configHome,
  XDG_DATA_HOME: dataHome,
  XDG_CACHE_HOME: cacheHome,
  APPARENT_CONFIG: config,
  APPARENT_START_TIMINGS: "1",
  LP_NUM_THREADS: "1",
});
await put("version.txt", await exec(app, ["--version"]));
await put("inputs.sha256", await exec("sha256sum", [sysApp, model, audio]));
await put("vcpu.txt", await exec("nproc", []));
await put("clock-ticks.txt", await exec("getconf", ["CLK_TCK"]));
const pageSize = await exec("getconf", ["PAGESIZE"]);
await put("monitors.json", await exec("hyprctl", ["-j", "monitors"]));
await put(
  "memory.txt",
  (await readFile("/proc/meminfo", "utf8")).split("\n")[0],
);

type Status = {
  capture_id?: string;
  status?: string;
  bundle_path?: string;
  state?: { phase?: string; capture_id?: string };
};
const commands = (args: string[], timeout?: number) => exec(app, args, timeout);
const mode = (await readFile(files("mode"), "utf8")).trim();
const sink = "journey_" + process.pid;
const source = sink + ".monitor";
const dedicated: ChildProcess[] = [];
const abort = new AbortController();
let owned: string | undefined;
let module: string | undefined;

function background(
  program: string,
  args: string[],
  file: string,
  env = process.env,
) {
  const fd = openSync(artifact(file), "w", 0o600);
  try {
    const child = spawn(program, args, { env, stdio: ["ignore", fd, fd] });
    dedicated.push(child);
    return child;
  } finally {
    closeSync(fd);
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => abort.abort());
const pause = (ms: number) => delay(ms, undefined, { signal: abort.signal });
async function until<T>(ms: number, probe: () => Promise<T | undefined>) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    abort.signal.throwIfAborted();
    const result = await probe();
    if (result !== undefined) return result;
    await pause(50);
  }
  throw Error("Guest checkpoint timed out");
}
async function configFor(speech: boolean) {
  const pending = config + ".benchmark";
  await writeFile(
    pending,
    asJson({
      onboarding: { seen: true },
      launchAtLogin: false,
      autoPasteDraft: false,
      errorReporting: false,
      microphoneEnabled: speech,
      microphone: { id: "pulse:" + source, name: "Synthetic English fixture" },
    }),
  );
  await rename(pending, config);
}
async function captureState() {
  const text = await commands(["capture", "state"]);
  return { text, value: JSON.parse(text) as Status };
}

async function captureStatus(id: string) {
  const text = await commands(["capture", "inspect", id]);
  return { text, value: JSON.parse(text) as Status };
}

async function seedClipboard(value: string) {
  execFileSync("wl-copy", ["--type", "text/plain"], {
    input: value,
    timeout: 5000,
    stdio: ["pipe", "ignore", "ignore"],
  });
}

async function watchClipboard(name: string, sentinel: string, stop: number) {
  for (const end = stop + 120000; (await now()) < end; ) {
    abort.signal.throwIfAborted();
    const text = await exec(
      "wl-paste",
      ["--no-newline", "--type", "text"],
      700,
    ).catch(() => "");
    if (
      text !== sentinel &&
      text.includes("apparent inspect ") &&
      text.includes(captures + "/")
    ) {
      await put(name + "-clipboard.txt", text);
      const at = await now();
      await put(name + "-clipboard-at.txt", String(at));
      return { at, text };
    }
    await pause(40);
  }
  throw Error("Verified clipboard did not arrive");
}
const speak = (name: string) =>
  background(
    "pw-play",
    [
      "--target=" + sink,
      "--properties={node.dont-fallback=true node.dont-reconnect=true}",
      audio,
    ],
    name + "-player.log",
  );
const log = () => readFile(artifact("application.log"), "utf8");

try {
  await configFor(false);
  if (mode === "local-cli") {
    const bundleRoot = join(scratch, "cli-fixtures");
    await mkdir(bundleRoot);
    await exec("tar", ["-C", bundleRoot, "-xf", files("cli-fixtures")], 120000);
    const f = Object.fromEntries(
      ["short", "ink", "long"].map((key) => [
        key,
        join(bundleRoot, key + ".apparent"),
      ]),
    );
    const manifest = join(scratch, "cli-fixtures.json");
    await writeFile(manifest, asJson(f));
    const path = await exec(
      process.execPath,
      [files("local-cli.ts"), app, scratch, manifest],
      300000,
    );
    assert(path.startsWith(scratch + "/"));
    await copyFile(path, artifact("cli-waits.json"));
  } else if (mode === "settings") {
    await exec(process.execPath, [files("settings.ts"), appDir, out], 80000);
  } else {
    assert(mode === "draw" || mode === "surface");
    module = await exec("pactl", [
      "load-module",
      "module-null-sink",
      "sink_name=" + sink,
      "rate=16000",
      "channels=1",
    ]);
    assert.match(module, /^\d+$/);
    const scene = background(
      "python3",
      [files("scene"), "--scene", artifact("scene.json")],
      "scene.log",
    );
    await until(6000, () =>
      stat(artifact("scene.json"))
        .then((entry) => (entry.size ? true : undefined))
        .catch(() => undefined),
    );
    await writeFile(join(scratch, "output-path"), root + "\n");
    const recorder = background(app, ["app"], "application.log", {
      ...process.env,
      TMPDIR: runScratch,
    });
    await until(24000, async () =>
      (await captureState().catch(() => undefined))?.value.state?.phase ===
      "idle"
        ? true
        : undefined,
    );
    const sampler = background(
      process.execPath,
      [files("sample.ts"), String(recorder.pid), sysApp, pageSize],
      "resources.tsv",
    );
    await until(8000, async () => {
      const rows = (await readFile(artifact("resources.tsv"), "utf8"))
        .trimEnd()
        .split("\n");
      return Number(rows.at(-1)?.split("\t")[11]) > 0 ? true : undefined;
    });
    await pause(3000);
    type Fixture = {
      seconds: number;
      audio: string;
      scene: string;
      strokes: number;
    };
    const cases = JSON.parse(await readFile(files("cases"), "utf8")) as [
      string,
      Fixture,
    ][];
    for (const [name, fixture] of cases) {
      assert.match(name, /^[a-z0-9-]+$/);
      const id = randomUUID().replaceAll("-", "");
      owned = id;
      await configFor(fixture.audio === "spoken");
      scene.kill(fixture.scene === "static" ? "SIGSTOP" : "SIGCONT");
      console.log(
        "CASE",
        name,
        fixture.seconds,
        fixture.audio,
        fixture.strokes,
      );
      await phase("start " + name);
      await pause(2000);
      let disk = true;
      const recordDisk = async () => {
        while (disk) {
          await append(name + "-scratch.tsv", [
            (await exec("du", ["-s", "-B1", runScratch])).split("\t")[0],
          ]);
          await pause(100);
        }
      };
      const diskObserver = recordDisk();
      diskObserver.catch(() => {});
      const start = await now();
      const entered = JSON.parse(
        await commands(
          ["capture", "start", "--request-id", id, "--wait", "--timeout", "78"],
          85000,
        ),
      ) as Status;
      assert(entered.capture_id === id && entered.status === "recording");
      const live = await now();
      const player = fixture.audio === "spoken" ? speak(name) : undefined;
      await put(name + "-draw-request", String(fixture.strokes));
      await phase("recording " + name);
      await pause(fixture.seconds * 1000);
      player?.kill("SIGTERM");

      const sentinel = "apparent-journey-sentinel-" + id;
      await seedClipboard(sentinel);
      let stop = await now();
      const epochOffset = Date.now() - stop;
      const beforeFinish = (await log()).length;
      const clip = watchClipboard(name, sentinel, stop);
      clip.catch(() => {});
      let saveText: string;
      if (name === "portal-warmup") {
        saveText = await commands(
          ["capture", "stop", id, "--wait", "--timeout", "120"],
          127000,
        );
      } else {
        const active = await captureState();
        assert(
          active.value.state?.capture_id === id &&
            active.value.state.phase === "recording",
        );
        await put(name + "-owned-active.json", active.text);
        await phase("finish " + name + " " + id);
        saveText = await until(120000, async () => {
          const receipt = await captureStatus(id).catch(() => undefined);
          return receipt?.value.status === "saved" &&
            receipt.value.capture_id === id
            ? receipt.text
            : undefined;
        });
        const found = [
          ...(await log())
            .slice(beforeFinish)
            .matchAll(/^\[(\d{13})\] finish_recording invoked$/gm),
        ];
        assert.equal(found.length, 1);
        stop = Number(found[0][1]) - epochOffset;
      }
      const saved = await now();
      await put(name + "-stop.json", saveText);
      await append("phase-start.tsv", [name, start, live, stop]);
      const receipt = JSON.parse(saveText) as Status;
      const bundle = receipt.bundle_path;
      assert(
        receipt.capture_id === id &&
          receipt.status === "saved" &&
          typeof bundle === "string" &&
          bundle.startsWith(captures + "/") &&
          bundle.endsWith(".apparent"),
      );
      disk = false;
      await diskObserver;
      await append(name + "-scratch.tsv", [
        (await exec("du", ["-s", "-B1", runScratch])).split("\t")[0],
      ]);
      owned = undefined;
      const clipboard = await clip;
      assert(clipboard.text.includes(bundle));
      await metric(name, "paste", clipboard.at - stop);
      await append("phase-finish.tsv", [name, saved, clipboard.at]);
      const evidence = JSON.parse(
        await readFile(join(bundle, "apparent.json"), "utf8"),
      );
      await put(
        name + "-proof.json",
        asJson({
          actualInk: evidence.strokes?.length ?? 0,
          durationMs: evidence.durationMs,
          keyframes: evidence.keyframes?.length ?? 0,
        }),
      );
      const trace = await readFile(
        join(bundle, "finish-trace.json"),
        "utf8",
      ).catch(() => undefined);
      if (trace) await put(name + "-finish.json", trace);
      await exec("ffmpeg", [
        "-v",
        "error",
        "-nostdin",
        "-ss",
        "1",
        "-i",
        join(bundle, "recording.mp4"),
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
      ]);
      if (name === "quick-silent") {
        const copySentinel = "copy-sentinel-" + id;
        await seedClipboard(copySentinel);
        const started = await now();
        const observation = watchClipboard(
          name + "-copy",
          copySentinel,
          started,
        );
        observation.catch(() => {});
        await commands(["copy", bundle]);
        const copied = await observation;
        assert.equal(copied.text, clipboard.text);
        await metric(name, "cli-copy", copied.at - started);
      }
    }
    if (mode === "surface") {
      await pause(16000);
      for (const label of ["shortcut-first", "shortcut-repeat"]) {
        await configFor(true);
        await put("shortcut-request", label);
        const active = await until(72000, async () => {
          const state = await captureState().catch(() => undefined);
          return state?.value.state?.phase === "recording" ? state : undefined;
        });
        const id = active.value.state?.capture_id;
        assert(typeof id === "string" && /^[a-f0-9]{32}$/.test(id));
        owned = id;
        await put(label + "-state.json", active.text);
        const player = speak(label);
        await pause(3000);
        player.kill("SIGTERM");
        const stopped = await commands(
          ["capture", "stop", id, "--wait", "--timeout", "15"],
          20000,
        );
        const saved = JSON.parse(stopped) as Status;
        assert(saved.capture_id === id && saved.status === "saved");
        await put(label + "-stop.json", stopped);
        owned = undefined;
        await unlink(artifact("shortcut-request"));
        await pause(16000);
      }
    }
    await pause(8000);
    assert(sampler.exitCode === null, "Resource sampler exited early");
    await phase("done");
  }
} finally {
  abort.abort();
  if (owned) await commands(["capture", "cancel", owned], 5000).catch(() => {});
  for (const child of dedicated) {
    child.kill("SIGCONT");
    child.kill("SIGTERM");
  }
  if (module)
    await exec("pactl", ["unload-module", module], 5000).catch(() => {});
}
