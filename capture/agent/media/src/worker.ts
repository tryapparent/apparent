import {decodeMovieFrames, EngineFrameError} from '@apparent/engine-sdk';
import {basename} from 'node:path';
import {movieTimes, bundleTimesForFrames} from './policy.ts';

// One finite, local request. Composition supplies packaged capabilities and a
// private output directory; this worker never discovers/builds/downloads them.
const abort = new AbortController();
process.once('SIGTERM', () => abort.abort());
try {
  const [executable, movie, outputDirectory, offset, edge, times, ...extra] = process.argv.slice(2);
  if (!executable || !movie || !outputDirectory || extra.length ||
      !/^\d{1,16}$/.test(offset ?? '') || !/^\d{1,5}$/.test(edge ?? '') ||
      !/^\d{1,16}(?:,\d{1,16}){0,47}$/.test(times ?? '')) throw Error('Invalid Agent frame request');
  const bundleTimes = times.split(',').map(Number), videoOffsetMs = Number(offset);
  const frames = await decodeMovieFrames({executable, movie, outputDirectory,
    timesMs: movieTimes(bundleTimes, videoOffsetMs), maxEdge: Number(edge), signal: abort.signal});
  const labels = bundleTimesForFrames(frames, bundleTimes, videoOffsetMs);
  process.stdout.write(JSON.stringify({version: 1, frames: frames.map((frame, index) => ({
    requestIndex: frame.requestIndex, requestedMs: labels[index], actualMovieMs: frame.actualMs,
    width: frame.width, height: frame.height, file: basename(frame.file),
  }))}) + '\n');
} catch (error) {
  // Preserve the Engine SDK's diagnostic/path redaction at the product boundary.
  process.stderr.write('Agent could not decode the requested movie frames\n');
  process.exitCode = error instanceof EngineFrameError && error.code === 'resource_limit' ? 72 : 1;
}
