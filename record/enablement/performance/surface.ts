import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { installObservers } from "../../../shared/enablement/performance/electron-observer.ts";
import { measureInteractions } from "./interactions.ts";

export async function surfaceRecipe(options: {
  detail: boolean;
  startupLog?: () => Promise<string>;
  appDir: string;
  out: string;
  scratch: string;
  audio: string;
  sink: string;
  files: (name: string) => string;
  put: (name: string, value: string) => Promise<void>;
  configFor: (speech: boolean, streaming?: boolean) => Promise<void>;
  phase: (name: string) => Promise<void>;
  speaker: (label: string) => { kill(signal?: NodeJS.Signals): boolean };
  background: (
    program: string,
    args: string[],
    log: string,
  ) => { kill(signal?: NodeJS.Signals): boolean };
  pause: (ms: number) => Promise<void>;
  commands: (args: string[], timeout?: number) => Promise<string>;
  exec: (program: string, args: string[]) => Promise<string>;
  active: () => Promise<{ text: string; id: string }>;
  own: (id: string | undefined) => void;
}) {
  const { put, phase, commands, configFor, pause } = options;
  const ink = await stat(options.files("ink")).then(
    () => true,
    () => false,
  );
  await pause(16000);
  for (const label of ["shortcut-first", "shortcut-repeat"]) {
    await configFor(true);
    const logOffset = (await options.startupLog?.())?.length;
    const bootMs = async () =>
      1000 * Number((await readFile("/proc/uptime", "utf8")).split(" ")[0]);
    const started = logOffset === undefined ? undefined : await bootMs();
    await put("shortcut-request", label);
    const active = await options.active();
    options.own(active.id);
    await put(label + "-state.json", active.text);
    const player = options.speaker(label);
    await pause(ink ? 6000 : 3000);
    player.kill("SIGTERM");
    const stopped = await commands(
      ["capture", "stop", active.id, "--wait", "--timeout", "15"],
      20000,
    );
    const saved = JSON.parse(stopped);
    assert(saved.capture_id === active.id && saved.status === "saved");
    await put(label + "-stop.json", stopped);
    if (
      started !== undefined &&
      logOffset !== undefined &&
      options.startupLog
    ) {
      const stoppedAt = await bootMs();
      const log = (await options.startupLog()).slice(logOffset);
      const collected = [
        ...log.matchAll(/recording startup stages: (\[[^\n]*\])/g),
      ].map(([, stages]) => JSON.parse(stages));
      const marks = Object.fromEntries(
        [...log.matchAll(/^START_METRIC (\w+)=([\d.]+)$/gm)].map(
          ([, name, ms]) => [name, Number(ms)],
        ),
      );
      await put(
        label + "-startup.json",
        JSON.stringify({
          captureId: active.id,
          appRelativeSpans: collected.at(-1) ?? [],
          desktopMarksMs: marks,
          resourceWindow: { started, stoppedAt },
        }),
      );
    }
    options.own(undefined);
    await unlink(join(options.out, "shortcut-request"));
    if (options.detail && label === "shortcut-repeat") {
      let expected = "";
      for (let sample = 0; sample < 100; sample++) {
        expected = await options
          .exec("wl-paste", ["--no-newline", "--type", "text"])
          .catch(() => "");
        if (expected.includes(saved.bundle_path)) break;
        await pause(30);
      }
      assert(
        expected.includes(saved.bundle_path),
        "Saved capture did not reach the clipboard",
      );
      await put(label + "-expected.txt", expected);
    }
    await pause(16000);
  }
  if (options.detail) {
    await measureInteractions({
      output: options.out,
      scratch: options.scratch,
      runtime: join(
        options.appDir,
        "usr/share/apparent/settings/runtime/electron",
      ),
      cue: options.audio,
      sink: options.sink,
      commands,
      phase,
      start: options.background,
      config: () => configFor(true, true),
    });
  }
}

export async function enableSurfaceObservers(
  appDir: string,
  out: string,
  models: string,
  preview: string,
) {
  const directory = join(models, "preview");
  await mkdir(directory);
  const name = "nemotron-speech-streaming-en-0.6b-Q8_0.gguf";
  await copyFile(preview, join(directory, name));
  await writeFile(
    join(directory, name + ".verified.json"),
    JSON.stringify({
      filename: name,
      bytes: 729650176,
      sha256:
        "90d8c89714cd31efc88be62a40c6b2bea57e0cc2063af1ffe2c28f1a228ca110",
    }),
    { flag: "wx", mode: 0o600 },
  );
  await installObservers(appDir, out);
}
