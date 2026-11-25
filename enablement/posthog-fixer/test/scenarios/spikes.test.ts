import { test } from "node:test";
import assert from "node:assert/strict";
import { verifySpikePolicy } from "../../spikes/check.ts";
import { readSpikes } from "../../spikes/scan.ts";
import type { SpikePolicy } from "../../spikes/policy.ts";
import { Worker } from "../../worker.ts";
import { fixture, issue, second, projected } from "../fixtures.ts";

const hour = 3600000;
const now = Date.UTC(2026, 10, 25, 12);
const policy: SpikePolicy = {
  qualifies: (users, occurrences, baseline) =>
    users >= 5 && occurrences * 56 >= baseline,
  admits: (hot, elapsed) => !hot && elapsed >= 86400,
};
const spike = (observedAt = now) => ({
  issue,
  users: 6,
  occurrences: 6,
  baseline: 0,
  observedAt,
});

if (process.env.GITHUB_ACTIONS === "true") {
  test("the spike policy passes the Bend kernel checks", {
    timeout: 180000,
  }, async () => {
    await verifySpikePolicy({ provision: true });
  });
}

test("spike scan reads recent active users and the seven days before the window", async () => {
  const calls: { tool: string; args: object }[] = [];
  const result = await readSpikes(
    async (tool, args) => {
      calls.push({ tool, args });
      return tool.endsWith("-list")
        ? {
            results: [
              {
                id: issue,
                status: "active",
                first_seen: new Date(now - hour * 2).toISOString(),
                aggregations: { users: 6, occurrences: 6 },
              },
              {
                id: second,
                status: "active",
                first_seen: new Date(now - 1).toISOString(),
                aggregations: { users: 5, occurrences: 10 },
              },
            ],
            hasMore: false,
          }
        : { status: "active", impact: {}, trend: null };
    },
    now,
    policy,
  );
  assert.deepEqual(result, [spike()]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, {
    issueId: issue,
    filterTestAccounts: true,
    dateRange: {
      date_from: new Date(now - 169 * hour).toISOString(),
      date_to: new Date(now - hour).toISOString(),
    },
  });
});

test("a recurring spike launches alone and rearms only after cooldown and a fresh crossing", async (t) => {
  const f = fixture(t);
  f.c.batchSize = 3;
  const contexts: string[] = [];
  const launches: { threadId: string; initialMessage: { text: string } }[] = [];
  const worker = () =>
    new Worker(f.store, f.c, {
      context: async (id) => {
        contexts.push(id);
        return '{"status":"active"}';
      },
      call: async (tag, input) => {
        const payload = input as (typeof launches)[number];
        if (tag.endsWith("getThreadProjection"))
          return projected(payload.threadId, true, "completed");
        launches.push(payload);
        if (launches.length === 1) throw Error("lost acknowledgement");
        return {
          threadId: payload.threadId,
          projection: projected(payload.threadId),
        };
      },
    });
  f.store.enqueue(issue, 10);
  f.store.update(issue, "done");
  f.store.enqueue(second, 10);
  f.store.recordSpikes([spike()], 10, policy);
  await worker().tick(now);
  f.reopen();
  await worker().tick(now + 60000);
  assert.deepEqual(launches[0], launches[1]);
  assert.match(launches[0].initialMessage.text, /6 occurrences across 6 users/);
  assert.deepEqual(contexts, [issue]);
  await worker().tick(now + 120000);
  assert.deepEqual(
    f.store.jobs().map((job) => job.state),
    ["done", "queued", "done"],
  );

  f.store.recordSpikes([], 10, policy);
  f.store.recordSpikes([spike(now + hour)], 10, policy);
  f.store.recordSpikes([spike(now + 25 * hour)], 10, policy);
  assert.equal(f.store.jobs().length, 3);
  f.store.recordSpikes([], 10, policy);
  f.reopen();
  f.store.recordSpikes([spike(now + 26 * hour)], 10, policy);
  assert.notEqual(f.store.jobs()[3].thread, launches[0].threadId);
});

test("a spike promotes an existing queue entry and leaves an active thread in charge", (t) => {
  const f = fixture(t);
  f.store.enqueue(issue, 10);
  f.store.enqueue(second, 10);
  f.store.update(second, "active");
  f.store.recordSpikes([spike(), { ...spike(), issue: second }], 2, policy);
  assert.equal(f.store.jobs().length, 2);
  assert.equal(f.store.nextLaunch(now, 10, 3)[0].issue, issue);
  f.store.update(second, "done");
  f.store.recordSpikes([{ ...spike(now + hour), issue: second }], 10, policy);
  assert.equal(f.store.jobs().length, 2);
});

test("a full queue records the crossing without launching it later", (t) => {
  const f = fixture(t);
  f.store.enqueue(second, 1);
  f.store.recordSpikes([spike()], 1, policy);
  f.store.update(second, "done");
  f.store.recordSpikes([spike(now + hour)], 1, policy);
  assert.equal(f.store.jobs().length, 1);
  f.store.recordSpikes([], 1, policy);
  f.store.recordSpikes([spike(now + 2 * hour)], 1, policy);
  assert.equal(
    f.store.nextLaunch(now + 2 * hour, 10, 3)[0].spike?.issue,
    issue,
  );
});
