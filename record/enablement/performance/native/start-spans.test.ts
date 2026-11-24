import assert from "node:assert/strict";
import { test } from "node:test";
import { startupSpans } from "./start-spans.ts";

test("a buffered startup trace is recovered only from its retained capture section", () => {
  const expected = [{ stage: "recording.start.prepare", startMs: 1, endMs: 4 }];
  const entry = (metric: number) => `START_METRIC recording_start_ms=${metric}`;
  const logged = (spans: unknown[]) =>
    `[123] recording startup stages: ${JSON.stringify(spans)}`;
  const next = [{ stage: "recording.start.prepare", startMs: 2, endMs: 8 }];
  const log = [entry(5.41), logged(expected), entry(8.17), logged(next)].join(
    "\n",
  );
  const trace = { desktopMarksMs: { recording_start_ms: 5.41 } };

  assert.deepEqual(
    startupSpans(trace, () => log),
    expected,
  );
  assert.deepEqual(
    startupSpans(trace, () => [log, log].join("\n")),
    [],
  );
  assert.deepEqual(
    startupSpans(trace, () =>
      [entry(5.41), entry(8.17), logged(next)].join("\n"),
    ),
    [],
  );
});
