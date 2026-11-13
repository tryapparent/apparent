import {execFile} from 'node:child_process';
import {isAbsolute} from 'node:path';

export interface TrackTiming {startMs: number | null; durationMs: number | null}
export interface MovieInfo {
  durationMs: number | null;
  video: (TrackTiming & {streamIndex: number; width: number; height: number; fps: number | null}) | null;
  audio: Array<TrackTiming & {streamIndex: number; segments: TrackTiming[] | null}>;
}

type ErrorCode = 'invalid_request' | 'unavailable' | 'cancelled' | 'timeout' | 'probe_failed' | 'invalid_response';
export class EngineProbeError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(`Engine movie inspection: ${code}`);
    this.code = code;
    this.name = 'EngineProbeError';
  }
}

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new EngineProbeError('invalid_response');
  return v as Record<string, unknown>;
};
function time(value: unknown, signed = false): number | null {
  if (value === undefined || value === 'N/A') return null;
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new EngineProbeError('invalid_response');
  const ms = Math.round(Number(value) * 1000);
  if (!Number.isSafeInteger(ms) || (!signed && ms < 0)) throw new EngineProbeError('invalid_response');
  return ms;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new EngineProbeError('invalid_response');
  return value;
}
function timing(value: Record<string, unknown>): TrackTiming {
  return {startMs: time(value.start_time, true), durationMs: time(value.duration)};
}
function rate(value: unknown): number | null {
  if (value === undefined || value === '0/0' || value === '0/1') return null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(value)) throw new EngineProbeError('invalid_response');
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den)) throw new EngineProbeError('invalid_response');
  if (num === 0) return null;
  const fps = num / den;
  if (!Number.isFinite(fps) || fps < 0) throw new EngineProbeError('invalid_response');
  return fps;
}

/** Normalize native affine facts once; dimensions are display bounds on both OSes. */
function dimensions(stream: Record<string, unknown>): {width: number; height: number} {
  const width = integer(stream.width), height = integer(stream.height);
  let matrix: unknown = stream.displayTransform;
  if (matrix === undefined && stream.side_data_list !== undefined) {
    if (!Array.isArray(stream.side_data_list)) throw new EngineProbeError('invalid_response');
    const displays = stream.side_data_list.map(object).filter(v => v.displaymatrix !== undefined);
    if (displays.length > 1) throw new EngineProbeError('invalid_response');
    if (displays.length) {
      const text = displays[0].displaymatrix;
      if (typeof text !== 'string') throw new EngineProbeError('invalid_response');
      const rows = text.trim().split('\n').map(line => {
        const match = /^\s*[0-9a-f]{8}:\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/i.exec(line);
        if (!match) throw new EngineProbeError('invalid_response');
        return match.slice(1).map(Number);
      });
      const flat = rows.flat();
      if (rows.length !== 3 || !flat.every(Number.isSafeInteger) || flat[2] !== 0 || flat[5] !== 0 || flat[8] !== 1073741824)
        throw new EngineProbeError('invalid_response');
      matrix = [flat[0], flat[1], flat[3], flat[4]].map(n => n / 65536);
    }
  }
  if (matrix === undefined) return {width, height};
  if (!Array.isArray(matrix) || matrix.length !== 4 || !matrix.every(v => typeof v === 'number' && Number.isFinite(v)))
    throw new EngineProbeError('invalid_response');
  const [a, b, c, d] = matrix as number[];
  return {width: integer(Math.round(Math.abs(a) * width + Math.abs(c) * height)),
    height: integer(Math.round(Math.abs(b) * width + Math.abs(d) * height))};
}

/** probe-v1 normalizes native metadata; it never chooses audio or export policy. */
export function parseMovieInfo(bytes: string): MovieInfo {
  try {
    const raw = object(JSON.parse(bytes));
    if (!Array.isArray(raw.streams) || raw.streams.length > 1024) throw new EngineProbeError('invalid_response');
    const result: MovieInfo = {durationMs: time(object(raw.format).duration), video: null, audio: []};
    const ids = new Set<number>();
    for (const entry of raw.streams) {
      const stream = object(entry);
      const streamIndex = integer(stream.index);
      if (ids.has(streamIndex)) throw new EngineProbeError('invalid_response');
      ids.add(streamIndex);
      if (stream.codec_type === 'video' && !result.video) {
        result.video = {...timing(stream), streamIndex, ...dimensions(stream), fps: rate(stream.avg_frame_rate)};
      } else if (stream.codec_type === 'audio') {
        let segments: TrackTiming[] | null = null;
        if (stream.segments !== undefined) {
          if (!Array.isArray(stream.segments) || stream.segments.length > 4096) throw new EngineProbeError('invalid_response');
          segments = stream.segments.map(v => timing(object(v)));
        }
        result.audio.push({...timing(stream), streamIndex, segments});
      }
    }
    return result;
  } catch { throw new EngineProbeError('invalid_response'); }
}

/** Uses an explicitly provisioned executable. No discovery, downloads or builds. */
export async function probeMovie(options: {
  executable: string; movie: string; timeoutMs?: number; signal?: AbortSignal;
}): Promise<MovieInfo> {
  const {executable, movie, signal} = options;
  const timeout = options.timeoutMs ?? 30_000;
  if (![executable, movie].every(p => typeof p === 'string' && isAbsolute(p) && !p.includes('\0')) ||
      !Number.isInteger(timeout) || timeout < 1 || timeout > 60_000) throw new EngineProbeError('invalid_request');
  if (signal?.aborted) throw new EngineProbeError('cancelled');
  return new Promise((resolve, reject) => {
    let cancelled = false;
    const child = execFile(executable, ['probe-v1', movie], {
      timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8',
    }, (error, stdout) => {
      signal?.removeEventListener('abort', abort);
      if (cancelled) return reject(new EngineProbeError('cancelled'));
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return reject(new EngineProbeError(code === 'ENOENT' ? 'unavailable' :
          code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'invalid_response' : error.killed ? 'timeout' : 'probe_failed'));
      }
      try { resolve(parseMovieInfo(stdout)); } catch (error) { reject(error); }
    });
    function abort() { cancelled = true; child.kill('SIGKILL'); }
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
  });
}
