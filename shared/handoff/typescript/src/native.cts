import { constants as fsConstants } from "node:fs";

const supported =
  (process.platform === "linux" || process.platform === "darwin") &&
  (process.arch === "x64" || process.arch === "arm64");

if (!supported) {
  throw new Error("Native I/O is unsupported on this platform");
}

const binding = require(
  `@koromix/koffi-${process.platform}-${process.arch}`,
) as typeof import("koffi");

if (binding.version !== "3.3.4") {
  throw new Error("Native I/O dependency version mismatch");
}

const library = binding.load(
  process.platform === "linux" ? "libc.so.6" : "/usr/lib/libSystem.B.dylib",
);
const openat = library.func(
  "int openat(int directoryFd, const char *name, int flags, ...)",
);
const renameat = library.func(
  "int renameat(int oldDirectoryFd, const char *source, int newDirectoryFd, const char *destination)",
);
const unlinkat = library.func(
  "int unlinkat(int directoryFd, const char *name, int flags)",
);
const fcntl = library.func("int fcntl(int fd, int command, ...)");
const flock = library.func("int flock(int fd, int operation)");
const close = library.func("int close(int fd)");

const errnoValues = binding.os.errno;
const errnoCode = new Map<number, string>();
for (const [name, value] of Object.entries(errnoValues)) {
  if (!errnoCode.has(value)) errnoCode.set(value, name);
}

function errnoNumber(name: string): number {
  const value = errnoValues[name];
  if (value === undefined) throw new Error("Native I/O dependency is incomplete");
  return value;
}

function systemError(errno: number): NativeIoError {
  return new NativeIoError(errno, errnoCode.get(errno) ?? "UNKNOWN");
}

function failedCall(): NativeIoError {
  const errno = binding.errno();
  return systemError(errno);
}

type NameArgument = string | Buffer;

function checkedName(name: NameArgument): string | Buffer {
  const bytes = Buffer.isBuffer(name) ? name : Buffer.from(name, "utf8");
  if (
    bytes.length === 0 ||
    (bytes.length === 1 && bytes[0] === 0x2e) ||
    (bytes.length === 2 && bytes[0] === 0x2e && bytes[1] === 0x2e) ||
    bytes.includes(0x2f) ||
    bytes.includes(0)
  ) {
    throw systemError(errnoNumber("EINVAL"));
  }
  return Buffer.isBuffer(name) ? Buffer.concat([Buffer.from(name), Buffer.from([0])]) : name;
}

function checkedFd(fd: number): void {
  if (!Number.isInteger(fd) || fd < 0 || fd > 0x7fffffff) {
    throw systemError(errnoNumber("EBADF"));
  }
}

export class NativeIoError extends Error {
  readonly errno: number;
  readonly code: string;

  constructor(errno: number, code: string) {
    super("Native I/O operation failed");
    this.name = "NativeIoError";
    this.errno = errno;
    this.code = code;
  }
}

export function openAt(
  directoryFd: number,
  name: NameArgument,
  flags: number,
  mode = 0o600,
): number {
  checkedFd(directoryFd);
  checkedName(name);
  if (!Number.isInteger(flags) || flags < 0 || flags > 0x7fffffff) {
    throw systemError(errnoNumber("EINVAL"));
  }
  if (!Number.isInteger(mode) || mode < 0 || mode > 0xffffffff) {
    throw systemError(errnoNumber("EINVAL"));
  }
  if (typeof fsConstants.O_NOFOLLOW !== "number") {
    throw new Error("Native I/O no-follow support is unavailable");
  }
  const nativeName = checkedName(name);

  let fd: number;
  while (true) {
    fd = openat(
      directoryFd,
      nativeName,
      flags | fsConstants.O_NOFOLLOW,
      "uint32_t",
      mode >>> 0,
    );
    if (fd >= 0) break;
    const error = failedCall();
    if (error.errno !== errnoNumber("EINTR")) throw error;
  }

  while (true) {
    if (fcntl(fd, 2, "int", 1) === 0) return fd;
    const error = failedCall();
    if (error.errno === errnoNumber("EINTR")) continue;
    close(fd);
    throw error;
  }
}

export function renameAt(
  directoryFd: number,
  source: NameArgument,
  destination: NameArgument,
): void {
  checkedFd(directoryFd);
  const nativeSource = checkedName(source);
  const nativeDestination = checkedName(destination);
  while (true) {
    if (renameat(directoryFd, nativeSource, directoryFd, nativeDestination) === 0) return;
    const error = failedCall();
    if (error.errno !== errnoNumber("EINTR")) throw error;
  }
}

export function unlinkAt(directoryFd: number, name: NameArgument): void {
  checkedFd(directoryFd);
  const nativeName = checkedName(name);
  while (true) {
    if (unlinkat(directoryFd, nativeName, 0) === 0) return;
    const error = failedCall();
    if (error.errno !== errnoNumber("EINTR")) throw error;
  }
}

export function tryLock(fd: number): boolean {
  checkedFd(fd);
  while (true) {
    if (flock(fd, 2 | 4) === 0) return true;
    const error = failedCall();
    if (error.errno === errnoNumber("EINTR")) continue;
    if (
      error.errno === errnoNumber("EWOULDBLOCK") ||
      error.errno === errnoNumber("EAGAIN")
    ) {
      return false;
    }
    throw error;
  }
}

export function unlock(fd: number): void {
  checkedFd(fd);
  while (true) {
    if (flock(fd, 8) === 0) return;
    const error = failedCall();
    if (error.errno !== errnoNumber("EINTR")) throw error;
  }
}
