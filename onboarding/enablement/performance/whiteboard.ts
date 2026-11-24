import assert from "node:assert/strict";
import { waitFor } from "../../../shared/enablement/performance/electron-observer.ts";
import type { clickTrace } from "./click-trace.ts";
import { type launchElectron, visible } from "./electron-fixture.ts";

export async function exerciseWhiteboard(
  boardChild: ReturnType<typeof launchElectron>,
  trace: ReturnType<typeof clickTrace>,
  opened: number,
  boardLaunch: number,
  coachAfterReady: () => Promise<void>,
) {
  const boardWait = "whiteboard-open-to-usable";
  const paper = { color: [59, 121, 189], strokes: [] };
  boardChild.send({ type: "initial", practice: true, paper });
  const boardReady = boardChild
    .reply((row) => row.type === "ready")
    .then((row) => {
      assert(
        Array.isArray(row.frame) &&
          row.frame.length === 4 &&
          row.frame[2] > 0 &&
          row.frame[3] > 0,
      );
      trace.span(boardWait, "whiteboard-native-show-ack", boardLaunch);
    });
  boardReady.catch(() => {});
  const boardSurface = await boardChild.connect(
    "/dist/whiteboard/index.html",
    () => {
      trace.span(boardWait, "whiteboard-renderer-target", boardLaunch);
    },
  );
  try {
    const canvas = '[aria-label="Whiteboard drawing canvas"]';
    const boardAttached = performance.now();
    const boardLayout = await visible(boardSurface, canvas);
    trace.span(
      boardWait,
      "wait-for-whiteboard-canvas",
      boardAttached,
      boardLayout,
    );
    trace.span(boardWait, "wait-for-whiteboard-paint", boardLayout);
    await boardReady;
    const canvasPainted = performance.now();
    trace.checkpoint(
      "whiteboard-open-to-painted-canvas",
      opened,
      canvasPainted,
    );
    await visible(boardSurface, '.native-board-lesson[data-ready="true"]');
    trace.span(boardWait, "wait-for-lesson-turn", canvasPainted);
    trace.checkpoint(boardWait, opened);
    await coachAfterReady();
    const drawn = await boardSurface.click(canvas);
    trace.input("whiteboard-draw", drawn);
    const begin = await boardChild.reply((row) => row.operation === "begin");
    const end = await boardChild.reply((row) => row.operation === "end");
    assert(
      Array.isArray(begin.point) &&
        begin.point.length === 2 &&
        begin.point.every(Number.isFinite),
    );
    boardChild.send({
      type: "paper",
      sequence: end.sequence,
      paper: { ...paper, strokes: [[begin.point]] },
    });
    const circle = canvas + " circle";
    await visible(boardSurface, circle);
    await visible(boardSurface, '.native-board-lesson[data-ink="true"]');
    assert.deepEqual(
      await boardSurface.evaluate(
        `Array.from(document.querySelector(${JSON.stringify(circle)}).attributes).filter(({ name }) => name === "cx" || name === "cy").map(({ value }) => Number(value))`,
      ),
      begin.point,
    );
    trace.checkpoint("whiteboard-stroke-to-accepted-ink", drawn);
    const close = 'button[aria-label="Close whiteboard"]';
    await visible(boardSurface, close);
    const closing = await boardSurface.click(close);
    trace.input("close-whiteboard", closing);
    await boardChild.reply((row) => row.operation === "close");
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
    return resources;
  } finally {
    boardSurface.close();
  }
}
