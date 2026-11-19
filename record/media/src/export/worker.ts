import { fstatSync, readFileSync } from "node:fs";
import { planQuietExport, type Span, type TimelineItem } from "./policy.ts";

const MAX_INPUT = 16 * 1024 * 1024,
  MAX_OUTPUT = 16 * 1024;
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== keys.slice().sort().join(",")
  )
    throw Error("Invalid request");
  return value as Record<string, unknown>;
}
function clock(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value))
    throw Error("Invalid clock");
  const result = BigInt(value);
  if (result > 0xffff_ffff_ffff_ffffn) throw Error("Invalid clock");
  return result;
}
function spans(value: unknown): Span[] {
  if (!Array.isArray(value)) throw Error("Invalid observations");
  return value.map((span) => {
    if (!Array.isArray(span) || span.length !== 2)
      throw Error("Invalid observations");
    return [clock(span[0]), clock(span[1])];
  });
}
try {
  const input = fstatSync(0);
  if (
    process.argv.length !== 2 ||
    !input.isFile() ||
    input.size > MAX_INPUT ||
    (input.mode & 0o777) !== 0o600
  )
    throw Error("Invalid input");
  const bytes = readFileSync(0);
  if (bytes.length > MAX_INPUT) throw Error("Invalid input");
  const request = object(JSON.parse(bytes.toString("utf8")), [
    "version",
    "durationMs",
    "videoOffsetMs",
    "limits",
    "frozen",
    "silent",
    "timeline",
  ]);
  if (request.version !== 1 || !Array.isArray(request.timeline))
    throw Error("Invalid request");
  const limits = object(request.limits, ["maximumIntervals", "supportedRate"]);
  if (
    typeof limits.maximumIntervals !== "number" ||
    typeof limits.supportedRate !== "number"
  )
    throw Error("Invalid limits");
  const durationMs = clock(request.durationMs),
    videoOffsetMs = clock(request.videoOffsetMs);
  const timeline = request.timeline.map((item): TimelineItem => {
    const content = object(item, ["kind", "startMs", "endMs"]);
    if (
      typeof content.kind !== "string" ||
      !["event", "stroke", "mark", "transcript", "cursor"].includes(
        content.kind,
      )
    )
      throw Error("Invalid timeline");
    return {
      kind: content.kind as TimelineItem["kind"],
      startMs: clock(content.startMs),
      endMs: clock(content.endMs),
    };
  });
  const intervals = planQuietExport({
    durationMs,
    videoOffsetMs,
    frozen: spans(request.frozen),
    silent: spans(request.silent),
    timeline,
    limits: {
      maximumIntervals: limits.maximumIntervals,
      supportedRate: limits.supportedRate,
    },
  });
  const response = {
    version: 1,
    durationMs: String(durationMs),
    videoOffsetMs: String(videoOffsetMs),
    intervals: intervals.map((item) => ({
      startMs: String(item.startMs),
      endMs: String(item.endMs),
      rate: item.rate,
    })),
  };
  const output = JSON.stringify(response) + "\n";
  if (Buffer.byteLength(output) > MAX_OUTPUT) throw Error("Invalid output");
  process.stdout.write(output);
} catch {
  process.stderr.write("Record could not plan quiet export\n");
  process.exitCode = 1;
}
