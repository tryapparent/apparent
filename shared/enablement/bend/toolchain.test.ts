import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { bendScratch } from "./build.ts";
import { prepareBend } from "./toolchain.ts";

test("prepareBend retries a 503 and stages the verified pinned Base", async (t) => {
  const fetchPinned = globalThis.fetch;
  const attempts: { url: string; signal: AbortSignal | null | undefined }[] =
    [];
  let pinnedBase: Buffer | undefined;
  const deadline = t.mock.method(AbortSignal, "timeout");
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      if (!url.endsWith("/base.bend")) return fetchPinned(url, options);
      attempts.push({ url, signal: options.signal });
      if (attempts.length === 1)
        return new Response("unavailable", { status: 503 });
      const response = await fetchPinned(url, options);
      pinnedBase = Buffer.from(await response.clone().arrayBuffer());
      return response;
    },
  );

  await bendScratch(async (scratch) => {
    await prepareBend(scratch, { runtime: "node" });
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].url, attempts[1].url);
    assert.ok(attempts[0].signal);
    assert.equal(attempts[0].signal, attempts[1].signal);
    assert.deepEqual(
      deadline.mock.calls.map((call) => call.arguments),
      [[30_000], [30_000], [30_000], [30_000], [30_000]],
    );
    assert.deepEqual(
      readFileSync(join(scratch, "bend2", "base.bend")),
      pinnedBase,
    );
  });
});

for (const { name, statuses, error } of [
  {
    name: "exhausts its retry on repeated 503s",
    statuses: [503, 503],
    error: /download failed for main\.ts: 503/,
  },
  {
    name: "rejects a 404 immediately",
    statuses: [404],
    error: /download failed for main\.ts: 404/,
  },
  {
    name: "rejects mismatched bytes after a 503",
    statuses: [503, 200],
    error: /integrity check failed for main\.ts/,
  },
]) {
  test(`prepareBend ${name} without staging any files`, async (t) => {
    const otherSources = Promise.withResolvers<Response>();
    let attempts = 0;
    t.mock.method(globalThis, "fetch", async (url: string) => {
      if (!url.endsWith("/main.ts")) return otherSources.promise;
      const status = statuses[attempts++];
      assert.ok(status, "unexpected extra download attempt");
      return new Response("unexpected bytes", { status });
    });
    try {
      await bendScratch(async (scratch) => {
        await assert.rejects(prepareBend(scratch, { runtime: "node" }), error);
        assert.equal(attempts, statuses.length);
        assert.deepEqual(readdirSync(join(scratch, "bend2")), []);
      });
    } finally {
      otherSources.resolve(new Response(null, { status: 404 }));
    }
  });
}
