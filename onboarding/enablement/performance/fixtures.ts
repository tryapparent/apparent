import assert from "node:assert/strict";
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const screenFrame = Buffer.from([59, 121, 189, 255, 255, 255, 255, 255]);

async function commit(file: string, contents: string | Buffer) {
  const handle = await open(file + ".next", "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(file + ".next", file);
  const parent = await open(dirname(file), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

export function practiceFixture(profile: string) {
  const recording = join(profile, "synthetic.apparent");
  const framePath = join(recording, "frame.rgba");
  const clipboard = join(profile, "handoff-clipboard.txt");
  const progress = join(profile, "onboarding-progress.json");
  const reference = "apparent inspect " + basename(recording);
  return {
    async publishFirstMedia() {
      await mkdir(recording);
      await commit(framePath, screenFrame);
    },
    async verifyFirstMedia() {
      assert.deepEqual(await readFile(framePath), screenFrame);
    },
    async stopAndOfferClipboard() {
      await commit(
        join(recording, "saved.json"),
        JSON.stringify({ frame: basename(framePath) }),
      );
      await commit(clipboard, reference);
    },
    async verifyHandoff() {
      assert.deepEqual(
        JSON.parse(await readFile(join(recording, "saved.json"), "utf8")),
        {
          frame: "frame.rgba",
        },
      );
      assert.equal(await readFile(clipboard, "utf8"), reference);
    },
    async persistCompletion() {
      await commit(
        progress,
        JSON.stringify({
          onboarding: { firstCaptureCompleted: true, seen: true },
        }),
      );
    },
    async verifyCompletion() {
      assert.deepEqual(JSON.parse(await readFile(progress, "utf8")), {
        onboarding: { firstCaptureCompleted: true, seen: true },
      });
    },
    async outputBytes() {
      const files = await Promise.all(
        [framePath, join(recording, "saved.json"), clipboard, progress].map(
          (file) => stat(file),
        ),
      );
      return files.reduce((sum, file) => sum + file.size, 0);
    },
  };
}
