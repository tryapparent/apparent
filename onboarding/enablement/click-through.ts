import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import * as observer from "../../shared/enablement/performance/electron-observer.ts";
import { clickTrace, endpointVersion } from "./performance/click-trace.ts";
import {
  launchElectron,
  buildIdentity,
  whiteboardEntry,
  visible,
  type Surface,
} from "./performance/electron-fixture.ts";
import { exerciseWhiteboard } from "./performance/whiteboard.ts";
import { practiceChannel, practiceFixture } from "./performance/fixtures.ts";

const [
  runtimeArg,
  rootArg,
  jobArg,
  repeatsArg = "1",
  variant = "cold",
  ...extra
] = process.argv.slice(2);
assert(
  runtimeArg && rootArg && jobArg && !extra.length,
  "Usage: click-through.ts ELECTRON ASSETS_ROOT PRIVATE_JOB [REPEATS] [cold|resumed]",
);
assert.match(repeatsArg, /^(?:[1-9]|1\d|20)$/);
assert.match(variant, /^(?:cold|resumed)$/);
assert.equal(process.platform, "linux");
const detailed = process.env.APPARENT_ONBOARDING_OBSERVATION !== "minimal";
const [runtime, assets, job] = await Promise.all(
  [runtimeArg, rootArg, jobArg].map((file) => realpath(file)),
);
const jobInfo = await stat(job);
assert(
  jobInfo.isDirectory() &&
    jobInfo.uid === process.getuid?.() &&
    (jobInfo.mode & 0o077) === 0,
);
process.umask(0o077);
const entry = join(assets, "dist/composition/onboarding/entry.cjs");
const identity = await buildIdentity(runtime, assets, entry);
const sandbox = async () => {
  if (process.env.APPARENT_ONBOARDING_FIXTURE_NO_SANDBOX === "1")
    return ["--no-sandbox"];
  const helper = await stat(join(dirname(runtime), "chrome-sandbox"));
  return helper.uid === 0 && helper.mode & 0o4000
    ? []
    : ["--disable-setuid-sandbox"];
};
const sandboxArgs = await sandbox();
const fixtureVariables = [
  "PATH",
  "DISPLAY",
  "XAUTHORITY",
  "LANG",
  "LC_ALL",
  "TZ",
];
const fixtureEnv = Object.fromEntries(
  fixtureVariables.map((name) => [name, process.env[name]]),
);
const welcome = ".native-agent-choices button:first-child";
const pen = ".native-pen-picker";
const permission = ".native-permissions";
const footer = ".native-setup footer button:last-child";
const practice = ".native-shortcut-prompt";

