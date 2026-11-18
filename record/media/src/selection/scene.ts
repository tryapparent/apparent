export interface SceneTransition {
  startFrame: number;
  frame: number;
  diff: number;
  score: number;
  ordinary: boolean;
  event: string;
}
export type DrawingSpan = readonly [bigint, bigint];
const MAXIMUM = 0xffff_ffff_ffff_ffffn;
function clock(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value > MAXIMUM)
    throw Error("Invalid scene clock");
}

export function sceneTransitions(
  times: readonly bigint[],
  deltas: readonly number[],
  drawing: readonly DrawingSpan[],
): SceneTransition[] {
  if (deltas.length !== Math.max(0, times.length - 1))
    throw Error("Invalid scene measurements");
  for (let i = 0; i < times.length; i++) {
    clock(times[i]);
    if (i && times[i] < times[i - 1]) throw Error("Unordered scene clocks");
  }
  for (const span of drawing) {
    if (span.length !== 2) throw Error("Invalid drawing span");
    clock(span[0]);
    clock(span[1]);
  }
  const out: SceneTransition[] = [];
  let active: { startFrame: number; frame: number; diff: number } | undefined;
  const finish = () => {
    if (!active) return;
    const { startFrame, frame, diff } = active;
    out.push({
      startFrame,
      frame,
      diff,
      score: Math.fround(40 + Math.fround(40 * diff)),
      ordinary: !drawing.some(
        ([start, end]) => start <= times[frame] && times[frame] <= end,
      ),
      event: "scene changed",
    });
    active = undefined;
  };
  for (let i = 0; i < deltas.length; i++) {
    const value = deltas[i];
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw Error("Invalid scene measurement");
    const diff = Math.fround(value);
    if (diff > Math.fround(0.08))
      active = {
        startFrame: active?.startFrame ?? i,
        frame: i + 1,
        diff: active ? Math.max(active.diff, diff) : diff,
      };
    else finish();
  }
  finish();
  return out;
}
