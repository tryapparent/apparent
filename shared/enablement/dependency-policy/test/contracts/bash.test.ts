import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { comments } from "../../comments.ts";

test("pinned Bash scanner parses the real push hook and keeps heredoc data distinct", async () => {
  const source = readFileSync(
    new URL("../../../../../.githooks/pre-push", import.meta.url),
    "utf8",
  );
  const actual = await comments(".githooks/pre-push", source);
  assert.ok(actual.every((comment) => comment.startsWith("#")));
  const text =
    '#!/bin/sh\nset -eu\nroot=$(git rev-parse --show-toplevel)\ncat <<\'DATA\'\n# literal data\nDATA\n# actual comment\nprintf "%s" "$root"\n';
  assert.deepEqual(await comments("hook.sh", text), ["# actual comment"]);
});
