import limits from './assembly/frame-limits.mjs';

/** Record's default allocation; native selection receives limits rather than defaults. */
export interface AssemblyPlan {
  version: 1;
  maximumFrames: number;
  ordinaryFrames: number;
}

export function assemblyPlan(durationMs: bigint): AssemblyPlan {
  if (durationMs < 0n || durationMs > 0xffff_ffff_ffff_ffffn) throw Error('Invalid capture duration');
  const high = Number(durationMs >> 32n);
  const low = Number(durationMs & 0xffff_ffffn);
  return {
    version: 1,
    maximumFrames: limits.maximum_frames(high, low),
    ordinaryFrames: limits.ordinary_frames(),
  };
}
