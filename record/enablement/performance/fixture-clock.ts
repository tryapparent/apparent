import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export const now = async () =>
  Math.round(
    Number((await readFile("/proc/uptime", "utf8")).split(" ")[0]) * 1000,
  );

export async function startFixture(
  log: () => Promise<string>,
  commands: (args: string[], timeout: number) => Promise<string>,
  id: string,
  seconds: number,
  warmup: boolean,
  signal: AbortSignal,
) {
  const cursor = (await log()).length;
  const controller = new AbortController();
  const observation = AbortSignal.any([
    signal,
    controller.signal,
    AbortSignal.timeout(85000),
  ]);
  const start = await now();
  async function observeOrigin() {
    for (;;) {
      observation.throwIfAborted();
      const updates = (await log()).slice(cursor);
      const frame =
        /^START_METRIC screen_first_frame_ms=(\d+(?:\.\d+)?)$/m.exec(updates);
      if (frame) return (await now()) - Number(frame[1]);
      await delay(50, undefined, { signal: observation });
    }
  }
  try {
    const [live, origin] = await Promise.all([
      commands(
        ["capture", "start", "--request-id", id, "--wait", "--timeout", "78"],
        85000,
      ).then(async (text) => {
        const entered = JSON.parse(text);
        assert(entered.capture_id === id && entered.status === "recording");
        return await now();
      }),
      warmup ? undefined : observeOrigin(),
    ]);
    const deadline = (origin ?? live) + seconds * 1000;
    return {
      live,
      start,
      async prepareStop() {
        await delay(
          Math.max(0, deadline - (warmup ? 0 : 2000) - (await now())),
          undefined,
          { signal },
        );
      },
      async waitUntilDue() {
        await delay(Math.max(0, deadline - (await now())), undefined, {
          signal,
        });
      },
      async recordRequest(path: string, name: string, requested: number) {
        await appendFile(
          path,
          [name, origin, deadline, requested].join("\t") + "\n",
        );
      },
    };
  } finally {
    controller.abort();
  }
}
