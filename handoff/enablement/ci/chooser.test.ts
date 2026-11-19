import assert from "node:assert/strict";
import { test } from "node:test";
import { computerLabels } from "../../pure/chooser.ts";

test("address-only labels use computer numbers while names remain distinct", () => {
  assert.deepEqual(
    computerLabels(["X1", "192.0.2.1:3773", "[2001:db8::1]", " Clanker "]),
    ["X1", "Computer 2", "Computer 3", "Clanker"],
  );
  assert.deepEqual(computerLabels(["X1", "X1", "X1 (1)"]), [
    "X1 (2)",
    "X1 (3)",
    "X1 (1)",
  ]);
});
