import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";

const stage = resolve(import.meta.dirname, "../stage.ts");
const offline =
  'globalThis.fetch = () => { throw new Error("Unexpected runtime download"); };';

function job(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "apparent-dev-record-stage-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function stagePrivately(out: string, fetchFixture?: string) {
  const source = ["process.umask(0o077);", fetchFixture].join("\n");
  const setup = "data:text/javascript," + encodeURIComponent(source);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--import", setup, stage, "--out", out],
    { encoding: "utf8", timeout: 70_000 },
  );
  if (result.error) throw result.error;
  return result;
}

function assertStagedModes(out: string) {
  assert.equal(lstatSync(join(out, "package.json")).mode & 0o777, 0o600);
  const native = join(out, "native");
  const executables = [
    "apparent-engine-media",
    "apparent-engine-frames",
    "apparent-engine-audio",
  ];
  if (process.platform === "darwin")
    executables.push("apparent-engine-probe", "apparent-engine-frames-native");
  for (const executable of executables) {
    const stat = lstatSync(join(native, executable));
    assert(stat.isFile(), executable);
    assert.equal(stat.mode & 0o777, 0o755, executable);
  }
  assert.equal(lstatSync(join(native, "LICENSE")).mode & 0o777, 0o644);
}

test("stages a cold pinned runtime under umask 077 and reuses it offline", (t) => {
  const out = join(job(t), "out");
  const cold = stagePrivately(out);
  assert.equal(cold.status, 0, cold.stderr);
  assertStagedModes(out);

  const reused = stagePrivately(out, offline);
  assert.equal(reused.status, 0, reused.stderr);
  assertStagedModes(out);
});

test("rejects a corrupt runtime download before publishing output", (t) => {
  const out = join(job(t), "out");
  const corrupt = stagePrivately(
    out,
    'globalThis.fetch = async () => new Response("corrupt runtime");',
  );
  const pin = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../engine.json"), "utf8"),
  );
  assert.equal(corrupt.status, 1);
  assert(
    corrupt.stderr.includes(
      pin.runtimes[`${process.platform}-${process.arch}`].archiveSha256,
    ),
    corrupt.stderr,
  );
  assert(!existsSync(out));
});

test("refuses unowned and symlink destinations", (t) => {
  const root = job(t);
  const unowned = join(root, "unowned");
  mkdirSync(unowned);
  const marker = join(unowned, "record-media-staging.json");
  const foreignOwner = '{"owner":"someone-else"}';
  writeFileSync(marker, foreignOwner);
  const symlink = join(root, "symlink");
  symlinkSync(unowned, symlink);

  const rejectedOwner = stagePrivately(unowned, offline);
  assert.equal(rejectedOwner.status, 1);
  assert.match(
    rejectedOwner.stderr,
    /Refusing to replace an unowned staging directory/,
  );
  const rejectedLink = stagePrivately(symlink, offline);
  assert.equal(rejectedLink.status, 1);
  assert.match(rejectedLink.stderr, /Refusing an unsafe staging destination/);
  assert(lstatSync(symlink).isSymbolicLink());
  assert.equal(readFileSync(marker, "utf8"), foreignOwner);
});
