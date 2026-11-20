import assert from "node:assert/strict";
import test from "node:test";
import { comments } from "../../comments.ts";

test("Connect migrations classify SQLite comments and quoted tokens", async () => {
  const file = "connect/service/migrations/0014.sql";
  const index =
    "CREATE INDEX cleanup ON attempts(cleaned_at, key) WHERE status != '-- literal';";
  assert.deepEqual(await comments(file, index), []);
  assert.deepEqual(await comments(file, index + " -- comment\n"), [
    "-- comment",
  ]);
  assert.deepEqual(await comments(file, `SELECT 2+-- line\r\n3; /* block */`), [
    "-- line",
    "/* block */",
  ]);
  assert.deepEqual(
    await comments(
      file,
      `SELECT [-- quoted], "/* quoted */", 'it''s -- quoted';`,
    ),
    [],
  );
  await assert.rejects(
    comments(file, "CREATE INDEX broken ON"),
    /syntax parser/,
  );
  await assert.rejects(comments(file, index + "\0"), /invalid NUL/);
  await assert.rejects(
    comments("other.sql", index),
    /unsupported comment syntax/,
  );
});