async function clickThrough(run: number) {
  const profile = await mkdtemp(
    join(process.env.APPARENT_ONBOARDING_PROFILE_ROOT ?? job, "profile-"),
  );
  const log: string[] = [];
  const attempt = randomBytes(16).toString("hex");
  await mkdir(join(profile, "home"));
  const env = {
    ...fixtureEnv,
    HOME: join(profile, "home"),
    XDG_CONFIG_HOME: join(profile, "config"),
    XDG_CACHE_HOME: join(profile, "cache"),
    XDG_DATA_HOME: join(profile, "data"),
    APPARENT_UI_PROFILE: join(profile, "electron"),
    ...(detailed ? { APPARENT_LOCAL_ONBOARDING_TRACE: attempt } : {}),
  };
  const args = [...sandboxArgs, "--ozone-platform=x11"];
  const fixture = practiceFixture(profile);
  const cpuPressureBefore = await readFile("/proc/pressure/cpu", "utf8");
  const ioPressureBefore = await readFile("/proc/pressure/io", "utf8");
  const memAvailableKiB = Number(
    /^MemAvailable:\s+(\d+)/m.exec(
      await readFile("/proc/meminfo", "utf8"),
    )?.[1],
  );
  const hostCpuBefore = (await readFile("/proc/stat", "utf8")).split(
    "\n",
    1,
  )[0];
  const trace = clickTrace(attempt, detailed);
  const startup = "coach-open-to-interactive";
  const child = launchElectron({
    runtime,
    args: [...args, entry, "--assets-root", assets],
    env,
    profile,
    surface: "onboarding",
    log,
  });
  const { send, reply } = child;
  let surface: Surface | undefined;
  let boardChild: ReturnType<typeof launchElectron> | undefined;
  try {
    const project = (step: string, extra: object = {}) =>
      send({
        type: "state",
        step,
        index: 1,
        count: 5,
        rows: [],
        ready: true,
        platform: "linux",
        shortcut: "Ctrl+R",
        ...extra,
      });
    const initial = variant === "cold" ? welcome : practice;
    if (variant === "cold") project("welcome");
    else project("try-it", { practice: "start" });
    let discovered = 0;
    const page = (surface = await child.connect("/dist/onboarding.html", () => {
      discovered = performance.now();
    }));
    trace.span(startup, "launch-to-debug-target", trace.launched, discovered);
    const attached = performance.now();
    trace.span(startup, "attach-renderer-observer", discovered, attached);
    const layout = await visible(page, initial);
    trace.span(startup, "wait-for-actionable-layout", attached, layout);
    trace.span(startup, "wait-for-renderer-paint", layout);
    trace.checkpoint(startup, trace.launched);
    const click = async (
      selector: string,
      label: string,
      action: string,
      response: () => unknown,
    ) => {
      assert.equal(
        await page.evaluate(
          `document.querySelector(${JSON.stringify(selector)})?.textContent?.trim()`,
        ),
        label,
      );
      const started = await page.click(selector);
      trace.input(action, started);
      await reply((row) => row.action === action);
      await response();
      return started;
    };
    const checkpoint = async (
      name: string,
      started: number,
      selector: string,
    ) => {
      await visible(page, selector);
      trace.checkpoint(name, started);
    };
    if (variant === "cold") {
      const penOpened = await click(welcome, "Right here", "continue", () =>
        project("welcome", { penPicker: true }),
      );
      await checkpoint("welcome-to-pen", penOpened, pen);
      const permissions = (ready: boolean) =>
        project("permissions", {
          ready,
          rows: [
            {
              permission: "accessibility",
              required: true,
              status: ready ? "granted" : "denied",
            },
          ],
        });
      const permissionOpened = await click(
        footer,
        "Keep current pen",
        "skip-pen",
        () => permissions(false),
      );
      await checkpoint(
        "pen-to-permissions",
        permissionOpened,
        permission + " button",
      );
      assert.equal(
        await page.evaluate(
          `document.querySelector(${JSON.stringify(footer)})?.disabled`,
        ),
        true,
      );
      const granted = await click(
        permission + " button",
        "Copy command",
        "grant",
        () => permissions(true),
      );
      await checkpoint(
        "permission-action-to-ready",
        granted,
        footer + ":enabled",
      );
      const shortcut = await click(
        footer,
        "Choose recording shortcut",
        "continue",
        () => project("shortcut", { shortcutChosen: true }),
      );
      const skip = ".native-shortcut > button:last-child";
      await checkpoint("permissions-to-shortcut", shortcut, skip);
      const tryIt = await click(
        skip,
        "Skip shortcut practice",
        "skip-shortcut-trial",
        () => project("try-it", { practice: "start" }),
      );
      await checkpoint("shortcut-to-practice", tryIt, practice);
    }

    const { batch, scope } = practiceChannel(child, attempt);
    const stage = (name: string) => `main.native-coach[data-stage="${name}"]`;
    const record = performance.now();
    trace.input("record-shortcut-fixture", record);
    await fixture.publishFirstMedia();
    await fixture.verifyFirstMedia();
    trace.span(
      "practice-record-to-first-media",
      "synthetic-record-first-frame",
      record,
    );
    trace.checkpoint("practice-record-to-first-media", record);
    const prewarm = performance.now();
    boardChild = launchElectron({
      runtime,
      args: [
        ...args,
        `--user-data-dir=${join(profile, "board")}`,
        join(assets, whiteboardEntry),
      ],
      env,
      profile,
      surface: "whiteboard",
      log,
    });
    const started = await batch([{ type: "reset" }, { type: "started" }]);
    assert.equal(started.stage, "whiteboard");
    project("try-it", { practice: "whiteboard", practiceAttempt: "1" });
    const whiteboard =
      stage("whiteboard") +
      ' button[data-action="whiteboard"]:enabled:not([inert] *)';
    await visible(page, whiteboard);
    const opened = await page.click(whiteboard);
    trace.input("open-whiteboard", opened);
    const openAction = await reply(
      (row) => row.action === "practice-open-board:1",
    );
    trace.checkpoint(
      "practice-start-to-effective-whiteboard-control",
      record,
      opened,
    );
    const board = await exerciseWhiteboard(
      boardChild,
      trace,
      record,
      opened,
      prewarm,
      async (frame) => {
        const disposition = await batch([
          { type: "whiteboard-visible", visible: true },
        ]);
        assert.equal(disposition.stage, "board-ink");
        project("try-it", { practice: "board-ink", practiceBoard: frame });
        await observer.waitFor(async () => {
          const hidden = await page.evaluate<boolean>(
            'document.visibilityState === "hidden"',
          );
          return hidden || undefined;
        }, "the coach to hide while the Whiteboard is open");
        trace.checkpoint("whiteboard-open-to-coach-hidden", opened);
      },
    );
    boardChild = undefined;
    const advanced = await batch([
      { type: "ink", board: true, screen: 1 },
      { type: "whiteboard-visible", visible: false },
    ]);
    assert.equal(advanced.stage, "screen-ink");
    await visible(page, stage("screen-ink"));
    await batch([{ type: "ink", board: false, screen: 2 }]);
    project("try-it", { practice: "stop", practiceAttempt: "1" });
    const finish =
      stage("stop") + ' button[data-action="finish"]:enabled:not([inert] *)';
    await visible(page, finish);
    const saved = await page.click(finish);
    trace.input("finish-practice", saved);
    const finishWait = "practice-finish-to-verified-clipboard";
    await reply((row) => row.action === "practice-save-capture:1");
    const processing = performance.now();
    trace.span(finishWait, "dispatch-practice-finish", saved, processing);
    await batch([{ type: "processing" }]);
    await fixture.stopAndOfferClipboard();
    await fixture.verifyHandoff();
    trace.span(
      finishWait,
      "synthetic-record-stop-and-handoff-readback",
      processing,
    );
    const acknowledged = performance.now();
    await batch([{ type: "saved", copied: true }]);
    await checkpoint(finishWait, saved, stage("copied"));
    trace.span(finishWait, "show-copied-coach", acknowledged);
    const reviewed = await click(
      stage("copied") + " button:not([aria-label])",
      "Done",
      "practice-review",
      () => batch([{ type: "action", action: "practice-review" }]),
    );
    await checkpoint("copied-to-completion-coach", reviewed, stage("complete"));
    const finished = await page.click('button[aria-label="Finish setup"]');
    trace.input("finish-setup", finished);
    const setupWait = "finish-setup-to-persisted-close";
    await reply((row) => row.action === "practice-finish");
    const disposition = await batch([
      { type: "action", action: "practice-finish" },
    ]);
    assert.equal(disposition.stage, "complete");
    assert.equal(disposition.accepted, true);
    const admitted = performance.now();
    trace.span(
      setupWait,
      "admit-completion-through-production-practice-host",
      finished,
      admitted,
    );
    await fixture.persistCompletion();
    await fixture.verifyCompletion();
    const persisted = performance.now();
    trace.span(
      setupWait,
      "synthetic-progress-commit-and-readback",
      admitted,
      persisted,
    );
    send({ type: "close" });
    await observer.waitFor(
      async () => page.closed() || undefined,
      "the coach to close",
    );
    trace.checkpoint(setupWait, finished);
    trace.span(setupWait, "observe-coach-close", persisted);
    const cpuPressureAfter = await readFile("/proc/pressure/cpu", "utf8");
    const ioPressureAfter = await readFile("/proc/pressure/io", "utf8");
    const hostCpuAfter = (await readFile("/proc/stat", "utf8")).split(
      "\n",
      1,
    )[0];
    const { perfetto, ...attribution } = trace.report();
    const resources = {
      coach: await child.finish(),
      whiteboard: board.resources,
      outputBytes: await fixture.outputBytes(),
    };
    const name = "click-through-" + run;
    const composition = log.filter((line) =>
      line.startsWith("LOCAL_ONBOARDING_POINT "),
    );
    const receipt = {
      schema: 3,
      endpointVersion,
      mode: "synthetic-electron-click-through",
      variant,
      detailed,
      identity,
      attempt,
      waits: trace.waits,
      whiteboard: {
        ...board.proof,
        scope,
        openAction: openAction.action,
        dispositionSequence: advanced.sequence,
      },
      attribution,
      composition,
      clocks: {
        perfetto: "collector host monotonic microseconds",
        composition: "host Unix microseconds",
      },
      resources,
      environment: {
        sandbox: sandboxArgs,
        memAvailableKiB,
        cpuPressureBefore,
        cpuPressureAfter,
        ioPressureBefore,
        ioPressureAfter,
        hostCpuBefore,
        hostCpuAfter,
      },
      verified: {
        coach: true,
        renderedWhiteboardStroke: true,
        syntheticFirstMediaReadback: true,
        syntheticClipboardReadback: true,
        syntheticProgressReadback: true,
        coachClosed: true,
      },
    };
    for (const [suffix, payload] of [
      [".json", receipt],
      [".trace.json", perfetto],
    ] as const) {
      await writeFile(
        join(job, name + suffix),
        JSON.stringify(payload, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    }
    console.log(
      JSON.stringify({
        attempt,
        variant,
        waitsMs: Object.fromEntries(
          Object.entries(trace.waits).map(([stage, wait]) => [stage, wait.ms]),
        ),
        resources,
        receipt: join(job, name + ".json"),
      }),
    );
  } finally {
    surface?.close();
    await Promise.allSettled([child.finish(), boardChild?.finish()]);
    try {
      await writeFile(
        join(job, "click-through-" + run + ".log"),
        log.join("\n") + "\n",
        { flag: "wx", mode: 0o600 },
      );
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
}
for (let i = 1; i <= Number(repeatsArg); i++) await clickThrough(i);
