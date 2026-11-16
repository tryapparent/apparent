/** Record's default allocation; native selection receives limits rather than defaults. */
export interface AssemblyPlan {
  version: 1;
  maximumFrames: number;
  ordinaryFrames: number;
}

export function assemblyPlan(durationMs: bigint): AssemblyPlan {
  if (durationMs < 0n || durationMs > 0xffff_ffff_ffff_ffffn) throw Error('Invalid capture duration');
  const extra = durationMs > 20_000n ? (durationMs - 20_000n) / 20_000n : 0n;
  return {version:1, maximumFrames:Number(extra < 6n ? 6n + extra : 12n), ordinaryFrames:6};
}
