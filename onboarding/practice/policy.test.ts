import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialPractice,
  reducePractice,
  stages,
  type Event,
  type Practice,
} from "./policy.ts";

function driver(seed: Practice = initialPractice()) {
  let state = seed;
  return {
    get state() {
      return state;
    },
    send(event: Event) {
      const before = structuredClone(state);
      Object.freeze(state);
      const result = reducePractice(state, event);
      assert.deepEqual(state, before);
      state = result.state;
      return result.accepted;
    },
  };
}

test("board ink stays visible until closure; screen ink must be fresh", () => {
  const p = driver();
  p.send({ type: "started" });
  p.send({ type: "whiteboard-visible", visible: true });
  p.send({ type: "ink", board: true, screen: 7 });
  assert.equal(p.state.stage, "board-ink");
  p.send({ type: "whiteboard-visible", visible: true });
  p.send({ type: "ink", board: true, screen: 9 });
  assert.equal(p.state.stage, "board-ink");
  p.send({ type: "whiteboard-visible", visible: false });
  assert.equal(p.state.stage, "screen-ink");
  for (const screen of [0, 7, 9]) p.send({ type: "ink", board: false, screen });
  assert.equal(p.state.stage, "screen-ink");
  p.send({ type: "ink", board: false, screen: 10 });
  assert.equal(p.state.stage, "stop");
});

test("an empty closed board reopens the prompt", () => {
  const p = driver();
  p.send({ type: "started" });
  p.send({ type: "whiteboard" });
  p.send({ type: "whiteboard-visible", visible: false });
  assert.equal(p.state.stage, "whiteboard");
  assert.equal(p.state.boardInk, false);
});

test("cancel/retry resets capture proof; notes cannot replace drawing", () => {
  const p = driver({
    ...initialPractice(),
    stage: "stop",
    boardInk: true,
    screenInk: true,
  });
  p.send({ type: "cancelled" });
  assert.equal(p.state.stage, "retry");
  p.send({ type: "started" });
  assert.deepEqual(p.state, { ...initialPractice(), stage: "whiteboard" });
  p.send({ type: "note", saved: true });
  assert.equal(p.state.stage, "whiteboard");
});

test("legacy note resumes with a fresh screen baseline", () => {
  const p = driver({ ...initialPractice(), stage: "note", boardInk: true });
  p.send({ type: "ink", board: false, screen: 4 });
  assert.equal(p.state.stage, "screen-ink");
  p.send({ type: "ink", board: false, screen: 4 });
  assert.equal(p.state.screenInk, false);
  p.send({ type: "ink", board: false, screen: 5 });
  assert.equal(p.state.stage, "stop");
});

test("all stages reject forged actions and ignore late notes", () => {
  for (const stage of stages) {
    const seed: Practice = {
      ...initialPractice(),
      stage,
      boardInk: true,
      screenInk: true,
      pasted: true,
    };
    for (const action of [
      "",
      "practice-saved",
      "practice-latest",
      "practice-started",
      "unknown",
    ]) {
      const p = driver(seed);
      assert.equal(p.send({ type: "action", action }), false);
      assert.deepEqual(p.state, seed);
    }
    for (const saved of [false, true]) {
      const p = driver(seed);
      p.send({ type: "note", saved });
      assert.deepEqual(p.state, seed);
    }
    const p = driver(seed);
    assert.equal(
      p.send({ type: "action", action: "practice-finish" }),
      stage === "complete",
    );
  }
});

test("completion needs independent board, screen and paste facts", () => {
  for (const stage of stages)
    for (let bits = 0; bits < 8; bits++) {
      const seed: Practice = {
        ...initialPractice(),
        stage,
        boardInk: Boolean(bits & 1),
        screenInk: Boolean(bits & 2),
        pasted: Boolean(bits & 4),
      };
      const p = driver(seed);
      p.send({ type: "opened-latest" });
      assert.deepEqual(
        p.state,
        stage === "locate"
          ? { ...seed, latest: true, stage: bits === 7 ? "complete" : "retry" }
          : seed,
      );
    }
});

test("saved and copied receipts remain distinct", () => {
  for (const copied of [false, true]) {
    const p = driver({
      ...initialPractice(),
      stage: "stop",
      boardInk: true,
      screenInk: true,
    });
    p.send({ type: "saved", copied });
    assert.equal(p.state.stage, "stop");
    p.send({ type: "processing" });
    p.send({ type: "saved", copied });
    assert.equal(p.state.stage, copied ? "copied" : "copy-failed");
    assert.equal(
      p.send({
        type: "action",
        action: copied ? "practice-paste" : "practice-locate",
      }),
      true,
    );
    if (copied)
      assert.equal(p.send({ type: "action", action: "practice-pasted" }), true);
    p.send({ type: "opened-latest" });
    assert.equal(p.state.stage, copied ? "complete" : "retry");
  }
});
