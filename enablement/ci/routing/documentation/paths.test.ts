import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicMarkdown, routeDecision } from "../consumers.ts";

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
    routeDecision(["agent/skills/apparent/SKILL.md"]).selected.includes(
      "public",
    ),
  );
});

test("the skill and its embedded guides reach native and Public verification", () => {
  const source = readFileSync(
    new URL(
      "../../../../public/enablement/site-build/agent-files.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const paths = new Set(
    Array.from(
      source.matchAll(/\b(?:repo|guide)\("([^"]+\.md)"\)/g),
      (match) => match[1],
    ),
  );
  const guides = [...paths].filter((path) =>
    path.startsWith("agent/skills/apparent/"),
  );
  assert.equal(guides.length, 3);
  for (const path of guides) {
    assert.deepEqual(routeDecision([path]).selected, [
      "capture",
      "engine",
      "public",
    ]);
    paths.delete(path);
  }
  assert.deepEqual(
    [...paths].sort(),
    [...publicMarkdown].filter((path) => !path.includes("/skills/")).sort(),
  );
});
