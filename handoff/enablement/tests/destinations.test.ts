import { test } from "node:test";
import assert from "node:assert/strict";
import { destinations, type Thread } from "../../main/destination-catalogue.ts";
import { filterDestinations } from "../../pure/destinations.ts";

test("browse orders thread states and searches title, environment, project and state", () => {
  const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({
    id,
    projectId: "p",
    title: id,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...extra,
  });
  const choices = destinations(
    [
      thread("onboarding notes", {
        settledOverride: "settled",
        settledAt: "2026-01-03",
      }),
      thread("older", { settledAt: "2026-01-02" }),
      thread("child", { lineage: { relationshipToParent: "subagent" } }),
      thread("archived", { archivedAt: "2026-01-02" }),
      thread("deleted", { deletedAt: "2026-01-02" }),
      thread("active", { settledAt: "2026-01-02", settledOverride: "active" }),
      thread("onboarding recording", {
        session: { status: "running" },
        latestTurn: { state: "running" },
        activeOrderKey: "a",
      }),
      thread("done", {
        latestTurn: { state: "completed" },
        activeOrderKey: "a",
        createdAt: "2026-01-02",
      }),
      thread("snooze", { snoozedUntil: "2030-01-01" }),
      thread("pin-b", { pinnedAt: "2026-01-02", pinOrderKey: "b" }),
      thread("pin-a", { pinnedAt: "2026-01-02", pinOrderKey: "a" }),
    ],
    [{ id: "p", title: "Apparent" }],
    "p",
    Date.parse("2026-01-04"),
  ).map((choice) => ({ ...choice, computer: "Clanker" }));
  const ids = choices.map((choice) => choice.id);
  assert.deepEqual(ids, [
    "new",
    "pin-a",
    "pin-b",
    "done",
    "active",
    "onboarding recording",
    "snooze",
    "onboarding notes",
    "older",
  ]);
  assert.deepEqual(
    choices.map((choice) => choice.kind),
    [
      "new",
      "pinned",
      "pinned",
      "done",
      "active",
      "working",
      "snoozed",
      "settled",
      "settled",
    ],
  );
  assert.deepEqual(
    filterDestinations(choices, "  ONBOARDING  ").map((choice) => choice.id),
    ["onboarding recording", "onboarding notes"],
  );
  assert.deepEqual(
    filterDestinations(choices, "Clanker apparent settled onboarding").map(
      (choice) => choice.id,
    ),
    ["onboarding notes"],
  );
  assert.deepEqual(filterDestinations(choices, "no matches"), []);
  assert.deepEqual(
    filterDestinations(choices, " ").map((choice) => choice.id),
    ids,
  );
});

test("T3 shell run fields order inbox, working and settled rows independently", () => {
  const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({
    id,
    projectId: "p",
    title: id,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...extra,
  });
  const rows = destinations(
    [
      thread("done", {
        status: "completed",
        latestRunId: "r1",
        latestRunCompletedAt: "2026-01-06",
      }),
      thread("old-inbox", { createdAt: "2026-01-03", activeOrderKey: "a" }),
      thread("needs-approval", {
        status: "waiting",
        snoozedUntil: "2026-03-01",
        pendingRuntimeRequest: { kind: "approval" },
      }),
      thread("new-working", {
        status: "running",
        latestUserAuthoredMessageAt: "2026-01-07",
      }),
      thread("old-working", {
        status: "running",
        latestRunRequestedAt: "2026-01-04",
      }),
      thread("snooze-later", { snoozedUntil: "2026-02-20" }),
      thread("snooze-sooner", {
        snoozedUntil: "2026-02-12",
        pinnedAt: "2026-01-02",
      }),
      thread("pinned-new", { pinnedAt: "2026-01-02", createdAt: "2026-01-04" }),
      thread("pinned-old", { pinnedAt: "2026-01-09" }),
      thread("settled-old", {
        settledOverride: "settled",
        settledAt: "2026-01-04",
      }),
      thread("settled-new", {
        settledOverride: "settled",
        latestRunCompletedAt: "2026-01-06",
      }),
    ],
    [{ id: "p", title: "Apparent" }],
    "p",
    Date.parse("2026-02-01"),
  );
  assert.deepEqual(
    rows.map(({ id }) => id),
    [
      "new",
      "pinned-new",
      "pinned-old",
      "done",
      "old-inbox",
      "needs-approval",
      "new-working",
      "old-working",
      "snooze-sooner",
      "snooze-later",
      "settled-new",
      "settled-old",
    ],
  );
});
