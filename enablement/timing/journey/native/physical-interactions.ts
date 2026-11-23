import { setTimeout as delay } from "node:timers/promises";

type Input = {
  ready(deadline: number): Promise<void>;
  command(command: string, args: object, deadline: number): Promise<unknown>;
  close(): void;
};

export type Gesture = "note" | "paste-last" | "record";

export async function physicalInteraction(
  qmp: Input,
  gesture: Gesture,
  signal: AbortSignal,
) {
  const key = async (pressed: boolean, keys: string[]) => {
    const events = keys.map((code) => ({
      type: "key",
      data: { down: pressed, key: { type: "qcode", data: code } },
    }));
    await qmp.command("input-send-event", { events }, performance.now() + 1000);
  };
  const wait = (ms: number) => delay(ms, undefined, { signal });
  await qmp.ready(performance.now() + 2000);
  let started = 0;
  try {
    if (gesture === "note") {
      try {
        await key(true, ["shift"]);
        await wait(75);
        await key(false, ["shift"]);
        await wait(110);
        await key(true, ["shift"]);
        await wait(75);
        started = performance.now();
      } finally {
        await key(false, ["shift"]);
      }
    } else {
      const code = gesture === "record" ? "s" : "v";
      try {
        await key(true, ["alt", "shift"]);
        await wait(25);
        started = performance.now();
        await key(true, [code]);
        await wait(32);
      } finally {
        await key(false, [code, "shift", "alt"]);
      }
    }
  } finally {
    qmp.close();
  }
  return started;
}
