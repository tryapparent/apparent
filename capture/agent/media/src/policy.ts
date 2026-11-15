/** Agent requests use bundle time; the published Engine capability uses movie
 * time. Keep request identity when several early requests clamp to movie zero. */
export function movieTimes(bundleTimes: readonly number[], videoOffsetMs: number): number[] {
  const time = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (!Array.isArray(bundleTimes) || !bundleTimes.length || bundleTimes.length > 48 ||
      !time(videoOffsetMs) || !bundleTimes.every(time)) throw Error('Invalid Agent frame request');
  return bundleTimes.map(value => Math.max(0, value - videoOffsetMs));
}

export function bundleTimesForFrames(
  frames: readonly {requestIndex: number; requestedMs: number}[],
  requestedBundleTimes: readonly number[], videoOffsetMs: number,
): number[] {
  const requestedMovieTimes = movieTimes(requestedBundleTimes, videoOffsetMs);
  if (!Array.isArray(frames) || frames.length !== requestedMovieTimes.length ||
      frames.some((frame, index) => !frame || frame.requestIndex !== index || frame.requestedMs !== requestedMovieTimes[index]))
    throw Error('Engine frame identities do not match the Agent request');
  return frames.map(frame => requestedBundleTimes[frame.requestIndex]);
}
