import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import * as observer from "../../../shared/enablement/performance/electron-observer.ts";

export type FixtureSurface = "onboarding" | "whiteboard";
export type ChannelMessage = Record<string, unknown>;

export function launchElectron(options: {
  runtime: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  profile: string;
  surface: FixtureSurface;
  log: string[];
}) {
  const { runtime, args, env, profile, surface, log } = options;
  const resourceReport = join(profile, surface + ".resources");
  const child = spawn(
    "/usr/bin/time",
    [
      "-o",
      resourceReport,
      "-f",
      "%U %S %M",
      "--",
      runtime,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      ...args,
    ],
    { env, stdio: ["pipe", "pipe", "pipe"], detached: true },
  );
  const exited = once(child, "close");
  exited.catch(() => {});
  let port = "";
  createInterface({ input: child.stderr }).on("line", (line) => {
    log.push(line);
    port ||=
      /^DevTools listening on ws:\/\/127\.0\.0\.1:(\d{1,5})\/devtools\/browser\/[a-f0-9-]+$/.exec(
        line,
      )?.[1] ?? "";
  });
  const replies: ChannelMessage[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      replies.push(JSON.parse(line));
    } catch {
      log.push(line);
    }
  });
  child.stdin.on("error", (error) => log.push(error.message));

  return {
    send(message: object) {
      child.stdin.write(JSON.stringify(message) + "\n");
    },
    reply(predicate: (message: ChannelMessage) => boolean) {
      return observer.waitFor(async () => {
        assert.equal(child.exitCode, null, surface + " exited before replying");
        const index = replies.findIndex(predicate);
        if (index >= 0) return replies.splice(index, 1)[0];
      }, surface + " parent-channel reply");
    },
    async connect(urlSuffix: string, onTarget: () => void) {
      const endpoint = await observer.waitFor(
        async () => {
          assert.equal(child.exitCode, null, surface + " exited during launch");
          if (!port) return;
          const targets = await fetch(
            "http://127.0.0.1:" + port + "/json/list",
            {
              signal: AbortSignal.timeout(400),
            },
          )
            .then(
              (response) =>
                response.json() as Promise<
                  {
                    url: string;
                    webSocketDebuggerUrl: string;
                  }[]
                >,
            )
            .catch(() => []);
          return targets.find(({ url }) => url.endsWith(urlSuffix))
            ?.webSocketDebuggerUrl;
        },
        surface + " renderer target",
        20000,
      );
      onTarget();
      return observer.connectToEndpoint(endpoint, surface);
    },
    async finish() {
      child.stdin.end();
      const timer = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
      }, 3000);
      try {
        const [code, signal] = await exited;
        assert.equal(code, 0, surface + " exit " + signal);
        const [userSeconds, systemSeconds, peakProcessRssKiB] = (
          await readFile(resourceReport, "utf8")
        )
          .trim()
          .split(/\s+/)
          .map(Number);
        assert(
          [userSeconds, systemSeconds, peakProcessRssKiB].every(
            Number.isFinite,
          ),
        );
        return { userSeconds, systemSeconds, peakProcessRssKiB };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type Surface = Awaited<ReturnType<typeof observer.connectToEndpoint>>;
export async function visible(page: Surface, selector: string) {
  await observer.waitFor(async () => {
    const ready = await page.evaluate<boolean>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const rect = el?.getBoundingClientRect();
        return document.visibilityState === "visible" && !!rect?.width && !!rect.height &&
          getComputedStyle(el).visibility === "visible" && !el.disabled && !el.closest('[inert]') &&
          rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
      })()`);
    return ready || undefined;
  }, selector);
  const layout = performance.now();
  await page.painted();
  return layout;
}
