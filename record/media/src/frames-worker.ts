import {decodeMovieFrames} from '@apparent/engine-sdk';
import {basename} from 'node:path';
import {movieTimes, bundleTimes} from './frames-policy.ts';

// Composition supplies finite resources. Record owns bundle/movie clock policy.
const abort = new AbortController();
process.once('SIGTERM', () => abort.abort());
try {
  const [executable, movie, outputDirectory, offset, edge, times, ...extra] = process.argv.slice(2);
  if (!executable || !movie || !outputDirectory || extra.length ||
      !/^\d{1,16}$/.test(offset ?? '') || !/^\d{1,5}$/.test(edge ?? '') ||
      !/^\d{1,16}(?:,\d{1,16}){0,47}$/.test(times ?? '')) throw Error('Invalid Record frame request');
  const requested = times.split(',').map(Number), videoOffsetMs = Number(offset);
  const frames = await decodeMovieFrames({executable, movie, outputDirectory,
    timesMs: movieTimes(requested, videoOffsetMs), maxEdge: Number(edge), signal: abort.signal});
  const labels = bundleTimes(frames, requested, videoOffsetMs);
  process.stdout.write(JSON.stringify({version: 1, frames: frames.map((frame, index) => ({
    requestIndex: frame.requestIndex, requestedMs: labels[index], actualMovieMs: frame.actualMs,
    width: frame.width, height: frame.height, file: basename(frame.file),
  }))}) + '\n');
} catch {
  process.stderr.write('Record could not decode the requested keyframes\n');
  process.exitCode = 1;
}
