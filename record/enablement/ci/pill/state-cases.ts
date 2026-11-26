import assert from "node:assert/strict";
import { test } from "node:test";
import { openPill } from "./record-pill.mjs";
import type { Snapshot } from "../../../pill/host.ts";
import type { Facts, Presentation } from "../../../pill/presentation.ts";

function create() {
  const { dispatchNative, presentNative } = openPill();
  const send = (tag: string, now: number, fields = {}): Snapshot =>
    JSON.parse(dispatchNative(JSON.stringify({ $: tag, ...fields }), now));
  const present = (facts: Partial<Facts> = {}): Presentation =>
    JSON.parse(
      presentNative(
        JSON.stringify({
          phone: false,
          noWords: false,
          noteCount: 0,
          movable: false,
          paste: true,
          inspect: true,
          sharingEnabled: true,
          sharingOnline: true,
          micWarning: null,
          audioIssue: null,
          microphoneProblem: false,
          audioProblem: false,
          ...facts,
        }),
      ),
    );
  return { send, present };
}

test("picker, capture, processing and dismissal use observations from their live producer", () => {
  const { send, present } = create();
  assert.equal(send("CaptureSaved", 0, { recovery: true }).phase, "Hidden");
  assert.equal(send("PickerOpened", 1, { mode: "Screen" }).mode, "Screen");
  assert.equal(
    present().actions.some(({ id }) => id === "record"),
    true,
  );
  assert.equal(send("ModeSelected", 2, { mode: "Area" }).mode, "Area");
  assert.equal(
    present().actions.some(({ id }) => id === "record"),
    false,
  );
  assert.equal(send("CaptureStarted", 3).phase, "Recording");
  assert.equal(send("CaptureSaved", 5, { recovery: true }).phase, "Recording");
  assert.equal(send("CaptureSealed", 6).phase, "Processing");
  assert.equal(send("CaptureFailed", 7).phase, "Hidden");
  assert.equal(send("CaptureSaved", 8, { recovery: true }).phase, "Hidden");
});

test("a processing capture releases the recording controls only after native teardown", () => {
  const { send } = create();
  send("CaptureStarted", 0);
  send("CaptureSealed", 1);
  assert.equal(send("CaptureStarted", 2).phase, "Processing");
  assert.equal(send("PickerOpened", 3, { mode: "Screen" }).phase, "Processing");
  assert.equal(send("SourceReleased", 4).phase, "Processing");
  assert.equal(send("CaptureStarted", 5).phase, "Recording");
  assert.equal(send("CaptureSaved", 6, { recovery: false }).phase, "Recording");
});

test("reveal deadlines preserve minimum visibility and hover linger across a clock rollover", () => {
  const { send, present } = create();
  const now = 0xffff_fff0;
  send("CaptureStarted", now);
  assert.equal(send("RevealOpened", now, { activity: 10 }).wakeInMs, 3500);
  assert.equal(
    send("ActivityObserved", now + 2, { activity: 11 }).wakeInMs,
    898,
  );
  assert.equal(
    send("PointerChanged", now + 850, { inside: true }).wakeInMs,
    null,
  );
  assert.equal(send("Deadline", now + 5000).reveal, true);
  assert.deepEqual(present({ phone: true }).actions.map(({ id }) => id), ["whiteboard", "finish", "cancel"]);
  assert.equal(
    send("PointerChanged", now + 6000, { inside: false }).wakeInMs,
    1200,
  );
  assert.equal(send("Deadline", now + 7199).reveal, true);
  assert.equal(send("Deadline", now + 7200).reveal, false);
  assert.equal(present({ noWords: true }).warning, "No words recognized yet");
  assert.equal(present({ noteCount: 180 }).noteCount, 100);
});

