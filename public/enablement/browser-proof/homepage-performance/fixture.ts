import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import type { CDPSession } from "playwright-core";

export const scenario = {
  id: "public-homepage-copy-prompt-v1",
  viewport: { width: 1280, height: 860 },
  colorScheme: "light",
  expectedPrompt:
    "Install and launch Apparent using https://github.com/tryapparent/apparent. If you’re Hermes, install and enable both the Agent and Desktop plugin halves, help the user to rescan/reload Desktop plugins.",
} as const;

const githubFixture = "https://api.github.com/repos/tryapparent/apparent";
const terminalFontFixture =
  "https://fonts.bunny.net/css?family=jetbrains-mono:400,700&display=swap";
const youtubeFixture = "https://www.youtube-nocookie.com/embed/IXJVr0-PJ7k";

export async function externalEffects(cdp: CDPSession) {
  const effects = {
    githubStarCountFixture: 0,
    youtubeEmbedBlocked: 0,
    terminalFontStylesheetBlocked: 0,
    unexpected: [] as string[],
  };
  cdp.on("Fetch.requestPaused", async ({ request, requestId }) => {
    const url = new URL(request.url);
    if (request.url === githubFixture && request.method === "GET") {
      effects.githubStarCountFixture++;
      await cdp.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "access-control-allow-origin", value: "*" },
          { name: "content-type", value: "application/json" },
        ],
        body: Buffer.from(JSON.stringify({ stargazers_count: 123 })).toString(
          "base64",
        ),
      });
    } else {
      if (url.origin + url.pathname === youtubeFixture)
        effects.youtubeEmbedBlocked++;
      else if (request.url === terminalFontFixture)
        effects.terminalFontStylesheetBlocked++;
      else effects.unexpected.push(url.origin + url.pathname);
      await cdp.send("Fetch.failRequest", {
        requestId,
        errorReason: "BlockedByClient",
      });
    }
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });
  return effects;
}

const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".txt": "text/plain",
};

export async function servePackage(directory: string) {
  const assets = new Map<
    string,
    { bytes: Buffer; gzip?: Buffer; etag: string; type: string }
  >();
  const manifest = createHash("sha256");
  let packageBytes = 0;
  for (const path of (
    await readdir(directory, { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length))
    .sort()) {
    const bytes = await readFile(join(directory, path));
    const etag = '"' + createHash("sha256").update(bytes).digest("hex") + '"';
    manifest.update(path + "\0" + etag + "\n");
    packageBytes += bytes.length;
    const type = mime[extname(path)] ?? "application/octet-stream";
    const gzip = /^(text\/|image\/svg)/.test(type)
      ? gzipSync(bytes)
      : undefined;
    assets.set(path, { bytes, gzip, etag, type });
  }
  if (!assets.has("/index.html"))
    throw new Error("Expected the packaged production homepage");

  const server = createServer((request, response) => {
    const path = new URL(request.url!, "http://127.0.0.1").pathname;
    const asset = assets.get(path.endsWith("/") ? path + "index.html" : path);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("ETag", asset.etag);
    response.setHeader("Content-Type", asset.type);
    response.setHeader("Vary", "Accept-Encoding");
    if (request.headers["if-none-match"] === asset.etag) {
      response.writeHead(304).end();
      return;
    }
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range && asset.type === "video/mp4") {
      const start = Number(range[1]);
      const end = Math.min(
        range[2] ? Number(range[2]) : asset.bytes.length - 1,
        asset.bytes.length - 1,
      );
      response.setHeader("Accept-Ranges", "bytes");
      if (start > end) {
        response
          .writeHead(416, { "Content-Range": "bytes */" + asset.bytes.length })
          .end();
        return;
      }
      response
        .writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${asset.bytes.length}`,
          "Content-Length": end - start + 1,
        })
        .end(asset.bytes.subarray(start, end + 1));
      return;
    }
    const encoded =
      asset.gzip && request.headers["accept-encoding"]?.includes("gzip");
    const body = encoded ? asset.gzip! : asset.bytes;
    if (encoded) response.setHeader("Content-Encoding", "gzip");
    response.writeHead(200, { "Content-Length": body.length }).end(body);
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject).listen(0, "127.0.0.1", done);
  });
  return {
    origin: "http://127.0.0.1:" + (server.address() as AddressInfo).port,
    packageBytes,
    packageSha256: manifest.digest("hex"),
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
