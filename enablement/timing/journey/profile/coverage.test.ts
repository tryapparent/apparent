import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assemble } from "../assemble.ts";
import { JourneyProfiles, traceWindow } from "./index.ts";
import { recordProfile } from "../../../../record/enablement/performance/profile/trace.ts";

test("the collector awaits readiness and flushes on interrupt", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apparent-dev-profile-transport-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const trace = await recordProfile(dir, "test", [
    process.execPath,
    "-e",
    `
    process.on("SIGINT", () => { process.stdout.write("flushed"); process.exitCode = 0; clearInterval(live); });
    const live = setInterval(() => {}, 1000);
    process.stderr.write(Buffer.from([0]));
  `,
  ]);
  t.after(trace.cancel);
  await trace.finish(true);
  assert.equal(
    await readFile(join(dir, "test.perfetto-trace"), "utf8"),
    "flushed",
  );
  await assert.rejects(
    recordProfile(dir, "failed", [process.execPath, "-e", "process.exit(7)"]),
    /Perfetto exited with 7/,
  );
});

test("the journey index requires a complete retained stack trace and checkpoint coverage", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apparent-dev-profile-index-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fakeProcessor = join(dir, "processor");
  await writeFile(
    fakeProcessor,
    '#!/bin/sh\nprintf \'"samples","losses"\\n2,0\\n\'\n',
  );
  await chmod(fakeProcessor, 0o700);
  const profiles = new JourneyProfiles(fakeProcessor);
  const wait = { ms: 12, verified: true as const };
  const part = {
    version: "apparent 0.22.15 · aaaaaaa",
    waits: { live: wait },
    diagnostic: true as const,
  };
  assert.throws(
    () => profiles.cover("surface", part, "receipt.json"),
    /Missing Perfetto trace/,
  );
  const window = {
    scope: "guest",
    clock: "linux-boottime-ms",
    started: 1,
    armed: 2,
    ended: 12,
    size: 4,
  };
  await writeFile(join(dir, "lane-window.json"), JSON.stringify(window));
  const trace = join(dir, "lane.perfetto-trace");
  await writeFile(trace, "cut");
  await assert.rejects(traceWindow(dir, "guest"), /missing or incomplete/);
  await writeFile(trace, "data");
  await assert.rejects(traceWindow(dir, "host"));
  await profiles.add("surface", dir, "guest");
  profiles.cover("surface", part, "receipt.json");
  assert.throws(
    () => profiles.index(dir, { ...part.waits, pill: wait }),
    /Incomplete/,
  );
  assert.deepEqual(profiles.index(dir, part.waits).checkpoints, {
    live: { lane: "surface", receipt: "receipt.json" },
  });
  assert.throws(
    () =>
      assemble(
        {
          revision: "a".repeat(40),
          runner: "test",
          runId: "test",
          vcpus: 4,
        },
        [part],
      ),
    /cannot produce a scoring receipt/,
  );
});
