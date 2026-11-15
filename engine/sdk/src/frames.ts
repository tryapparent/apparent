import {execFile} from 'node:child_process';
import {closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, realpathSync} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';

export interface MovieFrame {
  requestIndex: number;
  requestedMs: number;
  /** Native presentation sample time; requests outside the video clamp to its first/last sample. */
  actualMs: number;
  width: number;
  height: number;
  /** Owned private straight-alpha RGBA8 file, row-major, display transform applied. */
  file: string;
}
type Code = 'invalid_request' | 'unsafe_output' | 'unavailable' | 'cancelled' | 'timeout' |
  'decode_failed' | 'resource_limit' | 'invalid_response';
export class EngineFrameError extends Error {
  readonly code: Code;
  constructor(code: Code) { super('Engine frame decoding: ' + code); this.name = 'EngineFrameError'; this.code = code; }
}
const integer = (value: unknown, max: number, signed = false): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && (signed ? Math.abs(value) <= max : value >= 0 && value <= max);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).sort().join(',') === expected.sort().join(',');

/** Finite native execution only. Caller provisions a new, empty, owned 0700 output
 * directory and retains/removes it after consuming the files, including on error.
 * No directory discovery, source builds, downloads, config writes or bundle policy. */
export async function decodeMovieFrames(options: {
  executable: string; movie: string; outputDirectory: string; timesMs: readonly number[];
  maxEdge?: number; timeoutMs?: number; signal?: AbortSignal;
}): Promise<MovieFrame[]> {
  const {executable, movie, signal} = options;
  const edge = options.maxEdge ?? 0, timeout = options.timeoutMs ?? 300_000;
  if (![executable, movie, options.outputDirectory].every(p => typeof p === 'string' && isAbsolute(p) && !p.includes('\0')) ||
      !Array.isArray(options.timesMs) || options.timesMs.length < 1 || options.timesMs.length > 480 ||
      !Array.from(options.timesMs).every(t => integer(t, Number.MAX_SAFE_INTEGER)) ||
      !integer(edge, 16384) || !integer(timeout, 300_000) || timeout < 1 ||
      signal !== undefined && !(signal instanceof AbortSignal)) throw new EngineFrameError('invalid_request');
  if (signal?.aborted) throw new EngineFrameError('cancelled');
  const times = [...options.timesMs];
  let directory: string, identity: ReturnType<typeof lstatSync>;
  try {
    const requested = resolve(options.outputDirectory), stat = lstatSync(requested);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o700 || readdirSync(requested).length) throw Error();
    directory = realpathSync(requested);
    identity = lstatSync(directory);
  } catch { throw new EngineFrameError('unsafe_output'); }
  const stdout = await new Promise<string>((accept, reject) => {
    let cancelled = false;
    const child = execFile(executable, ['frames-v1', movie, directory, String(edge), times.join(',')], {
      timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8',
    }, (error, bytes) => {
      signal?.removeEventListener('abort', abort);
      if (cancelled) return reject(new EngineFrameError('cancelled'));
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return reject(new EngineFrameError(code === 'ENOENT' || code === 'EACCES' ||
          (error as {code?: unknown}).code === 69 || (error as {code?: unknown}).code === 127 ? 'unavailable' :
          code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'invalid_response' :
          error.killed ? 'timeout' : (error as {code?: unknown}).code === 72 ? 'resource_limit' : 'decode_failed'));
      }
      accept(bytes);
    });
    function abort() { cancelled = true; child.kill('SIGKILL'); }
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
  });
  try {
    const current = lstatSync(directory);
    if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino ||
        current.uid !== process.getuid?.() || (current.mode & 0o777) !== 0o700) throw Error();
    const reply: unknown = JSON.parse(stdout);
    if (!object(reply) || !keys(reply, ['version', 'frames']) || reply.version !== 1 ||
        !Array.isArray(reply.frames) || reply.frames.length !== times.length) throw Error();
    let pixels = 0;
    const frames = reply.frames.map((raw: unknown, index: number): MovieFrame => {
      if (!object(raw) || !keys(raw, ['requestIndex', 'requestedMs', 'actualMs', 'width', 'height', 'file']) ||
          raw.requestIndex !== index || raw.requestedMs !== times[index] ||
          !integer(raw.actualMs, Number.MAX_SAFE_INTEGER, true) ||
          !integer(raw.width, 16384) || raw.width < 1 || !integer(raw.height, 16384) || raw.height < 1 ||
          edge > 0 && Math.max(raw.width, raw.height) > edge) throw Error();
      const count = raw.width * raw.height;
      pixels += count;
      if (count > 64 * 1024 * 1024 || pixels > 256 * 1024 * 1024) throw Error();
      const name = 'frame-' + String(index).padStart(3, '0') + '.rgba';
      if (raw.file !== name) throw Error();
      const file = join(directory, name), before = lstatSync(file);
      const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.nlink !== 1 ||
            stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size !== count * 4) throw Error();
      } finally { closeSync(fd); }
      return {requestIndex: index, requestedMs: times[index], actualMs: raw.actualMs, width: raw.width, height: raw.height, file};
    });
    if (readdirSync(directory).sort().join(',') !== frames.map(f => f.file.slice(directory.length + 1)).sort().join(',')) throw Error();
    return frames;
  } catch { throw new EngineFrameError('invalid_response'); }
}
