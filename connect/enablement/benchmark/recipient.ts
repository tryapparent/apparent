import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type MeasuredWait,
  measuredWait,
} from "../../../shared/enablement/performance/measurement.ts";
import { watchAttempt } from "./watch.ts";

const service = new URL("../../service/", import.meta.url);
const requireService = createRequire(new URL("package.json", service));
const { chromium } = requireService("playwright-core");
const { fixture, id, digest } = await import("../../service/test/helpers.mjs");
const [work, chrome, mode, ...extra] = process.argv.slice(2);
if (
  !work ||
  !isAbsolute(work) ||
  !chrome ||
  !isAbsolute(chrome) ||
  (mode && mode !== "watch-traced" && mode !== "watch-untraced") ||
  extra.length
) {
  throw Error(
    "Usage: recipient.ts PRIVATE_RESULTS_DIR ABSOLUTE_CHROMIUM [watch-traced|watch-untraced]",
  );
}
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
const job = await mkdtemp(join(work, "recipient-"));
const movie = join(job, "fixture.mp4");
const still = join(job, "frame.png");
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=640x400:d=4:r=15",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  movie,
]);
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-ss",
  "1",
  "-i",
  movie,
  "-frames:v",
  "1",
  still,
]);

let backend: Awaited<ReturnType<typeof fixture>> | undefined;
const gateway = createServer(async (request, response) => {
  try {
    if (!backend) throw Error("Synthetic recipient backend has not started");
    const result = await backend.call(request.url, {
      method: request.method,
      headers: request.headers,
    });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.writeHead(500).end("Synthetic recipient gateway failed");
  }
});
await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
try {
  const address = gateway.address();
  if (!address || typeof address === "string")
    throw Error("Missing loopback recipient address");
  const origin = "http://127.0.0.1:" + address.port;
  backend = await fixture({ SHARING_ENABLED: "true", API_ORIGIN: origin });
  const migration = await readFile(
    new URL(".generated/migrations/0003.sql", service),
    "utf8",
  );
  await backend.db.exec(migration.replaceAll("\n", " "));
  const user = await backend.identity("synthetic-benchmark-recipient");
  const capture = "/v1/captures/" + id(171313);
  const assets = new Map([
    ["recording.mp4", await readFile(movie)],
    ["frames/frame-01.png", await readFile(still)],
    ["summary.md", Buffer.from("Synthetic recipient benchmark")],
    [
      "apparent.json",
      Buffer.from(
        JSON.stringify({
          createdAtMs: 1794880800000,
          transcript: {
            segments: [{ t0: 0, t1: 3000, text: "Synthetic recipient timing" }],
          },
        }),
      ),
    ],
  ]);
  if (mode) {
    const browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      const attempts = [];
      for (const [index, variant] of (["cold", "warm"] as const).entries()) {
        attempts.push(
          await watchAttempt({
            backend,
            origin,
            token: user.token,
            captureId: id(171313 + index),
            assets,
            context,
            variant,
            trace: mode === "watch-traced",
            directory: job,
          }),
        );
      }
      const receipt = join(job, "watch-replay.json");
      await writeFile(
        receipt,
        JSON.stringify(
          { revision, chromium: browser.version(), attempts },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      console.log(receipt);
    } finally {
      await browser.close();
    }
  } else await legacy(backend, user, capture, origin, assets);
} finally {
  gateway.close();
  await backend?.close();
}

async function legacy(
  backend: Awaited<ReturnType<typeof fixture>>,
  user: { token: string },
  capture: string,
  origin: string,
  assets: Map<string, Buffer>,
) {
  const manifest = [...assets].map(([path, bytes]) => ({
    path,
    size: bytes.length,
    sha256: digest(bytes),
  }));
  assert.equal(
    (
      await backend.call(capture, {
        token: user.token,
        method: "POST",
        body: { files: manifest },
      })
    ).status,
    200,
  );
  const started = performance.now();
  const share = await backend.call(capture + "/share", {
    token: user.token,
    method: "POST",
  });
  assert.ok(share.ok);
  const { url } = await share.json();
  assert.equal(new URL(url).origin, origin);
  for (const [path, bytes] of assets) {
    assert.equal(
      (
        await backend.call(capture + "/files/" + path, {
          token: user.token,
          method: "PUT",
          raw: bytes,
        })
      ).status,
      200,
    );
  }
  assert.equal(
    (
      await backend.call(capture + "/complete", {
        token: user.token,
        method: "POST",
      })
    ).status,
    200,
  );
  const received = await fetch(url + "/manifest.json", {
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(received.ok);
  const proof = await received.text();
  assert.ok(proof.includes("apparent.json") && proof.includes("recording.mp4"));
  const ready = measuredWait(started, performance.now());

  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
  });
  let play: MeasuredWait;
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.route(
      "**/*",
      (route: {
        request(): { url(): string };
        continue(): Promise<void>;
        abort(): Promise<void>;
      }) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
    );
    const opened = performance.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
    const video = page.locator("video");
    await video.waitFor({ state: "visible", timeout: 10000 });
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("No advancing presented video frame")),
          10000,
        );
        let previous = -1;
        const observe: VideoFrameRequestCallback = (_, data) => {
          if (previous >= 0 && data.mediaTime > previous) {
            clearTimeout(timer);
            resolve();
          } else {
            previous = data.mediaTime;
            element.requestVideoFrameCallback(observe);
          }
        };
        element.requestVideoFrameCallback(observe);
      });
    });
    play = measuredWait(opened, performance.now());
  } finally {
    await browser.close();
  }
  const receipt = join(job, "connect-recipient-waits.json");
  await writeFile(
    receipt,
    JSON.stringify(
      {
        version: "apparent worker · " + revision,
        waits: {
          "remote-ready": ready,
          play,
        },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(receipt);
}
