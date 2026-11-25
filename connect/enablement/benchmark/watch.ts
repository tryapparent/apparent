import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coverage, observe } from "./watch-trace.ts";
import type { nativeSender } from "./native/sender.ts";

type Request = { url(): string; resourceType(): string };
type Route = {
  request(): Request;
  continue(): Promise<void>;
  abort(): Promise<void>;
};
type BrowserContext = {
  newPage(): Promise<{
    route(
      pattern: string,
      handler: (route: Route) => Promise<void>,
    ): Promise<void>;
    on(
      event: "request" | "requestfinished" | "requestfailed",
      handler: (request: Request) => void,
    ): unknown;
    goto(
      url: string,
      options: { waitUntil: "domcontentloaded"; timeout: number },
    ): Promise<{ status(): number } | null>;
    locator(selector: string): {
      waitFor(options: { state: "visible"; timeout: number }): Promise<void>;
      evaluate<T>(handler: (video: HTMLVideoElement) => Promise<T>): Promise<T>;
    };
    close(): Promise<void>;
  }>;
};

type Assets = Map<string, Buffer>;
type Backend = Awaited<
  ReturnType<typeof import("../../service/test/helpers.mjs").fixture>
>;
type Manifest = { path: string; size: number; sha256: string };

export const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function verifyRevocation(
  backend: Backend,
  token: string,
  captureId: string,
  url: string,
) {
  const list = await backend.call("/v1/shares", { token });
  assert.ok(list.ok);
  const { shares } = await list.json();
  const row = shares.find(
    (share: { captureId: string }) => share.captureId === captureId,
  );
  assert.match(row.id, /^[a-f0-9]{32}$/);
  const revoked = await backend.call("/v1/shares/" + row.id, {
    method: "DELETE",
    token,
  });
  assert.ok(revoked.ok);
  for (const path of ["/manifest.json", "/files/recording.mp4"]) {
    const response = await fetch(url + path, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 410);
    await response.body?.cancel();
  }
}

