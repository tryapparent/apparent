import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";

export const pushId = (file: string) =>
  (isAbsolute(file) &&
    basename(file).match(
      /^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.jsonl$/,
    )?.[1]) ||
  undefined;

export function privatePath(file: string, directory = false) {
  const info = lstatSync(file);
  return (
    (directory ? info.isDirectory() : info.isFile()) &&
    info.uid === process.getuid?.() &&
    !(info.mode & 0o077)
  );
}

type Phase = "launch" | "verification-start" | "verification-exit";

function record(file: string, phase: Phase, code?: number) {
  const at = Date.now();
  const id = pushId(file);
  if (!id) return false;
  try {
    if (!privatePath(dirname(file), true)) return false;
    const flags =
      constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK;
    const fd = openSync(
      file,
      flags | (phase === "launch" ? constants.O_CREAT | constants.O_EXCL : 0),
      0o600,
    );
    try {
      const info = fstatSync(fd);
      if (
        !info.isFile() ||
        info.uid !== process.getuid?.() ||
        info.mode & 0o077
      )
        return false;
      const line =
        JSON.stringify({
          schema: 1,
          id,
          phase,
          at,
          ...(code === undefined ? {} : { code }),
        }) + "\n";
      return writeSync(fd, line) === Buffer.byteLength(line);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

export const recordPushLaunch = (file: string) => record(file, "launch");

export function recordPushVerification() {
  const file = process.env.APPARENT_PUSH_TIMING;
  delete process.env.APPARENT_PUSH_TIMING;
  if (file && record(file, "verification-start"))
    process.once("exit", (code) => record(file, "verification-exit", code));
}
