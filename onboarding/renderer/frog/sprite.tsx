import { useCallback, type RefObject } from "react";
import couch from "./couch-hops.png";

export const hopDuration = 800;
const pivots = [
  [230, 255],
  [217, 275],
  [234, 240],
  [240, 220],
  [260, 207],
  [247, 237],
  [224, 257],
  [230, 247],
];
const headWidths = [155, 155, 160, 165, 160, 160, 165, 155];
const feet = [335, 335, 345, 340, 297, 327, 332, 327];
export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const blend = (start: number, end: number, time: number) =>
  start + (end - start) * time;

export function hop(elapsed: number) {
  const flight = clamp((elapsed - 120) / 520);
  const pose =
    elapsed < 60
      ? 0
      : elapsed < 120
        ? 1
        : flight < 0.15
          ? 2
          : flight < 0.4
            ? 3
            : flight < 0.65
              ? 4
              : elapsed < 640
                ? 5
                : elapsed < 730
                  ? 6
                  : 7;
  return { flight, pose, height: 4 * flight * (1 - flight) };
}

type SpriteFrame = ReturnType<typeof hop> & {
  x?: number;
  y?: number;
  width?: number;
  left?: boolean;
};
type Motion = {
  duration: number;
  frame(elapsed: number): SpriteFrame;
  done?(): void;
};

export function FrogSprite({
  motion,
  canvasRef,
  left = false,
}: {
  motion?: Motion;
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  left?: boolean;
}) {
  const mount = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      if (canvasRef) canvasRef.current = canvas;
      const sheet = new Image();
      let request = 0;
      let started: number | undefined;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)");
      function draw({
        pose,
        flight,
        x = 0,
        y = 0,
        width,
        left: mirror = left,
      }: SpriteFrame) {
        if (!canvas || !context) return;
        canvas.style.transform = `translate(${x}px, ${y}px)`;
        if (width !== undefined) canvas.style.width = `${width}px`;
        const cellWidth = sheet.naturalWidth / 4;
        const cellHeight = sheet.naturalHeight / 2;
        const fit = canvas.width / 370;
        const scale = (fit * 0.94 * 155) / headWidths[pose];
        const [pivotX, pivotY] = pivots[pose];
        const launch = clamp(flight / 0.2);
        const ease = launch * launch * (3 - 2 * launch);
        const baseline = canvas.height * 0.88;
        const vertical =
          pose < 2 || pose >= 6
            ? baseline - feet[pose] * scale
            : baseline - (75 + 20 * (1 - ease)) * fit - pivotY * scale;
        context.resetTransform();
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = false;
        if (mirror) {
          context.translate(canvas.width, 0);
          context.scale(-1, 1);
        }
        context.drawImage(
          sheet,
          (pose % 4) * cellWidth,
          Math.floor(pose / 4) * cellHeight,
          cellWidth,
          cellHeight,
          canvas.width / 2 - pivotX * scale,
          vertical,
          cellWidth * scale,
          cellHeight * scale,
        );
        canvas.dataset.pose = String(pose);
      }
      function tick(now: number) {
        if (!motion) return;
        started ??= now;
        const elapsed = Math.min(now - started, motion.duration);
        draw(motion.frame(reduce.matches ? motion.duration : elapsed));
        if (elapsed < motion.duration && !reduce.matches)
          request = requestAnimationFrame(tick);
        else motion.done?.();
      }
      sheet.onload = () => {
        if (motion) tick(performance.now());
        else draw(hop(hopDuration));
      };
      sheet.src = couch;
      return () => {
        cancelAnimationFrame(request);
        sheet.onload = null;
        if (canvasRef) canvasRef.current = null;
      };
    },
    [motion, left, canvasRef],
  );
  return <canvas aria-hidden="true" width={184} height={122} ref={mount} />;
}
