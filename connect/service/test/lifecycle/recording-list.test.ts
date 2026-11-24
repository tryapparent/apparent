import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { file, fixture, id } from "../helpers.mjs";

test("Connect lists only current recordings for the bearer account in recording order", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const owner = await f.identity("recording-list-owner");
  const other = await f.identity("recording-list-other");
  const now = Date.now();
  const recent = now - 5_000;
  const list = "/v1/captures";
  const files = [file()];

  async function reserve(n: number, token: string, recordedAtMs?: number) {
    const result = await f.call(`${list}/${id(n)}`, {
      token,
      method: "POST",
      body: { files, recordedAtMs },
    });
    assert.equal(result.status, 200, await result.text());
  }

  await reserve(1, owner.token, recent);
  await reserve(2, owner.token, recent - 86_400_000);
  await reserve(3, owner.token);
  await reserve(4, other.token, now);
  await reserve(5, owner.token, now);
  await reserve(6, owner.token, now);
  await reserve(2, owner.token, now);
  await f.db
    .prepare("UPDATE captures SET status='ready' WHERE id=?")
    .bind(id(2))
    .run();
  await f.db
    .prepare("UPDATE captures SET pending_until=? WHERE id=?")
    .bind(now - 1, id(5))
    .run();
  await f.db
    .prepare("UPDATE captures SET status='deleted' WHERE id=?")
    .bind(id(6))
    .run();

  assert.equal((await f.call(list)).status, 401);
  assert.equal((await f.call(list, { cookie: owner.cookie })).status, 401);
  assert.equal(
    (await f.call(list + "?limit=0", { token: owner.read })).status,
    400,
  );
  assert.equal(
    (await f.call(list + "?limit=51", { token: owner.read })).status,
    400,
  );
  const result = await f.call(list, { token: owner.read });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  const { captures } = await result.json();
  assert.deepEqual(
    captures.map(({ id, status }) => [id, status]),
    [
      [id(1), "pending"],
      [id(2), "ready"],
      [id(3), "pending"],
    ],
  );
  assert.equal(captures[0].recordedAt, new Date(recent).toISOString());
  assert.ok(captures[0].ageSeconds >= 5);
  assert.equal(captures[2].recordedAt, null);
  assert.equal(captures[2].ageSeconds, null);
  const latest = await (
    await f.call(list + "?limit=1", { token: owner.read })
  ).json();
  assert.deepEqual(
    latest.captures.map((capture: { id: string }) => capture.id),
    [id(1)],
  );
});

test("a worker deployed before the recording migration still accepts and lists captures", async (t) => {
  const f = await fixture({}, { recordingMigration: false });
  t.after(() => f.close());
  const { token, read } = await f.identity("recording-list-rollout");
  const recordedAtMs = Date.now() - 1_000;
  const base = "/v1/captures";
  async function reserve(n: number) {
    const result = await f.call(`${base}/${id(n)}`, {
      token,
      method: "POST",
      body: { files: [file()], recordedAtMs },
    });
    assert.equal(result.status, 200, await result.text());
  }
  async function list() {
    const result = await f.call(base, { token: read });
    assert.equal(result.status, 200);
    return (await result.json()).captures;
  }
  await reserve(1);
  assert.deepEqual(await list(), [
    { id: id(1), recordedAt: null, ageSeconds: null, status: "pending" },
  ]);
  const migration = await readFile(".generated/migrations/0021.sql", "utf8");
  await f.db.exec(migration.replaceAll("\n", " "));
  await reserve(2);
  const migrated = await list();
  assert.equal(migrated[0].recordedAt, new Date(recordedAtMs).toISOString());
  assert.equal(migrated[1].recordedAt, null);
});
