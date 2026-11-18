import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { targets, validateArtifacts, sdkDigest } from "./artifacts.ts";

const candidate = "a".repeat(40);
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function fixture(t: TestContext) {
  const cwd = mkdtempSync("/tmp/apparent-dev-engine-artifacts-");
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const directory = join(cwd, "artifacts");
  mkdirSync(directory);
  function checksum(file: string) {
    writeFileSync(
      join(directory, file + ".sha256"),
      `${hash(readFileSync(join(directory, file)))}  ${file}\n`,
    );
  }
  function native(target: string, overrides = {}, missing = "") {
    const name = `engine-media-${target}`,
      runtime = join(cwd, name);
    mkdirSync(runtime, { recursive: true });
    const [platform, arch] = target.split("-");
    const files = [
      "apparent-engine-media",
      "apparent-engine-frames",
      "apparent-engine-audio",
      "LICENSE",
    ];
    if (platform === "darwin")
      files.push("apparent-engine-probe", "apparent-engine-frames-native");
    for (const file of files)
      if (file !== missing)
        writeFileSync(
          join(runtime, file),
          `synthetic archive contract fixture ${file}`,
        );
    const manifest = {
      schema: 1,
      sourceCommit: candidate,
      sourceDirty: false,
      platform,
      arch,
      sdkVersion: "0.4.0",
      capabilities: ["movie-probe/1", "movie-frames/1", "movie-audio/1"],
      files: files.map((path) => ({
        path,
        mode: path === "LICENSE" ? 0o644 : 0o755,
        sha256: hash(`synthetic archive contract fixture ${path}`),
      })),
      ...overrides,
    };
    writeFileSync(join(runtime, "manifest.json"), JSON.stringify(manifest));
    execFileSync("tar", [
      "-czf",
      join(directory, name + ".tar.gz"),
      "-C",
      cwd,
      name,
    ]);
    checksum(name + ".tar.gz");
  }
  writeFileSync(
    join(directory, "apparent-engine-sdk-0.4.0.tgz"),
    "synthetic SDK contract fixture",
  );
  sdkDigest(directory);
  return { cwd, directory, native, checksum };
}

test("publication rejects SDK-only and Linux-only inventory; requires all four real archive payloads", (t) => {
  const f = fixture(t);
  assert.throws(() => validateArtifacts(f.directory, candidate), /inventory/);
  for (const target of targets.slice(0, 2)) f.native(target);
  assert.throws(() => validateArtifacts(f.directory, candidate), /inventory/);
  for (const target of targets.slice(2)) f.native(target);
  validateArtifacts(f.directory, candidate);
  writeFileSync(
    join(f.directory, "engine-media-linux-x64.tar.gz"),
    "corruption",
  );
  assert.throws(() => validateArtifacts(f.directory, candidate), /digest/);
});

test("complete inventory still rejects wrong identity, architecture, dirty source and missing native bytes", (t) => {
  const f = fixture(t);
  for (const target of targets) f.native(target);
  for (const override of [
    { sourceCommit: "b".repeat(40) },
    { sourceDirty: true },
    { arch: "arm64" },
    { sdkVersion: "0.2.0" },
    { files: [] },
    { capabilities: ["movie-probe/1", "movie-frames/1"] },
  ]) {
    f.native("linux-x64", override);
    assert.throws(
      () => validateArtifacts(f.directory, candidate),
      /manifest|runtime/,
    );
  }
  rmSync(join(f.cwd, "engine-media-linux-x64"), { recursive: true });
  f.native("linux-x64", {}, "apparent-engine-audio");
  assert.throws(() => validateArtifacts(f.directory, candidate));
});
