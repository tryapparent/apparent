import { test } from "node:test";
import { fixture } from "./controller-fixture.ts";
import path from "node:path";
import assert from "node:assert/strict";
import { writeFile, readFile, readdir, stat, chmod } from "node:fs/promises";
import { Controller } from "../../main/controller.ts";

test("saved connection alone leaves picker off; explicit sending flag enables it", async (t) => {
  const f = await fixture(t);
  await f.save();
  const c = new Controller(() => {}, f.config);
  await c.update("off", "processing");
  assert.equal(c.view(), null);
  assert.equal(f.reads, 0);
  await f.save(false);
  await c.update("off-again", "processing");
  assert.equal(c.view(), null);
  await f.save(true);
  await c.update("on", "processing");
  assert.deepEqual(
    c.view()?.choices.map((c) => c.id),
    ["new", "thread"],
  );
  assert.equal(JSON.stringify(c.view()).includes("private-test-token"), false);
});

test("recording warms the picker once and makes choices available at Finish", async (t) => {
  const f = await fixture(t);
  const c = new Controller(() => {}, f.config);
  await c.update("capture", "recording");
  assert.equal(f.reads, 1);
  assert.equal(c.view(), null);
  await assert.rejects(c.confirm("capture", "thread"), /changed/);

  await c.update("capture", "recording");
  await c.update("capture", "processing");
  assert.equal(f.reads, 1);
  assert.equal(c.view()?.processing, true);
  assert.deepEqual(
    c.view()?.choices.map((choice) => choice.id),
    ["new", "thread"],
  );
  await c.confirm("capture", "thread");
  assert.equal(f.calls.length, 0);
  await c.ready("capture", "Synthetic recording");
  assert.equal(f.calls.length, 1);
});

test("prefetch skips practice and off recordings and checks settings again at Finish", async (t) => {
  const f = await fixture(t);
  const c = new Controller(() => {}, f.config);
  await c.update("practice", "recording", false);
  assert.equal(f.reads, 0);
  await f.save(false);
  await c.update("off", "recording");
  assert.equal(f.reads, 0);

  await f.save(true);
  await c.update("revoked", "recording");
  assert.equal(f.reads, 1);
  await f.save(false);
  await c.update("revoked", "processing");
  assert.equal(c.view(), null);
  await assert.rejects(c.confirm("revoked", "thread"), /changed/);
  assert.equal(f.reads, 1);
  assert.equal(f.calls.length, 0);
});

test("confirmed processing handoff survives dismissal/reload and is dispatched once to exact thread", async (t) => {
  const f = await fixture(t),
    c = new Controller(() => {}, f.config);
  await c.update("capture", "processing");
  await c.confirm("capture", "thread");
  assert.equal(c.view()?.phase, "armed");
  assert.equal(f.calls.length, 0);
  const files = await readdir(path.join(f.home, "t3-handoffs"));
  assert.equal(
    (await stat(path.join(f.home, "t3-handoffs", files[0]))).mode & 0o777,
    0o600,
  );
  const restored = new Controller(() => {}, f.config);
  await restored.update("capture", "processing");
  assert.equal(restored.view()?.selected, "thread");
  await restored.update("new-capture", "recording");
  await restored.ready("capture", "PRIVATE RECORDING HANDOFF");
  await restored.ready("capture", "PRIVATE RECORDING HANDOFF");
  assert.equal(f.accepted.size, 1);
  assert.equal(f.calls[0].payload.threadId, "thread");
  assert.equal(f.calls[0].payload.deliveryIntent, "auto");
  assert.equal(restored.view(), null);
  const receipt = await readFile(
    path.join(f.home, "t3-handoffs", files[0]),
    "utf8",
  );
  assert.equal(JSON.parse(receipt).phase, "sent");
  assert.equal(receipt.includes("private-test-token"), false);
});

test("lost acknowledgement retries the same new thread, command and message with T3 defaults", async (t) => {
  const f = await fixture(t);
  f.worktree();
  const c = new Controller(() => {}, f.config);
  await c.update("capture", "completed");
  await c.ready("capture", "Recording");
  f.lose();
  await c.confirm("capture", "new");
  assert.equal(c.view()?.phase, "uncertain");
  await c.retry("capture");
  assert.equal(c.view()?.phase, "sent");
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(f.accepted.size, 1);
  assert.equal(f.calls[0].tag, "orchestration.launchThread");
  assert.deepEqual(f.calls[0].payload.modelSelection, {
    instanceId: "fixture",
    model: "project-default",
  });
  assert.equal(f.calls[0].payload.runtimeMode, "auto-accept-edits");
  assert.deepEqual(f.calls[0].payload.workspaceStrategy, {
    type: "worktree",
    baseRef: "origin/main",
    startFromOrigin: true,
  });
});

