import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import * as observer from "../../shared/enablement/performance/electron-observer.ts";
import { measuredWait } from "../../shared/enablement/performance/measurement.ts";

const [appDir, config, captures, output, ...extra] = process.argv.slice(2);
assert(!extra.length && appDir && config && captures && output);
assert.match(
  output,
  /^\/home\/[a-z0-9_-]+\/apparent-gui-out-[0-9a-f]+\/artifacts$/,
);
const root = output.slice(0, -"/artifacts".length);
assert.equal(config, join(root, "config/apparent/config.json"));
assert.equal(captures, join(root, "captures"));
const phase = (name: string) =>
  writeFile(join(output, "current-phase"), name + "\n");
const clipboard = () =>
  promisify(execFile)("wl-paste", ["--no-newline", "--type", "text"], {
    encoding: "utf8",
    timeout: 700,
  }).then(({ stdout }) => stdout);

async function measurePractice() {
  const preferences = JSON.parse(await readFile(config, "utf8"));
  const next = {
    ...preferences,
    experiments: { ...preferences.experiments, onboardingFirstCapture: true },
    onboarding: { tourRevision: 1, seen: false, resume: "try-it" },
  };
  await writeFile(config + ".practice", JSON.stringify(next), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(config + ".practice", config);
  assert.equal((await readdir(captures)).length, 0);
  await observer.installObservers(appDir, output);
  const recorder = spawn(join(appDir, "AppRun"), ["launch", "--background"], {
    stdio: ["ignore", 1, 2],
    env: {
      ...process.env,
      TMPDIR: join(process.env.TMPDIR ?? "", "record-scratch"),
    },
  });
  try {
    const coach = await observer.connectTo(
      output,
      "onboarding",
      /\/(onboarding\.html|index\.html\?nativeOnboarding)$/,
    );
    async function onScreen(selector: string, label: string, surface = coach) {
      await observer.waitFor(
        async () => {
          const shown = await surface.evaluate<boolean>(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        return document.visibilityState === "visible" && !!target?.getBoundingClientRect().height;
      })()`);
          return shown || undefined;
        },
        label,
        20000,
      );
    }
    const stage = (name: string) =>
      onScreen(
        'main.native-coach[data-stage="' + name + '"]',
        "the " + name + " coaching step",
      );
    async function clickCoach(action: "whiteboard" | "finish") {
      const selector = `main.native-coach button[data-action="${action}"]:enabled:not([inert] *)`;
      await onScreen(selector, "the active " + action + " coach button");
      await coach.click(selector);
    }
    try {
      await onScreen(
        "h1.native-shortcut-prompt",
        "the resumed practice instruction",
      );
      assert.equal(
        await coach.evaluate('document.querySelector("h1").textContent'),
        "One more time.",
      );
      await phase("practice record");
      await stage("whiteboard");
      await clickCoach("whiteboard");
      const board = await observer.connectTo(
        output,
        "whiteboard",
        /\/whiteboard\/index\.html$/,
      );
      try {
        await onScreen(
          '.native-board-lesson[data-ready="true"]',
          "the practice whiteboard ready for a stroke",
          board,
        );
        const box = await board.evaluate<{
          x: number;
          y: number;
          width: number;
          height: number;
        }>(`(() => {
      const {x, y, width, height} = document.querySelector('[aria-label="Whiteboard drawing canvas"]').getBoundingClientRect();
      return {x, y, width, height};
    })()`);
        const at = (x: number, y: number) => ({
          x: box.x + x * box.width,
          y: box.y + y * box.height,
        });
        await board.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...at(0.25, 0.35),
          button: "left",
          clickCount: 1,
          buttons: 1,
        });
        for (const [x, y] of [
          [0.32, 0.36],
          [0.39, 0.39],
          [0.45, 0.43],
          [0.48, 0.4],
        ]) {
          await board.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            ...at(x, y),
            button: "left",
            buttons: 1,
          });
        }
        await board.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...at(0.48, 0.4),
          button: "left",
          clickCount: 1,
        });
        await onScreen(
          '.native-board-lesson[data-has-ink="true"]',
          "the accepted whiteboard stroke",
          board,
        );
        await board.click('button[aria-label="Close whiteboard"]');
      } finally {
        board.close();
      }
      await stage("screen-ink");
      await phase("practice screen-ink");
      await stage("stop");
      await phase("finishing from the practice coach");
      await clickCoach("finish");
      await stage("copied");
      const capture = await observer.waitFor(async () => {
        const name = (await readdir(captures)).find((name) =>
          /^apparent-[a-z0-9-]+\.apparent$/.test(name),
        );
        if (!name) return;
        const directory = join(captures, name);
        const text = await clipboard().catch(() => "");
        if (!text.includes(directory) || !text.includes("apparent inspect "))
          return;
        const manifest = JSON.parse(
          await readFile(join(directory, "apparent.json"), "utf8"),
        );
        assert(manifest.strokes?.length > 0 && manifest.keyframes?.length > 0);
        assert.equal(manifest.video, "recording.mp4");
        assert((await stat(join(directory, manifest.video))).size > 0);
        return name;
      }, "owned saved recording and verified clipboard");
      await coach.click(
        "main.native-coach[data-stage=copied] button:not([aria-label])",
      );
      await stage("complete");
      const started = await coach.click('button[aria-label="Finish setup"]');
      await observer.waitFor(async () => {
        const cfg = JSON.parse(await readFile(config, "utf8"));
        const closed =
          coach.closed() ||
          (await coach
            .evaluate(
              'document.visibilityState !== "visible" || !document.querySelector(".native-coach")',
            )
            .catch(() => false));
        return cfg.onboarding?.firstCaptureCompleted === true &&
          cfg.onboarding.seen === true &&
          closed
          ? true
          : undefined;
      }, "durable success and closed coach");
      const success = measuredWait(started, performance.now());
      const version = (
        await readFile(join(output, "version.txt"), "utf8")
      ).trim();
      await writeFile(
        join(output, "onboarding-waits.json"),
        JSON.stringify({
          version,
          capture,
          waits: { "first-success": success },
        }) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    } finally {
      coach.close();
    }
  } finally {
    recorder.kill("SIGTERM");
  }
}
await measurePractice();
