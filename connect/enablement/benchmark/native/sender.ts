import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { observe } from "../watch-trace.ts";

type Span = {
  operation: string;
  path?: string;
  captureId: string;
  startMs: number;
  workerStartMs: number | null;
  workerEndMs: number | null;
  endMs: number | null;
  status: number | null;
  state?: string;
};

export const nativeWorkload = "default-public-copy-native-sender-v2";

export function nativeSender(build: { binary: string; hash: string }) {
  let requests: Span[] | undefined;
  const observeRequest = (method: string, url: string) => {
    if (!requests) return;
    const parts = /^\/v1\/captures\/([a-f0-9]{32})(?:\/(.*))?$/.exec(url);
    if (!parts) return;
    const action = parts[2] ?? "";
    const path = action.startsWith("files/") ? action.slice(6) : undefined;
    const span: Span = {
      operation: path ? method : action || method,
      path,
      captureId: parts[1],
      startMs: performance.now(),
      workerStartMs: null,
      workerEndMs: null,
      endMs: null,
      status: null,
    };
    requests.push(span);
    return {
      dispatch: () => {
        span.workerStartMs = performance.now();
      },
      finish: (status: number) => {
        span.endMs = performance.now();
        span.status = status;
      },
      workerReply: (reply: Buffer, status: number) => {
        span.workerEndMs = performance.now();
        if (
          status === 200 &&
          ["POST", "share", "complete", "GET"].includes(span.operation)
        ) {
          const payload = JSON.parse(reply.toString());
          if (typeof payload.status === "string") span.state = payload.status;
        }
      },
    };
  };

  async function share(
    origin: string,
    token: string,
    assets: Map<string, Buffer>,
    directory: string,
    observer: ReturnType<typeof observe>,
  ) {
    const root = join(directory, "sender");
    const config = join(root, "config.json");
    const bundle = join(root, "synthetic.apparent");
    try {
      await mkdir(join(root, "hosted"), { recursive: true, mode: 0o700 });
      await writeFile(
        config,
        JSON.stringify({
          cloud: { enabled: true, uploadConsent: true, server: origin },
          experiments: { hostedEncryption: true },
        }),
        { flag: "wx", mode: 0o600 },
      );
      await writeFile(
        join(root, "hosted/upload.credential"),
        JSON.stringify({
          server: origin,
          scope: "upload",
          token,
          generation: "a".repeat(32),
        }),
        { flag: "wx", mode: 0o600 },
      );
      for (const [path, bytes] of assets) {
        const dest = join(bundle, path);
        await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
        await writeFile(dest, bytes, { flag: "wx", mode: 0o600 });
      }

      const started = performance.now();
      requests = [];
      const child = spawn(
        build.binary,
        [
          "--ignored",
          "--exact",
          "--nocapture",
          "--quiet",
          "test_support::settings_tests::benchmark_public_copy_sender",
        ],
        {
          stdio: ["pipe", "pipe", "ignore"],
          timeout: 30_000,
          env: {
            ...process.env,
            APPARENT_BENCH_SENDER: root,
            NO_PROXY: "127.0.0.1",
            no_proxy: "127.0.0.1",
          },
        },
      );
      const ended = once(child, "close");
      ended.catch(() => {});
      child.stdin.on("error", () => {});
      const lines = createInterface({ input: child.stdout });
      try {
        const url = await observer.measure(
          "native-prepare-and-issue",
          "share",
          async () => {
            for await (const line of lines) {
              if (!line.includes("BENCH_LINK ")) continue;
              const url = line.match(
                /http:\/\/127\.0\.0\.1:\d+\/s\/[a-f0-9]{64}/,
              )?.[0];
              assert.ok(
                url && new URL(url).origin === origin,
                "Invalid prepared capability",
              );
              return url;
            }
            throw Error("Native sender did not prepare a link");
          },
        );
        const linkAvailable = performance.now();
        const reserved = requests.find((span) => span.operation === "POST");
        assert.equal(reserved?.status, 200);
        assert.equal(reserved.state, "pending");
        const issued = requests.find((span) => span.operation === "share");
        assert.equal(issued?.status, 200);
        assert.equal(issued.state, "pending");
        assert.ok(requests.every((span) => span.operation !== "PUT"));
        await observer.measure(
          "native-queue-to-verified",
          "share",
          async () => {
            child.stdin.end("upload\n");
            assert.equal((await ended)[0], 0, "Native sender did not finish");
          },
        );

        const puts = requests.filter((span) => span.operation === "PUT");
        assert.deepEqual(
          puts.map(({ path }) => path).sort(),
          [...assets.keys()].sort(),
        );
        const complete = requests.find(
          ({ operation }) => operation === "complete",
        );
        assert.ok(
          complete?.endMs &&
            complete.status === 200 &&
            complete.state === "ready",
        );
        const verified = requests.find(({ operation }) => operation === "GET");
        assert.ok(
          verified?.endMs &&
            verified.status === 200 &&
            verified.state === "ready" &&
            verified.startMs >= complete.endMs,
        );
        assert.ok(
          puts.every(
            ({ endMs, status }) =>
              endMs && status === 200 && endMs <= complete.startMs,
          ),
        );
        const peakPuts = Math.max(
          ...puts.map(
            ({ startMs }) =>
              puts.filter(
                (put) => put.startMs <= startMs && put.endMs! > startMs,
              ).length,
          ),
        );
        const transferMs =
          Math.max(...puts.map(({ endMs }) => endMs!)) -
          Math.min(...puts.map(({ startMs }) => startMs));
        const workerPeakPuts = Math.max(
          ...puts.map(
            ({ workerStartMs }) =>
              puts.filter(
                (put) =>
                  put.workerStartMs! <= workerStartMs! &&
                  put.workerEndMs! > workerStartMs!,
              ).length,
          ),
        );
        return {
          started,
          url,
          linkAvailable,
          proof: {
            binarySha256: build.hash,
            peakPuts,
            workerPeakPuts,
            transferMs,
            requests,
          },
        };
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        await ended.catch(() => {});
        lines.close();
        const spans = requests;
        requests = undefined;
        await writeFile(
          join(directory, "native-sender.json"),
          JSON.stringify(
            { binarySha256: build.hash, requests: spans, exit: child.exitCode },
            null,
            2,
          ) + "\n",
          { mode: 0o600 },
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  return { share, observeRequest };
}