test("cancel and failed finalization never dispatch; stale confirmation cannot target a newer recording", async (t) => {
  const f = await fixture(t),
    c = new Controller(() => {}, f.config);
  await c.update("capture", "processing");
  await c.confirm("capture", "thread");
  await c.cancel("capture");
  await c.ready("capture", "Recording");
  assert.equal(f.calls.length, 0);
  await c.update("failed", "processing");
  await c.ready("failed", null);
  await assert.rejects(c.confirm("failed", "new"), /prepared/);
  await c.update("new", "processing");
  await assert.rejects(c.confirm("failed", "thread"), /changed/);
  assert.equal(f.calls.length, 0);
});

test("disabling the next recording keeps its Paste flow while an earlier confirmed handoff finishes", async (t) => {
  const f = await fixture(t),
    c = new Controller(() => {}, f.config);
  await c.update("pending", "processing");
  await c.confirm("pending", "thread");
  await f.save(false);
  await c.update("off", "completed");
  assert.equal(c.view(), null);
  await c.ready("pending", "Earlier confirmed recording");
  assert.equal(f.calls.length, 1);
  assert.equal(c.view(), null);
  await c.ready("off", "Keep this local");
  assert.equal(c.view(), null);
  assert.equal(f.calls.length, 1);
});

test("inaccessible receipts fail closed and a background persistence failure exposes recovery", async (t) => {
  const f = await fixture(t),
    c = new Controller(() => {}, f.config);
  await c.update("capture", "processing");
  await c.confirm("capture", "thread");
  await chmod(path.join(f.home, "t3-handoffs"), 0o755);
  await c.ready("capture", "Kept recording");
  assert.equal(c.view()?.phase, "error");
  assert.equal(f.calls.length, 0);
  assert.equal(c.text("capture"), "Kept recording");
  const restored = new Controller(() => {}, f.config);
  await restored.update("new", "completed");
  await assert.rejects(
    restored.confirm("new", "thread"),
    /receipts unavailable/,
  );
  assert.equal(f.calls.length, 0);
  await chmod(path.join(f.home, "t3-handoffs"), 0o700);
  await c.retry("capture");
  assert.equal(c.view()?.phase, "sent");
  assert.equal(f.calls.length, 1);
});

test("enabled but unpaired shows setup and retains the recording; check connection activates the same capture", async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.config,
    JSON.stringify({ experiments: { t3DestinationPicker: true } }),
  );
  const c = new Controller(() => {}, f.config);
  await c.update("kept", "processing");
  assert.equal(c.view()?.phase, "setup");
  assert.equal(f.reads, 0);
  await c.ready("kept", "Kept handoff");
  await c.update("kept", "completed");
  assert.equal(c.text("kept"), "Kept handoff");
  assert.equal(c.view()?.phase, "setup");
  await assert.rejects(c.confirm("kept", "new"), /changed/);
  assert.equal(f.calls.length, 0);
  await f.save(true);
  await c.retry("kept");
  assert.equal(c.view()?.phase, "choosing");
  assert.equal(c.text("kept"), "Kept handoff");
  assert.deepEqual(
    c.view()?.choices.map((c) => c.id),
    ["new", "thread"],
  );
});

test("expired credentials expose setup without making a T3 request", async (t) => {
  const f = await fixture(t);
  const saved = JSON.parse(await readFile(f.config, "utf8"));
  saved.t3.expiresAt = Date.now() - 1;
  await writeFile(f.config, JSON.stringify(saved));
  const c = new Controller(() => {}, f.config);
  await c.update("expired", "completed");
  assert.equal(c.view()?.phase, "setup");
  assert.equal(f.reads, 0);
});

