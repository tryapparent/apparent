import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type RecordingFixtureMessage,
  recordingFixture,
} from "./recording-fixture.ts";

test("the Recording fixture only handles Recording actions", () => {
  const replies: RecordingFixtureMessage[] = [];
  const fixture = recordingFixture((message) =>
    replies.push(structuredClone(message)),
  );

  fixture.receive({ action: "navigate", pane: "recording" });
  fixture.receive({ action: "handoff-auto-paste", request: 1, enabled: false });
  assert.deepEqual(replies.splice(0), []);

  fixture.receive({ action: "recording-meter", visible: false });
  fixture.receive({ action: "recording-meter", visible: true });
  assert.deepEqual(replies.splice(0), [
    { type: "recording-level", level: 0.45 },
  ]);

  fixture.mac();
  const initial = replies.pop();
  assert.ok(initial?.type === "recording-state");
  assert.deepEqual(initial.state.playback, { enabled: true, level: 20 });

  const save = {
    action: "recording-preference",
    key: "lowerPlayback",
    value: false,
  };
  fixture.refuse = true;
  fixture.receive({ ...save, request: 2 });
  assert.deepEqual(replies.splice(0), [
    { type: "recording-result", request: 2, ok: false },
  ]);
  fixture.refuse = false;
  fixture.receive({ ...save, request: 3 });
  const [state, receipt] = replies.splice(0);
  assert.ok(state?.type === "recording-state");
  assert.deepEqual(state.state.playback, { enabled: false, level: 20 });
  assert.deepEqual(receipt, { type: "recording-result", request: 3, ok: true });
});
