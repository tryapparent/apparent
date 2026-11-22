import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

type Arrival = { screenAt: number; microphoneAt: number };
type WatchProcess = ChildProcessByStdio<null, Readable, null>;

export function observeFirstMedia(
  log: string,
  remote: (command: string) => WatchProcess,
) {
  if (
    !/^\/home\/[a-z0-9_-]+\/scrawl-gui-output-[0-9a-f]+\/artifacts\/application\.log$/.test(
      log,
    )
  ) {
    throw Error("Invalid owned recorder log path");
  }
  const child = remote(
    "start=$(wc -c < " +
      log +
      ') || exit 1; printf "armed\\n"; exec timeout 12s tail -s .02 -c "+$((start+1))" -f ' +
      log,
  );
  let arm: () => void;
  let connectedError: (error: Error) => void;
  const connected = new Promise<void>((resolve, reject) => {
    arm = resolve;
    connectedError = reject;
  });
  let screenAt = 0;
  let microphoneAt = 0;
  const finished = new Promise<Arrival>((resolve, reject) => {
    let armed = false;
    let pending = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!armed) {
          if (line !== "armed") {
            const error = Error("First-media observer did not arm");
            connectedError(error);
            reject(error);
            return;
          }
          armed = true;
          arm();
          continue;
        }
        if (
          !screenAt &&
          /^START_METRIC screen_first_frame_ms=[0-9.]+$/.test(line)
        )
          screenAt = performance.now();
        if (
          !microphoneAt &&
          /^START_METRIC microphone_first_sample_ms=[0-9.]+$/.test(line)
        )
          microphoneAt = performance.now();
        if (screenAt && microphoneAt) {
          resolve({ screenAt, microphoneAt });
          return;
        }
      }
    });
    const fail = (error: Error) => {
      connectedError(error);
      reject(error);
    };
    child.once("error", fail);
    child.once("close", () =>
      fail(Error("Owned recording did not report both first media samples")),
    );
  });
  connected.catch(() => {});
  finished.catch(() => {});
  return { connected, finished, close: () => child.kill() };
}