test("all connected computers are combined without collisions and dispatch to the selected origin", async (t) => {
  const a = await fixture(t),
    b = await fixture(t);
  a.label("Laptop project");
  b.label("Build project");
  a.computer("X1");
  b.computer("Clanker");
  const credentials = (origin: string) => ({
    origin,
    token: "private-test-token",
    expiresAt: Date.now() + 3600000,
  });
  await writeFile(
    a.config,
    JSON.stringify({
      t3: { ...credentials(a.origin), connections: [credentials(b.origin)] },
      experiments: { t3DestinationPicker: true },
    }),
  );
  const c = new Controller(() => {}, a.config);
  await c.update("combined", "completed");
  const choices = c.view()!.choices;
  assert.equal(choices.length, 4);
  assert.deepEqual(
    choices.map((choice) => choice.kind === "new"),
    [true, true, false, false],
  );
  assert.equal(new Set(choices.map((c) => c.id)).size, 4);
  assert.equal(JSON.stringify(choices).includes("private-test-token"), false);
  const target = choices.find(
    (choice) => choice.computer === "Clanker" && choice.kind === "new",
  )!;
  await c.ready("combined", "Synthetic recording");
  b.lose();
  await c.confirm("combined", target.id);
  assert.equal(c.view()!.phase, "uncertain");
  assert.equal(c.view()!.confirmed!.project, "Build project");
  assert.equal(c.view()!.confirmed!.computer, "Clanker");
  assert.equal(a.calls.length, 0);
  assert.equal(b.calls.length, 1);
  await c.retry("combined");
  assert.equal(c.view()!.phase, "sent");
  assert.equal(a.calls.length, 0);
  assert.equal(b.accepted.size, 1);
  assert.deepEqual(b.calls[0], b.calls[1]);
  const reopened = new Controller(() => {}, a.config);
  await reopened.update("next", "processing");
  assert.equal(reopened.view()!.choices[0].computer, "Clanker");
  assert.equal(reopened.view()!.choices[0].project, "Build project");
  assert.equal(reopened.view()!.selected, reopened.view()!.choices[0].id);
});

test("one unreachable computer leaves the other computer selectable and reports the missing host", async (t) => {
  const a = await fixture(t);
  await writeFile(
    a.config,
    JSON.stringify({
      t3: {
        origin: a.origin,
        token: "private-test-token",
        expiresAt: Date.now() + 3600000,
        connections: [
          {
            origin: "http://127.0.0.1:1",
            token: "offline",
            expiresAt: Date.now() + 3600000,
          },
        ],
      },
      experiments: { t3DestinationPicker: true },
    }),
  );
  const c = new Controller(() => {}, a.config);
  await c.update("partial", "completed");
  assert.equal(c.view()!.choices.length, 2);
  assert.match(c.view()!.error!, /Computer 2/);
  assert.equal(c.view()!.error!.includes("127.0.0.1"), false);
  const target = c.view()!.choices.find((choice) => choice.kind !== "new")!;
  await c.ready("partial", "Synthetic recording");
  await c.confirm("partial", target.id);
  assert.equal(c.view()!.phase, "sent");
  assert.equal(a.calls.length, 1);
});

test("friendly names never fall back to network addresses and only appear for multiple computers", async (t) => {
  const a = await fixture(t),
    b = await fixture(t),
    c = new Controller(() => {}, a.config);
  a.computer("X1");
  await c.update("single", "processing");
  assert.ok(c.view()!.choices.every((choice) => choice.computer === undefined));
  const credentials = (origin: string) => ({
    origin,
    token: "private-test-token",
    expiresAt: Date.now() + 3600000,
  });
  await writeFile(
    a.config,
    JSON.stringify({
      t3: { ...credentials(a.origin), connections: [credentials(b.origin)] },
      experiments: { t3DestinationPicker: true },
    }),
  );
  for (const [label, expected] of [
    [undefined, ["Computer 1", "Computer 2"]],
    [" ", ["Computer 1", "Computer 2"]],
    [123, ["Computer 1", "Computer 2"]],
    ["Shared", ["Shared (1)", "Shared (2)"]],
  ] as const) {
    a.computer(label);
    b.computer(label);
    await c.update("names-" + String(label), "processing");
    assert.deepEqual(
      [...new Set(c.view()!.choices.map((choice) => choice.computer))],
      expected,
    );
    assert.ok(
      c
        .view()!
        .choices.every((choice) => !choice.computer!.includes("127.0.0.1")),
    );
  }
});
