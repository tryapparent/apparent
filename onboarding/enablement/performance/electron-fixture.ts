import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import * as observer from "../../../shared/enablement/performance/electron-observer.ts";

export const whiteboardEntry = "dist/whiteboard/main.cjs";

export async function sha256(file: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

export async function buildIdentity(
  runtime: string,
  assets: string,
  entry: string,
) {
  const sourceHash = async (paths: string[]) => {
    const hashes = await Promise.all(
      paths.map((name) =>
        sha256(fileURLToPath(new URL(name, new URL("../", import.meta.url)))),
      ),
    );
    return createHash("sha256").update(hashes.join("\n")).digest("hex");
  };
  return {
    runtimeSha256: await sha256(runtime),
    entrySha256: await sha256(entry),
    collectorSha256: await sourceHash([
      "./click-through.ts",
      "./performance/benchmark.ts",
      "./performance/click-trace.ts",
      "./performance/electron-fixture.ts",
      "./performance/whiteboard.ts",
      ...(process.env.APPARENT_ONBOARDING_HOSTED_SCOPE
        ? [
            "./performance/hosted.ts",
            "./performance/hosted-contention.ts",
            "./performance/hosted/placement.ts",
            "./performance/hosted/injection.ts",
          ]
        : []),
      "../../shared/enablement/performance/electron-observer.ts",
      "../../shared/enablement/performance/measurement.ts",
    ]),
    fixtureSha256: await sourceHash(["./performance/fixtures.ts"]),
    onboardingPreloadSha256: await sha256(
      join(assets, "electron/onboarding-preload.cjs"),
    ),
    whiteboardViewSha256: await sha256(join(assets, "dist/whiteboard/view.js")),
    rendererPageSha256: await sha256(join(assets, "dist/onboarding.html")),
    whiteboardEntrySha256: await sha256(join(assets, whiteboardEntry)),
    whiteboardRendererPageSha256: await sha256(
      join(assets, "dist/whiteboard/index.html"),
    ),
    platform: process.platform,
    node: process.version,
  };
}

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
  const hosted = process.env.APPARENT_ONBOARDING_HOSTED_SCOPE !== undefined;
  const readReady = async <T>(observe: () => Promise<T>) => {
    try {
      return await observe();
    } catch (error) {
      if (
        hosted &&
        error instanceof Error &&
        error.message === "Local CDP timed out on Runtime.evaluate" &&
        !page.closed()
      )
        return undefined;
      throw error;
    }
  };
  await observer
    .waitFor(async () => {
      const ready = await readReady(() =>
        page.evaluate<boolean>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const rect = el?.getBoundingClientRect();
        return document.visibilityState === "visible" && !!rect?.width && !!rect.height &&
          getComputedStyle(el).visibility === "visible" && !el.disabled && !el.closest('[inert]') &&
          rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
      })()`),
      );
      return ready || undefined;
    }, selector)
    .catch((cause) => {
      throw Error("Could not read actionable layout for " + selector, {
        cause,
      });
    });
  const layout = performance.now();
  const paint = async () =>
    await readReady(async () => {
      await page.painted();
      return true;
    });
  await (hosted ? observer.waitFor(paint, selector + " paint") : paint()).catch(
    (cause) => {
      throw Error("Could not observe renderer paint for " + selector, {
        cause,
      });
    },
  );
  return layout;
}
