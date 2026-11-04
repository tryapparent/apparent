import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs";
import { once } from "node:events";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { NativeIoError, openAt, renameAt, tryLock, unlock, unlinkAt } = require(
  "../dist/native.cjs",
) as typeof import("../dist/native.cjs");

function privateTemp(): string {
  const previous = process.umask(0o077);
  try {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "apparent-native-"));
    fs.chmodSync(directory, 0o700);
    return directory;
  } finally {
    process.umask(previous);
  }
}

function assertNativeError(error: unknown, code: string): boolean {
  assert.ok(error instanceof NativeIoError);
  assert.equal(error.code, code);
  assert.equal(error.message, "Native I/O operation failed");
  return true;
}

test("openAt pins its directory, rejects symlinks, and supports relative rename/unlink", () => {
  const root = privateTemp();
  const original = path.join(root, "directory");
  const moved = path.join(root, "renamed-directory");
  fs.mkdirSync(original, { mode: 0o700 });
  const directoryFd = fs.openSync(
    original,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY,
  );
  let fileFd: number | undefined;
  try {
    fileFd = openAt(
      directoryFd,
      "first",
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR,
    );
    assert.equal(fs.statSync(path.join(original, "first")).mode & 0o777, 0o600);
    fs.closeSync(fileFd);
    fileFd = undefined;

    const outside = path.join(root, "outside");
    fs.writeFileSync(outside, "fixture", { mode: 0o600 });
    fs.symlinkSync(outside, path.join(original, "link"));
    assert.throws(
      () => openAt(directoryFd, "link", fsConstants.O_RDONLY),
      (error) => assertNativeError(error, "ELOOP"),
    );

    for (const invalid of ["", ".", "..", "a/b", "a\0b"]) {
      assert.throws(
        () => openAt(directoryFd, invalid, fsConstants.O_RDONLY),
        (error) => assertNativeError(error, "EINVAL"),
      );
    }

    fs.renameSync(original, moved);
    renameAt(directoryFd, "first", "second");
    assert.equal(fs.existsSync(path.join(moved, "second")), true);
    fileFd = openAt(directoryFd, "third", fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR);
    fs.closeSync(fileFd);
    fileFd = undefined;
    unlinkAt(directoryFd, "second");
    unlinkAt(directoryFd, "third");
    assert.equal(fs.existsSync(path.join(moved, "second")), false);
    assert.throws(
      () => unlinkAt(directoryFd, "missing"),
      (error) => assertNativeError(error, "ENOENT"),
    );
  } finally {
    if (fileFd !== undefined) fs.closeSync(fileFd);
    fs.closeSync(directoryFd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("byte filenames survive openAt, renameAt, and unlinkAt", () => {
  const root = privateTemp();
  const original = path.join(root, "directory");
  const moved = path.join(root, "renamed-directory");
  const source = Buffer.from([0x66, 0x80]);
  const destination = Buffer.from([0x72, 0x80]);
  fs.mkdirSync(original, { mode: 0o700 });
  const directoryFd = fs.openSync(
    original,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY,
  );
  let fileFd: number | undefined;
  try {
    fileFd = openAt(
      directoryFd,
      source,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR,
    );
    fs.closeSync(fileFd);
    fileFd = undefined;
    fs.renameSync(original, moved);
    renameAt(directoryFd, source, destination);
    const movedDestination = Buffer.concat([
      Buffer.from(`${moved}${path.sep}`),
      destination,
    ]);
    assert.equal(fs.existsSync(movedDestination), true);
    unlinkAt(directoryFd, destination);
    assert.equal(fs.existsSync(movedDestination), false);
  } finally {
    if (fileFd !== undefined) fs.closeSync(fileFd);
    fs.closeSync(directoryFd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("tryLock is nonblocking and unlock releases the descriptor", () => {
  const root = privateTemp();
  const directoryFd = fs.openSync(root, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  let first: number | undefined;
  let second: number | undefined;
  try {
    first = openAt(directoryFd, "lock", fsConstants.O_CREAT | fsConstants.O_RDWR);
    second = openAt(directoryFd, "lock", fsConstants.O_RDWR);
    assert.equal(tryLock(first), true);
    assert.equal(tryLock(second), false);
    unlock(first);
    assert.equal(tryLock(second), true);
    unlock(second);
  } finally {
    if (first !== undefined) fs.closeSync(first);
    if (second !== undefined) fs.closeSync(second);
    fs.closeSync(directoryFd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(
  "Linux flock agrees with an external holder and releases to the next contender",
  { skip: process.platform !== "linux" || !fs.existsSync("/usr/bin/flock") },
  async () => {
    const root = privateTemp();
    const directoryFd = fs.openSync(root, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
    const lockPath = path.join(root, "lock");
    const readyPath = path.join(root, "holder-ready");
    let fd: number | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let childExit: Promise<unknown> | undefined;
    try {
      fd = openAt(directoryFd, "lock", fsConstants.O_CREAT | fsConstants.O_RDWR);
      assert.equal(tryLock(fd), true);
      const contender = spawnSync("/usr/bin/flock", ["-n", lockPath, "/usr/bin/true"]);
      assert.equal(contender.error, undefined);
      assert.notEqual(contender.status, 0);
      unlock(fd);

      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      child = spawn(
        "/usr/bin/flock",
        [
          "-x",
          lockPath,
          "/bin/sh",
          "-c",
          `: > ${quote(readyPath)}; exec /usr/bin/sleep 0.3`,
        ],
        { stdio: "ignore" },
      );
      childExit = once(child, "exit");
      const deadline = Date.now() + 3000;
      while (!fs.existsSync(readyPath) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(fs.existsSync(readyPath), true);
      assert.equal(tryLock(fd), false);
      await childExit;
      child = undefined;
      assert.equal(tryLock(fd), true);
      unlock(fd);
    } finally {
      if (child && child.exitCode === null) {
        child.kill("SIGTERM");
        await childExit?.catch(() => undefined);
      }
      if (fd !== undefined) fs.closeSync(fd);
      fs.closeSync(directoryFd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test("missing direct Koffi platform artifact fails closed", () => {
  const root = privateTemp();
  try {
    const isolatedModule = path.join(root, "native.cjs");
    fs.copyFileSync(require.resolve("../dist/native.cjs"), isolatedModule);
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        "try { require(process.argv[1]); process.exitCode = 4; } catch (error) { process.stdout.write(error.code || error.message); }",
        isolatedModule,
      ],
      { encoding: "utf8", env: { ...process.env, NODE_PATH: "" } },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /MODULE_NOT_FOUND|Cannot find module/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

