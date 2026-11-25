import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { receiver, type SocketServer } from "./receiver.ts";
import { arm, calibrate, now, witness, type RendererPage } from "./witness.ts";
import { attribution, type Span } from "./trace.ts";

type Locator = {
  click(): Promise<void>;
};
type Page = RendererPage & {
  locator(selector: string): Locator;
  getByRole(
    role: string,
    options: { name: string | RegExp; exact?: boolean },
  ): Locator;
  screenshot(options: { path: string }): Promise<Buffer>;
};
type ElectronModule = {
  app: {
    getAppMetrics(): { pid: number; cpu: { cumulativeCPUUsage: number } }[];
    getGPUFeatureStatus(): { gpu_compositing: string };
  };
  BrowserWindow: {
    getAllWindows(): { isVisible(): boolean; isFocusable(): boolean }[];
  };
};
type ElectronApp = {
  close(): Promise<void>;
  firstWindow(): Promise<Page>;
  process(): { pid?: number; stdout: NodeJS.ReadableStream };
  waitForEvent(event: "window", options: { timeout: number }): Promise<Page>;
  evaluate<Result>(
    callback: (electron: ElectronModule) => Result,
  ): Promise<Result>;
  evaluate<Argument, Result>(
    callback: (electron: ElectronModule, argument: Argument) => Result,
    argument: Argument,
  ): Promise<Result>;
};
type LaunchOptions = {
  executablePath: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};
export type ScenarioDriver = {
  electron: { launch(options: LaunchOptions): Promise<ElectronApp> };
  expect: {
    (
      locator: Locator,
    ): { toBeEnabled(): Promise<void>; toBeVisible(): Promise<void> };
    poll<T>(callback: () => T | Promise<T>): { toBe(value: T): Promise<void> };
  };
  sockets: SocketServer;
  executablePath: string;
};

export const fixture = "handoff-t3-existing-thread-v1";
const handoff = "Synthetic benchmark recording handoff";
const chosenSelector = '[role=option][aria-label^="Chosen thread"]';
const submittedSelector = "[role=img][aria-label=Submitted]";
const triggerSelector = "button[role=combobox]";

