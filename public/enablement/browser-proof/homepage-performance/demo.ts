import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { framePacing } from "../motion/frame-pacing.ts";

export async function verifyDemo(page: Page, mobile: boolean) {
  if (mobile) {
    assert(
      await page.getByRole("link", { name: "Get the desktop app" }).isVisible(),
    );
    const example = page.locator(".mobile-how-it-works");
    await example.scrollIntoViewIfNeeded();
    assert(
      await example
        .getByRole("img", { name: "A sketch of a ghost with large eyes" })
        .isVisible(),
    );
    assert(
      await example.getByText("Draw the change", { exact: true }).isVisible(),
    );
    return { mobileSketchVisible: true };
  }
  const frame = page.locator(
    '.feature-grid-card iframe[title="Sketch what you mean"]',
  );
  const card = page
    .getByRole("heading", { name: "Sketch what you mean" })
    .locator("..");
  await card.evaluate((node) => {
    performance.mark("first-feature-scroll");
    node
      .closest("article")!
      .scrollIntoView({ block: "center", behavior: "instant" });
  });
  await frame.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const frame = document.querySelector<HTMLIFrameElement>(
        'iframe[title="Sketch what you mean"]',
      );
      const image =
        frame?.contentDocument?.querySelector<HTMLImageElement>("img.before");
      return (
        frame &&
        getComputedStyle(frame).opacity === "1" &&
        image?.complete &&
        image.naturalWidth > 0 &&
        frame.contentDocument?.getElementById("apparent-feature-theme")
      );
    },
    null,
    { timeout: 10_000 },
  );
  const ready = await page.evaluate(
    () => performance.mark("first-feature-visible").startTime,
  );
  const scroll = await page.evaluate(
    () =>
      performance.getEntriesByName("first-feature-scroll").at(-1)!.startTime,
  );
  const data = await frame
    .contentFrame()
    .locator("video#sketch")
    .evaluate(
      (video) =>
        new Promise<{
          start: number;
          presented: number;
          frames: number[];
          long: number[];
          changed: boolean;
        }>((done, reject) => {
          const player = video as HTMLVideoElement;
          const frames: number[] = [];
          const long: number[] = [];
          let previous = performance.now();
          const start = previous;
          let presented = 0;
          let mediaTime = -1;
          let frameCount = 0;
          const observer = new PerformanceObserver((entries) =>
            entries.getEntries().forEach((entry) => long.push(entry.duration)),
          );
          observer.observe({ type: "longtask" });
          const observeVideo: VideoFrameRequestCallback = (now, metadata) => {
            if (metadata.mediaTime > mediaTime) frameCount++;
            mediaTime = metadata.mediaTime;
            if (frameCount >= 2) presented = now;
            else player.requestVideoFrameCallback(observeVideo);
          };
          player.requestVideoFrameCallback(observeVideo);
          const tick = (now: number) => {
            frames.push(now - previous);
            previous = now;
            const changed = Boolean(document.querySelector(".demo.updated"));
            if (presented && changed) {
              observer.disconnect();
              done({
                start,
                presented,
                frames: frames.slice(1),
                long,
                changed,
              });
            } else if (now - start > 15_000) {
              observer.disconnect();
              reject(
                new Error(
                  "The packaged sketch did not present advancing video and reveal the changed demo",
                ),
              );
            } else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
  return {
    scrollMs: scroll,
    visibleMs: ready,
    scrollToVisibleMs: ready - scroll,
    iframeObservedToAdvancingVideoMs: data.presented - data.start,
    changed: data.changed,
    ...framePacing(data.frames, data.long),
  };
}
