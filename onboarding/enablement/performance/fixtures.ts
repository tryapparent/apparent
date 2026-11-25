import assert from "node:assert/strict";
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { launchElectron } from "./electron-fixture.ts";

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

export function practiceChannel(
  { send, reply }: ReturnType<typeof launchElectron>,
  run: string,
) {
  const scope = {
    version: 1,
    source: "1",
    transport: "2",
    attempt: "1",
    capture: "1",
    board: "fixture-board-" + run,
  };
  let sequence = 0;
  const batch = async (events: object[]) => {
    const id = String(++sequence);
    const intent = events.some((event) => "action" in event) ? id : null;
    send({ type: "practice-batch", ...scope, sequence: id, intent, events });
    const disposition = await reply(
      (row) => row.type === "practice-disposition" && row.sequence === id,
    );
    for (const [key, value] of Object.entries(scope))
      assert.equal(disposition[key], value, key);
    assert.equal(disposition.intent, intent);
    return disposition;
  };
  return { scope, batch };
}
