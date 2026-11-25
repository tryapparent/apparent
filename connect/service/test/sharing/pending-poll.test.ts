import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const origin = "https://share.example";
const manifestPath = "/s/fixture/manifest.json";
const {
  outputFiles: [script],
} = await build({
  stdin: {
    contents:
      'import { pollReady } from "./src/recipient/poll.ts"; pollReady(document)',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "browser",
  write: false,
});

function polling(manifest: string, initial: () => Promise<Response>) {
  let now = 0;
  let reloads = 0;
  let response = initial;
  const requests: { url: string; options: RequestInit }[] = [];
  const status = { textContent: "" };
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    querySelector: () => ({
      dataset: { manifest },
      querySelector: () => status,
    }),
  });
  const window = new EventTarget();
  const timers = new Map<number, { callback: () => void; due: number }>();
  let nextId = 0;
  vm.runInNewContext(script.text, {
    document,
    window,
    URL,
    AbortSignal,
    Date: { now: () => now },
    performance: { now: () => now },
    location: { href: origin + "/s/fixture", origin, reload: () => reloads++ },
    fetch: (url: string, options: RequestInit) => {
      requests.push({ url, options });
      return response();
    },
    setTimeout: (callback: () => void, wait: number) => {
      timers.set(++nextId, { callback, due: now + wait });
      return nextId;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  return {
    requests,
    status,
    timers,
    reloads: () => reloads,
    respond: (fetch: typeof response) => {
      response = fetch;
    },
    focus: () => window.dispatchEvent(new Event("focus")),
    visible: (value: boolean) => {
      document.visibilityState = value ? "visible" : "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    },
    async advance(to?: number) {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0];
      now = to ?? timer.due;
      timers.delete(id);
      timer.callback();
      await setImmediate();
    },
  };
}

const pending = async () => Response.json({ status: "pending" });

test("checks immediately on the same origin and respects the attempt limit", async () => {
  assert.equal(
    polling("https://other.example/manifest.json", pending).requests.length,
    0,
  );
  const page = polling(manifestPath, pending);
  assert.equal(page.requests.length, 1);
  const [{ url, options }] = page.requests;
  assert.equal(url, origin + manifestPath);
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.equal(options.referrerPolicy, "no-referrer");
  await setImmediate();
  for (let i = 1; i < 24; i++) await page.advance();
  page.focus();
  assert.equal(page.requests.length, 24);
  assert.equal(page.reloads(), 0);
  assert.equal(page.timers.size, 0);
  assert.match(page.status.textContent, /Reload/);
});

test("foreground events share a check and terminal results reload once", async () => {
  const { promise, resolve } = Promise.withResolvers<Response>();
  const page = polling(manifestPath, () => promise);
  page.focus();
  page.visible(true);
  assert.equal(page.requests.length, 1);
  resolve(await pending());
  await setImmediate();
  page.visible(false);
  page.focus();
  assert.equal(page.requests.length, 1);
  page.respond(async () => new Response(null, { status: 410 }));
  page.visible(true);
  page.focus();
  await page.advance();
  assert.equal(page.requests.length, 2);
  assert.equal(page.reloads(), 1);
  assert.equal(page.timers.size, 0);
});

test("network failure and delayed timers stop at the wall-clock deadline", async () => {
  const page = polling(manifestPath, async () => {
    throw new Error("synthetic outage");
  });
  await setImmediate();
  await page.advance(120_001);
  page.focus();
  assert.equal(page.requests.length, 1);
  assert.equal(page.reloads(), 0);
  assert.equal(page.timers.size, 0);
  assert.match(page.status.textContent, /Reload/);
});
