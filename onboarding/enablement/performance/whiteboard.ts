import assert from "node:assert/strict";
import { waitFor } from "../../../shared/enablement/performance/electron-observer.ts";
import { endpoint, type clickTrace } from "./click-trace.ts";
import { type launchElectron, visible } from "./electron-fixture.ts";

export async function exerciseWhiteboard(
  boardChild: ReturnType<typeof launchElectron>,
  trace: ReturnType<typeof clickTrace>,
  record: number,
  opened: number,
  prewarm: number,
  coachAfterReady: (frame: number[]) => Promise<void>,
) {
  const boardWait = "whiteboard-open-to-accepted-ink";
  const paper = { color: [59, 121, 189], strokes: [] };
  const initialized = performance.now();
  assert(prewarm < opened && opened < initialized);
  boardChild.send({ type: "initial", practice: true, paper });
  trace.span(endpoint, "prewarm-before-initialization", prewarm, initialized);
  const boardReady = boardChild
    .reply(() => true)
    .then((row) => {
      assert.equal(row.type, "ready");
      const frame = row.frame;
      assert(
        Array.isArray(frame) &&
          frame.length === 4 &&
          frame.every(Number.isFinite) &&
          frame[2] > 0 &&
          frame[3] > 0,
      );
      trace.span(boardWait, "whiteboard-show-ack", initialized);
      return frame as number[];
    });
  const coachHidden = boardReady.then(coachAfterReady);
  coachHidden.catch(() => {});
  const boardSurface = await boardChild.connect(
    "/dist/whiteboard/index.html",
    () => {
      trace.span(endpoint, "whiteboard-renderer-target", prewarm);
    },
  );
  try {
    const canvas = '[aria-label="Whiteboard drawing canvas"]';
    const boardAttached = performance.now();
    const layout = await visible(boardSurface, canvas);
    trace.span(boardWait, "wait-for-whiteboard-canvas", boardAttached, layout);
    trace.span(boardWait, "wait-for-whiteboard-paint", layout);
    const frame = await boardReady;
    trace.checkpoint("whiteboard-open-to-painted-canvas", opened);
    await coachHidden;

    const target = await boardSurface.evaluate<{
      left: number;
      top: number;
      start: { x: number; y: number };
      end: { x: number; y: number };
      lesson: string;
    } | null>(`(() => {
      const board = document.querySelector(${JSON.stringify(canvas)});
      if (!board || board.children.length || document.visibilityState !== "visible") return null;
      const { left, top, width, height } = board.getBoundingClientRect();
      const at = (x, y) => ({
        x: Math.round(left + x * width), y: Math.round(top + y * height),
      });
      const start = at(0.22, 0.55);
      const end = at(0.37, 0.65);
      const lesson = document.querySelector('.native-board-lesson [role="status"]')?.textContent;
      return lesson && [start, end].every(({ x, y }) => document.elementFromPoint(x, y) === board)
        ? { left, top, start, end, lesson } : null;
    })()`);
    assert(target, "Expected a hit-testable canvas with no existing ink");
    const drawn = performance.now();
    trace.input("whiteboard-draw", drawn);
    await boardSurface.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...target.start,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await boardSurface.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...target.end,
      button: "left",
      buttons: 1,
    });
    await boardSurface.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...target.end,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    const edit = async (operation: string, sequence: number) => {
      const row = await boardChild.reply(() => true);
      assert.equal(row.type, "edit");
      assert.equal(row.operation, operation);
      assert.equal(row.sequence, sequence);
      return row;
    };
    const point = async (
      operation: string,
      sequence: number,
      { x, y }: { x: number; y: number },
    ) => {
      const { point } = await edit(operation, sequence);
      assert(
        Array.isArray(point) &&
          point.length === 2 &&
          point.every(Number.isFinite),
      );
      assert(Math.abs(point[0] - (x - target.left)) < 1);
      assert(Math.abs(point[1] - (y - target.top)) < 1);
      return point as [number, number];
    };
    const stroke = [
      await point("begin", 1, target.start),
      await point("move", 2, target.end),
    ];
    const end = await edit("end", 3);
    boardChild.send({
      type: "paper",
      sequence: end.sequence,
      paper: { ...paper, strokes: [stroke] },
    });
    const line = canvas + " > polyline";
    await visible(
      boardSurface,
      '.whiteboard-paper:has(.native-board-lesson[data-ink="true"]) ' + line,
    );
    assert.equal(
      await boardSurface.evaluate(`(() => {
        const lines = document.querySelectorAll(${JSON.stringify(line)});
        return lines.length === 1 ? lines[0].getAttribute("points") : null;
      })()`),
      stroke.map((p) => p.join(",")).join(" "),
    );
    const accepted = performance.now();
    trace.checkpoint("whiteboard-stroke-to-accepted-ink", drawn, accepted);
    trace.checkpoint(boardWait, opened, accepted);
    trace.checkpoint(endpoint, record, accepted);
    const close = 'button[aria-label="Close whiteboard"]';
    await visible(boardSurface, close);
    const closing = await boardSurface.click(close);
    trace.input("close-whiteboard", closing);
    await edit("close", 4);
    trace.span(
      "whiteboard-close-to-closed",
      "close-command-to-parent",
      closing,
    );
    const resources = await boardChild.finish();
    await waitFor(
      async () => boardSurface.closed() || undefined,
      "Whiteboard to close",
    );
    trace.checkpoint("whiteboard-close-to-closed", closing);
    return {
      resources,
      proof: {
        prewarmLeadMs: opened - prewarm,
        lessonAtInput: target.lesson,
        boardFrame: frame,
        stroke,
        acknowledgedSequence: end.sequence,
      },
    };
  } finally {
    boardSurface.close();
  }
}