test("completion keeps the same authority when a renderer detaches and another reads it", () => {
  const { send, present } = create();
  send("CaptureStarted", 0);
  send("CaptureSealed", 1);
  assert.equal(send("CaptureSaved", 2, { recovery: false }).wakeInMs, 15000);
  const before = present();
  assert.equal(send("ConsentChanged", 14000, { open: true }).wakeInMs, null);
  assert.equal(send("Deadline", 15002).phase, "Completed");
  assert.equal(send("ConsentChanged", 16000, { open: false }).wakeInMs, 15000);
  assert.deepEqual(present(), before);
  assert.equal(send("Deadline", 30999).phase, "Completed");
  assert.equal(send("Deadline", 31000).phase, "Hidden");
});

test("typed upload progress, retry and recovery ignore changes to display copy", () => {
  const { send, present } = create();
  send("CaptureStarted", 0);
  send("CaptureSealed", 1);
  send("CaptureSaved", 2, { recovery: true, text: "A different translation" });
  const failedCopy = present();
  assert.equal(failedCopy.copyFailed, true);
  assert.equal(failedCopy.actions.find(({ id }) => id === "paste")?.enabled, false);
  assert.equal(failedCopy.actions.find(({ id }) => id === "inspect")?.enabled, true);
  assert.equal(send("Deadline", 15003).phase, "Completed");
  send("ShareStarted", 16000);
  send("CompletionText", 17000, {
    copy: "Uploading",
    text: "New progress wording",
  });
  assert.equal(present().shareIndicator, "uploading");
  assert.equal(
    present().actions.find(({ id }) => id === "copy-link")?.enabled,
    true,
  );
  assert.equal(send("ShareEnded", 20000, { renew: true }).wakeInMs, null);
  send("CompletionText", 20000, { copy: "UploadStopped", text: "Anything" });
  assert.equal(present().shareIndicator, "retry");
  send("CompletionText", 20001, { copy: "Ordinary", text: "Upload failed" });
  assert.equal(present().shareIndicator, "none");
  assert.equal(
    present({ paste: false, inspect: false }).actions.filter(
      ({ enabled }) => enabled,
    ).length,
    1,
  );
});

test("foreground terminal results renew the deadline once and stale terminals do not", () => {
  const { send } = create();
  send("CaptureStarted", 0);
  send("CaptureSealed", 1);
  send("CaptureSaved", 2, { recovery: false });
  assert.equal(send("ShareEnded", 1000, { renew: true }).wakeInMs, 14002);
  assert.equal(send("ShareStarted", 14000).wakeInMs, null);
  assert.equal(send("Deadline", 20000).phase, "Completed");
  assert.equal(send("ShareEnded", 20000, { renew: true }).wakeInMs, 15000);
  assert.equal(send("ShareEnded", 30000, { renew: true }).wakeInMs, 5000);
});

test("warning accents are selected by producer facts without consulting copy", () => {
  const { send, present } = create();
  send("CaptureStarted", 0);
  assert.equal(
    present({ microphoneProblem: true }).actions.find(
      ({ id }) => id === "finish",
    )?.primary,
    false,
  );
  assert.equal(
    present({ micWarning: "Different copy" }).actions.find(
      ({ id }) => id === "finish",
    )?.primary,
    true,
  );
  send("CaptureSealed", 1);
  send("CaptureSaved", 2, { recovery: false, text: "Saved" });
  const warning = present({
    audioProblem: true,
    audioIssue: "New warning copy",
  });
  assert.equal(warning.label, "Saved · New warning copy");
  assert.equal(warning.completedWarning, true);
  assert.equal(
    warning.actions.find(({ id }) => id === "paste")?.primary,
    false,
  );
});

test("pending screen startup reserves the live controls and only enables Cancel", () => {
  const { send, present } = create();
  send("CaptureStarted", 0);
  const pending = present({ screenStarting: true });
  const live = present();
  assert.equal(pending.phase, live.phase);
  assert.equal(pending.label, "Starting recording…");
  assert.deepEqual(pending.actions.map(({ id }) => id), live.actions.map(({ id }) => id));
  assert.deepEqual(pending.actions.filter(({ enabled }) => enabled).map(({ id }) => id), ["cancel"]);
  assert.equal(live.actions.find(({ id }) => id === "finish")?.enabled, true);
  send("CaptureFailed", 1);
  assert.equal(present().phase, "hidden");
});
