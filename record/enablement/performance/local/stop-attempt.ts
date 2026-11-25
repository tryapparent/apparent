import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  schedulerPressureUs,
  waitForQuietStart,
} from "../fixtures/host-pressure.ts";
import { shutDown } from "./attempt.ts";
import { stopTimeline } from "./stop-timeline.ts";
import {
  json,
  type StopReference,
  sha256,
  verifyStopBundle,
} from "./stop-fixture.ts";

const clipboardPath = (app: string, name: "wl-copy" | "wl-paste") =>
  join(app, "usr/bin", name);

export async function locateStopBuild(
  directory: string,
  env: NodeJS.ProcessEnv,
) {
  const app = join(directory, "AppRun");
  const result = spawnSync(app, ["--version"], {
    encoding: "utf8",
    env,
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? "");
  const version = result.stdout.trim();
  assert.match(version, /^apparent\s+\S+\s+·\s+[a-f0-9]{7,40}$/);
  const files = [
    "AppRun",
    "usr/bin/apparent",
    "usr/bin/wl-copy",
    "usr/bin/wl-paste",
  ];
  const sha256s = await Promise.all(
    files.map((file) => sha256(join(directory, file))),
  );
  return {
    directory,
    app,
    version,
    inputs: Object.fromEntries(files.map((file, i) => [file, sha256s[i]])),
  };
}

export async function stopAttempt(
  build: Awaited<ReturnType<typeof locateStopBuild>>,
  source: { directory: string; manifest: StopReference },
  model: string,
  output: string,
  probe: boolean,
  traceSpans: boolean,
  replayCpus?: string,
) {
  mkdirSync(output, { mode: 0o700 });
  const home = join(output, "home");
  const config = join(output, "config.json");
  const account = join(output, "replayed.apparent");
  const id = randomUUID();
  mkdirSync(home, { mode: 0o700 });
  writeFileSync(
    config,
    JSON.stringify({ errorReporting: false, experiments: {} }),
    { mode: 0o600 },
  );
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_CURRENT_DESKTOP: "Hyprland",
    XDG_SESSION_TYPE: "wayland",
    LC_ALL: "C",
    APPDIR: build.directory,
    LD_LIBRARY_PATH: join(build.directory, "usr/lib"),
    APPARENT_CONFIG: config,
    APPARENT_MODELS_DIR: dirname(model),
    ...(probe ? { APPARENT_START_TIMINGS: "1" } : {}),
    ...(probe && traceSpans ? { APPARENT_FINISH_BENCH_SPANS: id } : {}),
  };
  const readClipboard = (timeout: number) =>
    spawnSync(
      clipboardPath(build.directory, "wl-paste"),
      ["--no-newline", "--type", "text"],
      {
        encoding: "utf8",
        env,
        timeout,
        maxBuffer: 1024 * 1024,
      },
    );
  const sentinel = "Record stop benchmark " + id;
  const owner = spawn(
    clipboardPath(build.directory, "wl-copy"),
    ["--foreground", "--type", "text/plain;charset=utf-8"],
    { env, stdio: ["pipe", "ignore", "inherit"] },
  );
  const ownerFailed = new Promise<never>((_, reject) =>
    owner.once("error", reject),
  );
  owner.stdin?.on("error", () => {});
  owner.stdin?.end(sentinel);
  try {
    await Promise.race([
      ownerFailed,
      (async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const read = readClipboard(1000);
          if (read.status === 0 && read.stdout === sentinel) return;
          await delay(100);
        }
        throw Error("Failed to seed the isolated Wayland clipboard");
      })(),
    ]);
    await waitForQuietStart(AbortSignal.timeout(46_000));
    const pressure = schedulerPressureUs();
    const start = performance.now();
    const usage = join(output, "resources.tsv");
    const run = spawnSync(
      "/usr/bin/time",
      [
        "-f",
        "%U\t%S\t%M\t%O",
        "-o",
        usage,
        "--",
        ...(replayCpus ? ["taskset", "--cpu-list", replayCpus] : []),
        build.app,
        "reprocess",
        source.directory,
        "--out",
        account,
        "--bench",
        "1",
      ],
      { encoding: "utf8", env, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const replayEnd = performance.now();
    writeFileSync(
      join(output, "reprocess.log"),
      (run.stdout ?? "") + (run.stderr ?? ""),
      { mode: 0o600 },
    );
    assert.equal(run.status, 0, run.error?.message ?? run.stderr ?? "");
    assert.ok(
      !/Warm recognizer:|local_cache_aware_finish_ms|Pause transcription/.test(
        run.stderr,
      ),
      "Expected the default capture transcription route",
    );
    const clipboard = readClipboard(8000);
    const verified = performance.now();
    const cpuPressurePercent =
      (schedulerPressureUs() - pressure) / ((verified - start) * 10);
    assert.equal(
      clipboard.status,
      0,
      clipboard.error?.message ?? clipboard.stderr ?? "",
    );
    assert.deepEqual(
      clipboard.stdout
        .split("\n")
        .filter((line) => line.startsWith("apparent inspect ")),
      ["apparent inspect '" + account + "'"],
    );
    writeFileSync(join(output, "clipboard.txt"), clipboard.stdout, {
      mode: 0o600,
    });
    const match =
      /^BENCH_FINISH runs_ms=\[([\d.]+)\] median_ms=([\d.]+)$/m.exec(
        run.stderr,
      );
    assert.ok(
      match && Number(match[1]) > 0 && Number(match[1]) === Number(match[2]),
    );
    const finishMs = Number(match[1]);
    const timeline =
      probe && traceSpans ? stopTimeline(run.stderr, id) : undefined;
    if (!probe) assert.ok(!run.stderr.includes("BENCH_FINISH_SPANS "));
    assert.ok(finishMs < replayEnd - start);
    const stages = json(join(account, "finish-trace.json"));
    assert.ok(Number.isFinite(stages.totalMs) && stages.totalMs > 0);
    assert.ok(Number.isFinite(stages.transcribeMs) && stages.transcribeMs >= 0);
    const counters = readFileSync(usage, "utf8").trim().split("\t").map(Number);
    assert.equal(counters.length, 4);
    assert.ok(counters.every((value) => Number.isFinite(value) && value >= 0));
    const [user, system, peakRssKiB, fileOutputs] = counters;
    const quality = verifyStopBundle(account, source.manifest);
    return {
      id,
      probe,
      verified: true,
      trace: {
        host: [
          { name: "replay-process", fromMs: 0, toMs: replayEnd - start },
          {
            name: "clipboard-readback",
            fromMs: replayEnd - start,
            toMs: verified - start,
          },
        ],
        finishMs,
        stages,
        timeline,
      },
      clipboardSha256: createHash("sha256")
        .update(clipboard.stdout)
        .digest("hex"),
      totalMs: verified - start,
      cpuPressurePercent,
      resources: {
        cpuSeconds: user + system,
        peakRssKiB,
        fileOutputs,
        ...quality,
      },
    };
  } finally {
    await shutDown(owner);
  }
}
