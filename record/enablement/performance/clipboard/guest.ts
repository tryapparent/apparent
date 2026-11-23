import { execFile, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { now } from "../fixture-clock.ts";

const exec = promisify(execFile);

export function seedClipboard(value: string) {
  execFileSync("wl-copy", ["--type", "text/plain"], {
    input: value,
    timeout: 5000,
    stdio: ["pipe", "ignore", "ignore"],
  });
}

export function clipboardObserver(
  captures: string,
  put: (name: string, value: string) => Promise<void>,
  signal: AbortSignal,
) {
  return async (name: string, sentinel: string, stop: number) => {
    for (const end = stop + 120000; (await now()) < end; ) {
      signal.throwIfAborted();
      const text = await exec("wl-paste", ["--no-newline", "--type", "text"], {
        encoding: "utf8",
        timeout: 700,
        maxBuffer: 4 * 1024 * 1024,
      }).then(
        ({ stdout }) => stdout.trimEnd(),
        () => "",
      );
      if (
        text !== sentinel &&
        text.includes("apparent inspect ") &&
        text.includes(captures + "/")
      ) {
        await put(name + "-clipboard.txt", text);
        const at = await now();
        await put(name + "-clipboard-at.txt", String(at));
        return { at, text };
      }
      await delay(40, undefined, { signal });
    }
    throw Error("Verified clipboard did not arrive");
  };
}