export async function watchAttempt({
  backend,
  origin,
  token,
  captureId,
  assets,
  context,
  variant,
  trace,
  directory,
  sender,
}: {
  backend: Backend;
  origin: string;
  token: string;
  captureId: string;
  assets: Assets;
  context: BrowserContext;
  variant: "cold" | "warm";
  trace: boolean;
  directory: string;
  sender?: ReturnType<typeof nativeSender>;
}) {
  const attemptId = randomUUID();
  const observer = observe(trace);
  const duration = (start: number, end: number) => end - start;
  const base = "/v1/captures/" + captureId;
  const page = await context.newPage();
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  type Channel = "document" | "media" | "static";
  const requests = new Map<Request, { startMs: number; channel: Channel }>();
  const network: {
    channel: Channel;
    startMs: number;
    endMs: number;
    finished: boolean;
  }[] = [];
  if (trace) {
    const record = (request: Request, finished: boolean) => {
      const item = requests.get(request);
      if (item) network.push({ ...item, endMs: performance.now(), finished });
      requests.delete(request);
    };
    page.on("request", (request) => {
      const kind = request.resourceType();
      const channel =
        kind === "document"
          ? "document"
          : kind === "media"
            ? "media"
            : "static";
      requests.set(request, { startMs: performance.now(), channel });
    });
    page.on("requestfinished", (request) => record(request, true));
    page.on("requestfailed", (request) => record(request, false));
  }

  const call = async (
    path: string,
    method: string,
    data: { body?: unknown; raw?: Buffer } = {},
  ) => {
    const response = await backend.call(path, {
      token,
      method,
      headers: { "Sec-GPC": "1" },
      ...data,
    });
    assert.ok(
      response.ok,
      `Synthetic sender ${method} returned ${response.status}`,
    );
    return response.json();
  };
  const manifestFor = ([path, bytes]: [string, Buffer]): Manifest => ({
    path,
    size: bytes.length,
    sha256: digest(bytes),
  });
  const readRecipient = (url: string) =>
    fetch(url, { redirect: "error", signal: AbortSignal.timeout(10000) });

  try {
    const syntheticShare = async () => {
      const started = performance.now();
      const files = await observer.measure(
        "prepare-manifest",
        "share",
        async () => [...assets].map(manifestFor),
      );
      await observer.measure("reserve", "share", async () => {
        const reply = await call(base, "POST", { body: { files } });
        assert.equal(reply.id, captureId);
        assert.equal(reply.status, "pending");
      });
      const url = await observer.measure("issue-link", "share", async () => {
        const reply = await call(base + "/share", "POST");
        assert.equal(reply.status, "pending");
        assert.match(reply.url, /\/s\/[a-f0-9]{64}$/);
        assert.equal(new URL(reply.url).origin, origin);
        return reply.url as string;
      });
      const linkAvailable = performance.now();
      await observer.measure("transfer", "share", async () => {
        const bytes = [...assets.values()];
        for (const [index, file] of files.entries()) {
          await observer.measure("put-" + index, "transfer", () =>
            call(base + "/files/" + file.path, "PUT", { raw: bytes[index] }),
          );
        }
      });
      await observer.measure("publish", "share", async () => {
        assert.equal((await call(base + "/complete", "POST")).status, "ready");
      });
      return { started, url, linkAvailable, files, proof: undefined };
    };
    const sendNative = async (sender: NonNullable<typeof sender>) => {
      const files = [...assets].map(manifestFor);
      const sent = await sender.share(
        origin,
        token,
        assets,
        join(directory, variant + "-native"),
        observer,
      );
      return { ...sent, files };
    };
    const transfer = sender ? await sendNative(sender) : await syntheticShare();
    const { started, url, linkAvailable, files } = transfer;
    const paths = await observer.measure(
      "independent-manifest",
      "share",
      async () => {
        const response = await readRecipient(url + "/manifest.json");
        assert.ok(response.ok);
        const received = await response.json();
        assert.equal(received.status, "ready");
        const size = files.reduce((bytes, file) => bytes + file.size, 0);
        assert.equal(received.totalBytes, size);
        assert.equal(received.uploadedBytes, size);
        assert.equal(received.files.length, files.length);
        assert.deepEqual(
          new Map(
            received.files.map(({ path, size, sha256 }: Manifest) => [
              path,
              { size, sha256 },
            ]),
          ),
          new Map(
            files.map(({ path, size, sha256 }) => [path, { size, sha256 }]),
          ),
        );
        return received.files.map(
          ({ path, url: asset }: Manifest & { url: string }) => {
            assert.equal(asset, url + "/files/" + path);
            return { path, asset };
          },
        ) as { path: string; asset: string }[];
      },
    );
    const ready = performance.now();
    const opened = performance.now();
    await observer.measure(
      "document-to-dom-content-loaded",
      "play",
      async () => {
        assert.equal(
          (
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 10000,
            })
          )?.status(),
          200,
        );
      },
    );
    const video = page.locator("video");
    await observer.measure("visible-video", "play", () =>
      video.waitFor({ state: "visible", timeout: 10000 }),
    );
    const playback = await observer.measure(
      "play-to-advancing-frame-ack",
      "play",
      () =>
        video.evaluate(async (element: HTMLVideoElement) => {
          element.muted = true;
          const requestedMs = performance.now();
          const frame = new Promise<{
            first: {
              atMs: number;
              mediaSeconds: number;
              presentedFrames: number;
            };
            advancing: {
              atMs: number;
              mediaSeconds: number;
              presentedFrames: number;
            };
          }>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error("No advancing presented frame")),
              10000,
            );
            let first:
              | { atMs: number; mediaSeconds: number; presentedFrames: number }
              | undefined;
            const observe: VideoFrameRequestCallback = (atMs, data) => {
              const point = {
                atMs,
                mediaSeconds: data.mediaTime,
                presentedFrames: data.presentedFrames,
              };
              if (
                first &&
                point.mediaSeconds > first.mediaSeconds &&
                point.presentedFrames > first.presentedFrames
              ) {
                clearTimeout(timer);
                resolve({ first, advancing: point });
              } else {
                first ??= point;
                element.requestVideoFrameCallback(observe);
              }
            };
            element.requestVideoFrameCallback(observe);
          });
          await element.play();
          const playingMs = performance.now();
          const frames = await frame;
          return {
            requestedMs,
            playingMs,
            ...frames,
            width: element.videoWidth,
            height: element.videoHeight,
          };
        }),
    );
    const finished = performance.now();
    assert.equal(playback.width, 640);
    assert.equal(playback.height, 400);

    for (const { path, asset } of paths) {
      const response = await readRecipient(asset);
      assert.ok(response.ok);
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        assets.get(path),
        path,
      );
    }
    if (transfer.proof) {
      await verifyRevocation(
        backend,
        token,
        transfer.proof.requests[0].captureId,
        url,
      );
    }

    const spans = observer.spans;
    const duringPlay = network.flatMap(({ startMs, endMs, ...request }) =>
      startMs < finished && endMs > opened
        ? [
            {
              ...request,
              startMs: Math.max(opened, startMs),
              endMs: Math.min(finished, endMs),
            },
          ]
        : [],
    );
    const pendingAtEndpoint = [...requests.values()].filter(
      (request) => request.startMs < finished,
    );
    const unfinished = pendingAtEndpoint.map(({ startMs, channel }) => ({
      channel,
      startMs: Math.max(opened, startMs),
      endMs: finished,
      finished: false,
    }));
    const browserNetwork = [...duringPlay, ...unfinished];
    const result = {
      attemptId,
      variant,
      trace,
      markers: {
        shareActivatedMs: started,
        linkAvailableMs: linkAvailable,
        readyVerifiedMs: ready,
        linkOpenedMs: opened,
        advancingFrameAckMs: finished,
      },
      rawMs: {
        shareToLinkAvailable: duration(started, linkAvailable),
        shareToReady: duration(started, ready),
        openToAdvancingFrameAck: duration(opened, finished),
        shareToAdvancingFrameAck: duration(started, finished),
      },
      proof: {
        manifest: files,
        originalBytesVerified: true,
        playback,
        ...(transfer.proof
          ? { nativeSender: { ...transfer.proof, revocationVerified: true } }
          : {}),
      },
      clocks: { spans: "node-monotonic-ms", playback: "page-performance-ms" },
      spans: spans.sort((a, b) => a.startMs - b.startMs),
      browserNetwork,
      coverage: trace
        ? {
            share: coverage(
              started,
              ready,
              spans.filter((span) => span.parent === "share"),
            ),
            play: coverage(
              opened,
              finished,
              spans.filter((span) => span.parent === "play"),
            ),
            concurrentBrowserNetwork: coverage(
              opened,
              finished,
              browserNetwork.map((span) => ({
                ...span,
                name: span.channel,
                parent: "play",
              })),
            ),
            transitionMs: opened - ready,
          }
        : null,
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      join(directory, variant + ".json"),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    return result;
  } finally {
    await page.close();
  }
}
