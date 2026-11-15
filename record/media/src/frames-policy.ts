/** Record's explicit keyframes use bundle time; Engine reads the movie clock.
 * Index identity matters when several early keyframes share movie zero. */
export function movieTimes(times: readonly number[], offset: number): number[] {
  const safe = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (!Array.isArray(times) || times.length < 1 || times.length > 48 ||
      !safe(offset) || !Array.from(times).every(safe)) throw Error('Invalid Record keyframe times');
  return times.map(time => Math.max(0, time - offset));
}

export function bundleTimes(
  frames: readonly {requestIndex: number; requestedMs: number}[],
  times: readonly number[], offset: number,
): number[] {
  const requested = movieTimes(times, offset);
  if (!Array.isArray(frames) || frames.length !== requested.length ||
      Array.from(frames).some((frame, index) => !frame || frame.requestIndex !== index || frame.requestedMs !== requested[index]))
    throw Error('Engine keyframe identities do not match Record');
  return frames.map(frame => times[frame.requestIndex]);
}
