import { test } from "node:test";
import assert from "node:assert/strict";
import { routeDecision } from "../consumers.ts";

test("repository-only pitch skills have no product or publication consumer", () => {
  const paths = [
    "agent/skills/.gitattributes",
    "agent/skills/pitch-deck/README.md",
    "agent/skills/pitch-deck/pitch-deck-from-scratch/SKILL.md",
  ];
  const decision = routeDecision(paths);
  assert.deepEqual(decision.selected, []);
  assert.ok(
    Object.values(decision.publicationStreams).every((required) => !required),
  );
  assert.ok(
    routeDecision(["capture/agent/skills/apparent/SKILL.md"]).selected.includes(
      "public",
    ),
  );
});
