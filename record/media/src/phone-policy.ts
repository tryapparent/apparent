import type {MovieFrame} from '@apparent/engine-sdk';

/** Preserve the legacy approximate candidate budget, including rounding overflow. */
export function phoneCandidatePlan(durationMs: number): {times: number[]; maxEdge: number} {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw Error('Invalid phone movie duration');
  const interval = Math.max(250, Math.floor(durationMs / 480));
  return {times:Array.from({length:Math.ceil(durationMs/interval)},(_,index)=>index*interval),maxEdge:320};
}

/** Candidate identity is the actual movie presentation time, unlike explicit keyframes. */
export function uniqueCandidates(frames: readonly MovieFrame[], previous?: number): MovieFrame[] {
  const selected: MovieFrame[] = [];
  for (const [index,frame] of Array.from(frames).entries()) {
    if (!frame || frame.requestIndex !== index || !Number.isSafeInteger(frame.actualMs) || frame.actualMs < 0 ||
        previous !== undefined && frame.actualMs < previous) throw Error('Invalid candidate presentation time');
    if (frame.actualMs !== previous) selected.push(frame);
    previous = frame.actualMs;
  }
  return selected;
}