export async function scenario({
  electron,
  expect,
  sockets,
  host,
  executablePath,
  scratch,
  warm,
  traced,
  proof,
  diagnose,
}: ScenarioDriver & {
  host: string;
  scratch: string;
  warm: boolean;
  traced: boolean;
  proof?: boolean;
  diagnose?: (stage: string, electron?: number) => Promise<void>;
}) {
  const hosted = process.env.RUNNER_ENVIRONMENT === "github-hosted";
  const cleanup: (() => Promise<void>)[] = [];
  const f = await receiver(
    { after: (fn) => cleanup.push(fn) },
    sockets,
    scratch,
  );
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    f.many();
    await f.save(true);
    if (diagnose) await diagnose("before-electron-launch");
    const app = await electron.launch({
      executablePath,
      args: [
        host,
        "--no-sandbox",
        "--ozone-platform=x11",
        ...(hosted ? ["--disable-gpu"] : []),
      ],
      env: {
        ...process.env,
        HOME: f.home,
        XDG_CONFIG_HOME: join(f.home, "config"),
        XDG_CACHE_HOME: join(f.home, "cache"),
        XDG_DATA_HOME: join(f.home, "data"),
        XDG_RUNTIME_DIR: f.home,
        APPARENT_CONFIG: f.config,
        HYPRLAND_INSTANCE_SIGNATURE: "synthetic-benchmark",
        APPARENT_DESKTOP_REPORTING: "0",
      },
    });
    cleanup.push(() => app.close());
    const publish = (message: object) =>
      app.evaluate(
        (_electron: unknown, value: object) =>
          process.stdin.emit("data", JSON.stringify(value) + "\n"),
        message,
      );
    let stdout = "";
    app.process().stdout.on("data", (chunk: Buffer) => {
      stdout += String(chunk);
      let line: number;
      while ((line = stdout.indexOf("\n")) >= 0) {
        const raw = stdout.slice(0, line);
        stdout = stdout.slice(line + 1);
        try {
          const message = JSON.parse(raw);
          if (message.ready)
            void publish({
              type: "activate",
              windowId: message.windowId,
            }).catch(() => {});
        } catch {}
      }
    });
    const initial = await app.firstWindow();
    if (diagnose) await diagnose("first-window", app.process().pid);
    const capture = randomUUID();
    const state = (recording: boolean) => ({
      type: "state",
      capture,
      t3Eligible: true,
      view: {
        revision: recording ? 1 : 2,
        phase: recording ? "recording" : "completed",
        clock: "00:04",
        label: recording ? "Recording" : "Saved",
        warning: null,
        notice: null,
        reducedMotion: true,
        draggable: false,
        inputWaveform: null,
        noteCount: 0,
        actions: [
          {
            id: recording ? "finish" : "paste",
            label: recording ? "Finish" : "Paste",
            enabled: true,
            selected: false,
            primary: true,
          },
        ],
      },
    });

    if (warm) {
      await publish(state(true));
      await expect(
        initial.getByRole("button", { name: "Finish", exact: true }),
      ).toBeEnabled();
      await expect.poll(() => f.reads).toBe(1);
      await expect.poll(() => f.configReplies).toBe(1);
    }
    if (diagnose)
      await diagnose("catalogue-preparation-finished", app.process().pid);
    const replacement = app.waitForEvent("window", { timeout: 10_000 });
    const completion = state(false);
    const completionObservedMs = now();
    await publish(completion);
    const page = await replacement;
    heartbeat = setInterval(
      () => void publish(completion).catch(() => {}),
      2000,
    );
    const trigger = page.locator(triggerSelector);
    await expect(trigger).toBeEnabled();
    const mappedPicker = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) => window.isVisible() && window.isFocusable(),
        ),
      );
    await expect.poll(mappedPicker).toBe(true);
    const entryObservationMs = now();
    if (diagnose) await diagnose("mapped-picker", app.process().pid);
    await publish({ type: "handoff-ready", capture, text: handoff });
    await expect.poll(() => f.reads).toBe(1);
    const before = await calibrate(page);

    await arm(page, triggerSelector, chosenSelector);
    await trigger.click();
    const picker = await witness(page);
    const option = page.getByRole("option", { name: /Chosen thread/ });
    await expect(option).toBeEnabled();
    assert.equal(f.calls.length, 0);
    if (diagnose) await diagnose("picker-presented", app.process().pid);
    if (proof)
      await page.screenshot({ path: join(scratch, capture + "-picker.png") });

    await arm(page, chosenSelector, submittedSelector);
    await option.click();
    const send = await witness(page);
    await expect(
      page.getByRole("img", { name: "Submitted", exact: true }),
    ).toBeVisible();
    if (diagnose) await diagnose("submitted-presented", app.process().pid);
    const after = await calibrate(page);
    if (proof)
      await page.screenshot({
        path: join(scratch, capture + "-submitted.png"),
      });
    const low = Math.max(before.low, after.low) - 0.2;
    const high = Math.min(before.high, after.high) + 0.2;
    assert.ok(
      high >= low && high - low < 10,
      "Renderer clock uncertainty exceeds 10 ms",
    );
    const offset = (high + low) / 2;
    const chart = (marks: typeof send) =>
      Object.fromEntries(
        Object.entries(marks).map(([key, ms]) => [key, ms + offset]),
      ) as typeof send;
    const pickerHost = chart(picker);
    const sendHost = chart(send);

    assert.equal(f.calls.length, 1);
    assert.equal(f.accepted.size, 1);
    const [{ tag, payload }] = f.calls;
    assert.equal(tag, "orchestration.dispatchCommand");
    const uuid =
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    assert.ok(typeof payload.commandId === "string");
    assert.match(payload.commandId, uuid);
    assert.ok(f.accepted.has(payload.commandId));
    assert.match(String(payload.messageId), uuid);
    assert.notEqual(payload.commandId, payload.messageId);
    assert.deepEqual(payload, {
      type: "message.dispatch",
      commandId: payload.commandId,
      threadId: "thread",
      messageId: payload.messageId,
      text: handoff,
      attachments: [],
      createdBy: "user",
      creationSource: "web",
      deliveryIntent: "auto",
      dispatchMode: { type: "start_immediately" },
    });
    const acceptedMs = f.acceptanceMs[0];
    assert.ok(acceptedMs >= sendHost.input - (high - low) / 2);
    assert.ok(acceptedMs <= sendHost.visible + (high - low) / 2);

    const storage = join(f.home, "t3-handoffs");
    const files = await readdir(storage);
    const receiptName =
      createHash("sha256").update(capture).digest("hex") + ".json";
    assert.deepEqual(files, [receiptName]);
    const receiptPath = join(storage, receiptName);
    const info = await stat(receiptPath);
    const disk = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(info.mode & 0o777, 0o600);
    assert.equal(disk.version, 1);
    assert.equal(disk.capture, capture);
    assert.equal(disk.phase, "sent");
    assert.ok(
      Number.isFinite(disk.createdAt) &&
        Number.isFinite(disk.sentAt) &&
        disk.createdAt <= disk.sentAt,
    );
    assert.equal(disk.text, null);
    assert.equal(disk.commandId, payload.commandId);
    assert.equal(disk.messageId, payload.messageId);
    assert.deepEqual(disk.target, {
      origin: f.origin,
      threadId: "thread",
      projectId: "p",
      title: "Chosen thread",
    });

    const runtime = (await app.evaluate(
      ({ app }, hosted) => ({
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        ...(hosted && {
          gpuCompositing: app.getGPUFeatureStatus().gpu_compositing,
        }),
        processes: app.getAppMetrics().map(({ pid, cpu }) => ({
          pid,
          cpuSeconds: cpu.cumulativeCPUUsage,
        })),
        spans:
          Reflect.get(globalThis, Symbol.for("apparent.handoff.benchmark")) ??
          [],
      }),
      hosted,
    )) as {
      electron: string;
      chrome: string;
      gpuCompositing?: string;
      processes: { pid: number; cpuSeconds: number }[];
      spans: Span[];
    };
    if (hosted)
      assert.match(
        runtime.gpuCompositing ?? "",
        /^(disabled|unavailable|software)/,
        "Hosted Xvfb fixture must use software compositing",
      );
    const pssKiB = await Promise.all(
      runtime.processes.map(async ({ pid }) => {
        const rollup = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
        const pss = /^Pss:\s+(\d+) kB$/m.exec(rollup);
        assert.ok(pss, "Could not verify Electron PSS");
        return Number(pss[1]);
      }),
    );
    if (diagnose)
      await diagnose("verified-receipt-and-resources", app.process().pid);
    const spans = runtime.spans.filter((span) => span.attempt === capture);
    const dispatch = spans.find(
      (span) =>
        span.name === "transport.websocket.send" &&
        spans.some(
          (parent) =>
            parent.id === span.parent &&
            parent.name === "transport.rpc.orchestration.dispatchCommand",
        ),
    );
    if (traced) {
      assert.ok(
        dispatch && dispatch.startMs <= acceptedMs,
        "Missing dispatch witness",
      );
      assert.ok(spans.some((span) => span.name === "store.save.sent"));
    } else assert.equal(spans.length, 0);
    const attributed = spans.filter(
      ({ name }) =>
        name.startsWith("store.save.") ||
        name.startsWith("transport.rpc.") ||
        [
          "transport.shell",
          "ipc.pill:layout",
          "ipc.pill:destination-focus",
          "record.ready",
        ].includes(name),
    );
    if (traced) {
      assert.ok(
        await mappedPicker(),
        "Submitted renderer had no mapped Electron window",
      );
    }
    return {
      attempt: capture,
      variant: warm ? "prewarmed-catalogue" : "fresh-catalogue",
      witness:
        "trusted click, visible enabled DOM, two renderer animation frames",
      clock: { domain: "linux-monotonic-ms", rendererOffset: { low, high } },
      runtime: {
        electron: runtime.electron,
        chrome: runtime.chrome,
        ...(hosted && { gpuCompositing: runtime.gpuCompositing }),
      },
      waits: {
        pickerMs: picker.presented - picker.input,
        sendMs: send.presented - send.input,
        pickerVisibleMs: picker.visible - picker.input,
        sendVisibleMs: send.visible - send.input,
        completionToTriggerObservedMs:
          entryObservationMs - completionObservedMs,
      },
      milestones: {
        completionObservedMs,
        entryObservationMs,
        picker: pickerHost,
        send: sendHost,
        acceptedMs,
      },
      receipt: {
        verified: true,
        tag,
        commandId: payload.commandId,
        messageId: payload.messageId,
        threadId: payload.threadId,
        payloadSha256: createHash("sha256").update(handoff).digest("hex"),
        phase: disk.phase,
      },
      resources: {
        appCpuSeconds: runtime.processes.reduce(
          (sum, process) => sum + process.cpuSeconds,
          0,
        ),
        appPostSendPssKiB: pssKiB.reduce((sum, pss) => sum + pss, 0),
        durableReceiptBytes: info.size,
      },
      trace: traced
        ? {
            spans,
            selectionToDispatchMs: dispatch!.startMs - sendHost.input,
            dispatchToAcceptanceMs: acceptedMs - dispatch!.startMs,
            acceptanceToDomMs: sendHost.visible - acceptedMs,
            domToRendererPresentationMs: send.presented - send.visible,
            picker: attribution(
              pickerHost.input,
              pickerHost.presented,
              attributed,
            ),
            send: attribution(sendHost.input, sendHost.presented, attributed),
            preparation: attribution(
              completionObservedMs,
              entryObservationMs,
              attributed,
            ),
          }
        : null,
    };
  } finally {
    clearInterval(heartbeat);
    try {
      if (cleanup.length > 1) await cleanup.pop()?.();
    } finally {
      await cleanup.pop()?.();
    }
  }
}
