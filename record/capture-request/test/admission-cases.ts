import assert from "node:assert/strict";

type Table = {
  start: string[];
  control: string[];
  endedReceipts: string[];
};

export function verifyCaptureAdmission(table: Table): void {
  assert.deepEqual(table.start, [
    "Begin",
    "Existing",
    "Expired",
    "Existing",
    "Occupied",
    "Existing",
    "Expired",
    "Existing",
  ]);
  assert.deepEqual(table.endedReceipts, [
    "processing",
    "saved",
    "cancelled",
    "failed",
  ]);

  const index = (...flags: boolean[]) =>
    flags.reduce((key, flag, bit) => key | (Number(flag) << bit), 0);
  const control = (
    action: "stop" | "cancel",
    ownership: "none" | "other" | "current",
    phase: "starting" | "recording" | "other",
    receipt = "unknown",
    expired = false,
  ) =>
    table.control[
      index(
        expired,
        action === "cancel",
        table.endedReceipts.includes(receipt),
        ownership !== "none",
        ownership === "current",
        phase === "starting",
        phase === "recording",
      )
    ];

  assert.equal(control("stop", "other", "recording"), "WrongCapture");
  assert.equal(control("stop", "other", "recording", "saved"), "AlreadyEnded");
  assert.equal(
    control("stop", "current", "recording", "processing"),
    "AlreadyEnded",
  );
  assert.equal(control("stop", "none", "other", "saved"), "AlreadyEnded");
  assert.equal(
    control("stop", "other", "recording", "saved", true),
    "DeadlinePassed",
  );
  assert.equal(control("stop", "current", "starting"), "NotReady");
  assert.equal(control("stop", "current", "recording"), "Stopping");
  assert.equal(
    control("stop", "current", "recording", "recording", true),
    "DeadlinePassed",
  );
  assert.equal(control("cancel", "current", "starting"), "Cancelled");
  assert.equal(
    control("cancel", "current", "starting", "starting", true),
    "DeadlinePassed",
  );
  assert.equal(control("cancel", "current", "recording"), "Cancelled");
  assert.equal(control("cancel", "current", "other", "processing"), "NotReady");
  assert.equal(
    control("cancel", "other", "recording", "saved"),
    "WrongCapture",
  );
  assert.equal(control("cancel", "none", "other"), "AlreadyEnded");

  const receipts = new Map<string, string>();
  const start = (id: string, expired: boolean, occupied: boolean) => {
    const decision = table.start[index(receipts.has(id), expired, occupied)];
    if (decision !== "Existing") receipts.set(id, decision);
    return decision;
  };
  assert.equal(start("first", false, false), "Begin");
  assert.equal(start("first", false, true), "Existing");
  assert.equal(start("occupied", false, true), "Occupied");
  assert.equal(start("occupied", false, false), "Existing");
  assert.equal(start("late", true, true), "Expired");
  assert.equal(start("late", false, false), "Existing");
  assert.equal(receipts.get("late"), "Expired");
}
