import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Part } from "../assemble.ts";

export async function traceWindow(directory: string, scope: "host" | "guest") {
  const window = JSON.parse(
    await readFile(join(directory, "lane-window.json"), "utf8"),
  );
  const file = join(directory, "lane.perfetto-trace");
  const { size } = await stat(file);
  assert(
    size > 0 && size === window.size,
    "Perfetto trace is missing or incomplete",
  );
  assert(window.clock === "linux-boottime-ms" && window.scope === scope);
  assert([window.started, window.armed, window.ended].every(Number.isFinite));
  assert(window.started <= window.armed && window.armed < window.ended);
  return { file, window };
}

export class JourneyProfiles {
  private readonly traces = new Map<
    string,
    Awaited<ReturnType<typeof traceWindow>>
  >();
  private readonly checkpoints = new Map<
    string,
    { lane: string; receipt: string }
  >();

  private readonly traceProcessor: string;

  constructor(traceProcessor: string) {
    this.traceProcessor = traceProcessor;
  }

  async add(label: string, directory: string, scope: "host" | "guest") {
    assert(!this.traces.has(label), "Duplicate profile lane " + label);
    const trace = await traceWindow(directory, scope);
    const output = execFileSync(
      this.traceProcessor,
      [
        "query",
        "--format",
        "csv",
        trace.file,
        "SELECT (SELECT count(*) FROM perf_sample WHERE callsite_id IS NOT NULL) AS samples, " +
          "(SELECT count(*) FROM stats WHERE severity = 'data_loss' AND value > 0) AS losses",
      ],
      { encoding: "utf8", timeout: 120000 },
    ).trim();
    const [samples, losses] = (output.split("\n").at(-1) ?? "")
      .split(",")
      .map(Number);
    assert.equal(losses, 0, "Perfetto reported data loss for " + label);
    assert(
      Number.isSafeInteger(samples) && samples > 0,
      "Perfetto captured no call stacks for " + label,
    );
    this.traces.set(label, { ...trace, window: { ...trace.window, samples } });
  }

  cover(label: string, part: Part, receipt: string) {
    assert(this.traces.has(label), "Missing Perfetto trace for " + label);
    for (const [id, wait] of Object.entries(part.waits ?? {})) {
      if (wait.verified === true) {
        assert(
          !this.checkpoints.has(id),
          "Duplicate profiled checkpoint " + id,
        );
        this.checkpoints.set(id, { lane: label, receipt });
      }
    }
  }

  index(directory: string, waits: NonNullable<Part["waits"]>) {
    assert.deepEqual(
      [...this.checkpoints.keys()].sort(),
      Object.keys(waits).sort(),
      "Incomplete Perfetto checkpoint coverage",
    );
    return {
      schema: 1,
      diagnostic: true,
      traces: Object.fromEntries(
        [...this.traces].map(([label, { file, window }]) => [
          label,
          { file: relative(directory, file), ...window },
        ]),
      ),
      checkpoints: Object.fromEntries(this.checkpoints),
    };
  }
}
