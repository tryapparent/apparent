import { execFile } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const MAX_MOVIE_AUDIO_SAMPLES = 2 ** 31;

export interface MovieAudio {
  sampleRate: 16000;
  channels: 1;
  sampleFormat: "s16le";
  sampleCount: number;

  file: string;
}
type Code =
  | "invalid_request"
  | "unsafe_output"
  | "unavailable"
  | "cancelled"
  | "timeout"
  | "decode_failed"
  | "resource_limit"
  | "invalid_response";
export class EngineAudioError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Engine audio decoding: " + code);
    this.name = "EngineAudioError";
    this.code = code;
  }
}
const integer = (value: unknown, maximum: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= maximum;

export async function decodeMovieAudio(options: {
  executable: string;
  movie: string;
  outputDirectory: string;
  streamIndexes: readonly number[];
  maxSamples: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<MovieAudio> {
  const { executable, movie, signal, maxSamples } = options,
    timeout = options.timeoutMs ?? 300_000;
  if (
    ![executable, movie, options.outputDirectory].every(
      (path) =>
        typeof path === "string" && isAbsolute(path) && !path.includes("\0"),
    ) ||
    !Array.isArray(options.streamIndexes) ||
    options.streamIndexes.length < 1 ||
    options.streamIndexes.length > 1024 ||
    !Array.from(options.streamIndexes).every((index) =>
      integer(index, 0xffff_ffff),
    ) ||
    new Set(options.streamIndexes).size !== options.streamIndexes.length ||
    !integer(maxSamples, MAX_MOVIE_AUDIO_SAMPLES) ||
    maxSamples < 1 ||
    !integer(timeout, 300_000) ||
    timeout < 1 ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  )
    throw new EngineAudioError("invalid_request");
  if (signal?.aborted) throw new EngineAudioError("cancelled");
  const streams = [...options.streamIndexes];
  let directory: string, identity: ReturnType<typeof lstatSync>;
  try {
    const requested = resolve(options.outputDirectory),
      stat = lstatSync(requested);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700 ||
      readdirSync(requested).length
    )
      throw Error();
    directory = realpathSync(requested);
    identity = lstatSync(directory);
  } catch {
    throw new EngineAudioError("unsafe_output");
  }
  const stdout = await new Promise<string>((accept, reject) => {
    let cancelled = false;
    const child = execFile(
      executable,
      ["audio-v1", movie, directory, String(maxSamples), streams.join(",")],
      {
        timeout,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
        encoding: "utf8",
      },
      (error, bytes) => {
        signal?.removeEventListener("abort", abort);
        if (cancelled) return reject(new EngineAudioError("cancelled"));
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          return reject(
            new EngineAudioError(
              code === "ENOENT" ||
                code === "EACCES" ||
                (error as { code?: unknown }).code === 69 ||
                (error as { code?: unknown }).code === 127
                ? "unavailable"
                : error.signal === "SIGXFSZ" ||
                    (error as { code?: unknown }).code === 72
                  ? "resource_limit"
                  : code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                    ? "invalid_response"
                    : error.killed
                      ? "timeout"
                      : "decode_failed",
            ),
          );
        }
        accept(bytes);
      },
    );
    function abort() {
      cancelled = true;
      child.kill("SIGKILL");
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  try {
    const current = lstatSync(directory),
      file = join(directory, "audio.pcm");
    if (
      stdout !== "" ||
      !current.isDirectory() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      current.uid !== process.getuid?.() ||
      (current.mode & 0o777) !== 0o700 ||
      readdirSync(directory).join(",") !== "audio.pcm"
    )
      throw Error();
    const before = lstatSync(file),
      fd = openSync(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.dev !== before.dev ||
        stat.ino !== before.ino ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.size % 2 ||
        stat.size > maxSamples * 2
      )
        throw Error();
      return {
        sampleRate: 16000,
        channels: 1,
        sampleFormat: "s16le",
        sampleCount: stat.size / 2,
        file,
      };
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new EngineAudioError("invalid_response");
  }
}
