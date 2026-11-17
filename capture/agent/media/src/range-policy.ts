/** Agent's range defaults, native sampling cadence and saved-frame window. */
export interface FrameRangePlan {
  fromMs: bigint;
  toMs: bigint;
  fps: number;
  stepMs: bigint;
  lowerMs: bigint;
  upperMs: bigint;
}
export class FrameRangeError extends Error {}
const U64_MAX = 0xffff_ffff_ffff_ffffn;

export function frameRangePlan(fromMs: bigint, toMs: bigint, fps?: number): FrameRangePlan {
  for (const time of [fromMs,toMs]) {
    if (typeof time !== 'bigint' || time < 0n || time > U64_MAX) throw new FrameRangeError('Invalid Agent frame time');
  }
  if (fromMs > toMs) throw new FrameRangeError('Frame range ends before it starts');
  const rate = fps === undefined ? 4 : fps;
  if (!Number.isInteger(rate) || rate < 1 || rate > 240) throw new FrameRangeError('FPS must be between 1 and 240');
  const denominator = BigInt(rate);
  const stepMs = 1000n / denominator;
  const margin = ((1000n + denominator - 1n) / denominator) / 2n;
  return {fromMs,toMs,fps:rate,stepMs:stepMs > 0n ? stepMs : 1n,
    lowerMs:fromMs > margin ? fromMs - margin : 0n,
    upperMs:toMs > U64_MAX - margin ? U64_MAX : toMs + margin};
}
