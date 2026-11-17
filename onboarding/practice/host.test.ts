import { test } from "node:test";
import assert from "node:assert/strict";
import { PracticeHost, type Batch } from "./host.ts";
function driver() {
  const host = new PracticeHost();
  let sequence = 0,
    attempt = 0;
  return {
    host,
    send(events: Batch["events"], reset = false) {
      if (reset) attempt++;
      return host.accept({
        type: "practice-batch",
        version: 1,
        source: "18446744073709551615",
        transport: "2",
        attempt: String(attempt),
        capture: String(attempt),
        sequence: String(++sequence),
        intent: events.some((e) => e.type === "action")
          ? String(sequence)
          : null,
        board: "current-board",
        events,
      });
    },
  };
}
const base: Batch = {
  type: "practice-batch",
  version: 1,
  source: "1",
  transport: "2",
  attempt: "0",
  capture: "0",
  sequence: "1",
  intent: null,
  board: null,
  events: [{ type: "selecting" }],
};
test("strict private facts: source/transport/attempt/capture/sequence and barrier admission", () => {
  for (const patch of [
    { version: 2 },
    { source: 1 },
    { sequence: "01" },
    { source: "18446744073709551616" },
    { stage: "complete" },
    { events: [] },
    { events: Array(9).fill({ type: "started" }) },
    { events: [{ type: "ink", board: true, screen: 2 ** 54 }] },
    { events: [{ type: "saved", copied: 1 }] },
    { intent: "1" },
    { events: [{ type: "action", action: "practice-finish" }] },
  ])
    assert.throws(() => new PracticeHost().accept({ ...base, ...patch }));
  for (const patch of [
    { source: "3" },
    { transport: "3" },
    { attempt: "2" },
    { capture: "2" },
    { sequence: "1" },
    { sequence: "3" },
  ]) {
    const host = new PracticeHost();
    host.accept(base);
    assert.throws(() => host.accept({ ...base, sequence: "2", ...patch }));
  }
  const host = new PracticeHost();
  host.accept(base);
  assert.throws(() => host.accept(base));
});
test("reset barriers reset eligible and ineligible terminal lessons, whole-batch effects never close on transient ink", () => {
  const d = driver();
  d.send(
    [{ type: "reset" }, { type: "started" }, { type: "whiteboard" }],
    true,
  );
  const reply = d.send([
    { type: "whiteboard-visible", visible: true },
    { type: "ink", board: true, screen: 4 },
    { type: "processing" },
    { type: "saved", copied: true },
  ]);
  assert.equal(reply.stage, "copied");
  assert.equal(reply.closeBoard, false);
  assert.equal(d.send([{ type: "reset" }], true).stage, "start");
  d.send([{ type: "started" }, { type: "whiteboard" }]);
  const ink = d.send([
    { type: "ink", board: true, screen: 0 },
    { type: "whiteboard-visible", visible: false },
  ]);
  assert.equal(ink.closeBoard, true);
  assert.equal(ink.board, "current-board");
  assert.equal(
    d.send([{ type: "processing" }, { type: "saved", copied: true }]).stage,
    "copied",
  );
  assert.equal(
    d.send([{ type: "reset" }, { type: "started" }], true).stage,
    "whiteboard",
  );
});

test("rejected batches do not consume a sequence or change the lesson", () => {
  const host = new PracticeHost();
  host.accept(base);
  const before = structuredClone(host.state);
  assert.throws(() =>
    host.accept({
      ...base,
      sequence: "2",
      events: [{ type: "started" }, { type: "action", action: "forged" }],
    }),
  );
  assert.deepEqual(host.state, before);
  assert.equal(
    host.accept({ ...base, sequence: "2", events: [{ type: "started" }] })
      .stage,
    "whiteboard",
  );
});

test("accepted identity cannot be rewritten by subsequent caller mutation", () => {
  const host = new PracticeHost();
  const input = structuredClone(base);
  host.accept(input);
  input.source = "99";
  input.sequence = "20";
  assert.equal(
    host.accept({ ...base, sequence: "2", events: [{ type: "started" }] })
      .sequence,
    "2",
  );
});

test("a first board stroke never asks the provider to close the board", () => {
  const d = driver();
  d.send(
    [{ type: "reset" }, { type: "started" }, { type: "whiteboard" }],
    true,
  );
  const first = d.send([
    { type: "ink", board: true, screen: 2 },
    { type: "whiteboard-visible", visible: true },
  ]);
  assert.equal(first.stage, "board-ink");
  assert.equal(first.closeBoard, false);
  const closed = d.send([
    { type: "ink", board: true, screen: 3 },
    { type: "whiteboard-visible", visible: false },
  ]);
  assert.equal(closed.stage, "screen-ink");
  assert.equal(
    d.send([{ type: "ink", board: false, screen: 3 }]).stage,
    "screen-ink",
  );
  assert.equal(
    d.send([{ type: "ink", board: false, screen: 4 }]).stage,
    "stop",
  );
});
