import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "../../worker.ts";
import type { launchPayload } from "../../worker.ts";
import {
  fixture,
  issue,
  second,
  third,
  fourth,
  projected,
} from "../fixtures.ts";

test("three distinct issues share one durable launch, replay and settlement", async (t) => {
  const f = fixture(t);
  f.c.batchSize = 3;
  const contexts: string[] = [];
  const launches: ReturnType<typeof launchPayload>[] = [];
  const reconciled: string[] = [];
  const worker = () =>
    new Worker(f.store, f.c, {
      context: async (id) => {
        contexts.push(id);
        return `context for ${id}`;
      },
      call: async (tag, payload) => {
        const p = payload as ReturnType<typeof launchPayload>;
        if (tag === "orchestration.getThreadProjection") {
          reconciled.push(p.threadId);
          return projected(p.threadId, true, "completed");
        }
        launches.push(p);
        if (launches.length === 1) throw Error("response lost after commit");
        return { threadId: p.threadId, projection: projected(p.threadId) };
      },
    });
  const now = Date.UTC(2026, 10, 15, 12);
  f.store.enqueue(issue, 4);
  f.store.enqueue(second, 4);
  assert.equal(f.store.enqueue(second, 4), "duplicate");
  await worker().tick(now);
  assert.deepEqual(contexts, []);
  assert.deepEqual(launches, []);
  f.reopen();
  f.store.enqueue(third, 4);
  f.store.enqueue(fourth, 4);
  await worker().tick(now);
  assert.deepEqual(contexts, [issue, second, third]);
  assert.equal(launches.length, 1);
  assert.match(
    launches[0].initialMessage.text,
    /link them all to this thread before merging any/,
  );
  for (const member of contexts) {
    assert.ok(
      launches[0].initialMessage.text.includes(`/error_tracking/${member}`),
    );
    assert.ok(
      launches[0].initialMessage.text.includes(`context for ${member}`),
    );
  }
  assert.deepEqual(
    f.store.jobs().map((job) => job.state),
    ["launching", "launching", "launching", "queued"],
  );
  assert.equal(f.store.dailyCount(now), 1);
  f.reopen();
  await worker().tick(now + 60000);
  assert.deepEqual(launches[0], launches[1]);
  assert.deepEqual(contexts, [issue, second, third]);
  assert.deepEqual(
    f.store.jobs().map((job) => job.state),
    ["active", "active", "active", "queued"],
  );
  await worker().tick(now + 65000);
  assert.deepEqual(reconciled, [launches[0].threadId]);
  assert.deepEqual(
    f.store.jobs().map((job) => job.state),
    ["done", "done", "done", "queued"],
  );
  assert.equal(f.store.enqueue(third, 4), "duplicate");
});
test("an issue in context backoff leaves the other ready issues eligible for a full batch", async (t) => {
  const f = fixture(t);
  f.c.batchSize = 3;
  const launches: ReturnType<typeof launchPayload>[] = [];
  const worker = new Worker(f.store, f.c, {
    context: async (id) => {
      if (id === issue) throw Error("no context");
      return "context";
    },
    call: async (_tag, payload) => {
      const p = payload as ReturnType<typeof launchPayload>;
      launches.push(p);
      return { threadId: p.threadId, projection: projected(p.threadId) };
    },
  });
  for (const id of [issue, second, third, fourth]) f.store.enqueue(id, 4);
  const now = Date.now();
  await worker.tick(now);
  assert.equal(launches.length, 0);
  assert.deepEqual(
    f.store.jobs().map((job) => job.attempts),
    [1, 0, 0, 0],
  );
  await worker.tick(now + 5000);
  assert.equal(launches.length, 1);
  assert.deepEqual(
    f.store.jobs().map((job) => job.state),
    ["queued", "active", "active", "active"],
  );
});
