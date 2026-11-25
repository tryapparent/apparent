import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyEvidence } from "../hosted.ts";

test("the hosted artifact retains receipts and waterfalls and excludes scratch media", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "apparent-dev-connect-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, "samples");
  const output = join(root, "evidence");
  await mkdir(join(input, "baseline-a", "recipient-b"), { recursive: true });
  await mkdir(join(input, "baseline-a", "sample-c"));
  await mkdir(
    join(input, "baseline-a", "recipient-b", "cold-native", "sender"),
    { recursive: true },
  );
  await mkdir(output);

  for (const name of [
    "baseline-a/watch-score.json",
    "baseline-a/recipient-b/watch-replay.json",
    "baseline-a/recipient-b/cold.json",
    "baseline-a/recipient-b/warm.json",
    "baseline-a/recipient-b/fixture.mp4",
    "baseline-a/recipient-b/frame.png",
    "baseline-a/recipient-b/cold-native/native-sender.json",
    "baseline-a/recipient-b/cold-native/sender/upload.credential",
    "baseline-a/sample-c/resources.txt",
    "baseline-a/sample-c/replay-unit.json",
    "baseline-a/sample-c/replay-unit.log",
    "unrelated.log",
  ]) {
    await writeFile(join(input, name), "synthetic fixture");
  }
  await symlink("unrelated.log", join(input, "watch-score.json"));
  await copyEvidence(input, output);

  assert.deepEqual((await readdir(output, { recursive: true })).sort(), [
    "baseline-a",
    "baseline-a/recipient-b",
    "baseline-a/recipient-b/cold-native",
    "baseline-a/recipient-b/cold-native/native-sender.json",
    "baseline-a/recipient-b/cold.json",
    "baseline-a/recipient-b/warm.json",
    "baseline-a/recipient-b/watch-replay.json",
    "baseline-a/sample-c",
    "baseline-a/sample-c/replay-unit.json",
    "baseline-a/sample-c/replay-unit.log",
    "baseline-a/sample-c/resources.txt",
    "baseline-a/watch-score.json",
  ]);
});
