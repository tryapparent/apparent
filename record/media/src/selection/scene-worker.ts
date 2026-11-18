import { fstatSync, readFileSync } from "node:fs";
import { sceneTransitions, type DrawingSpan } from "./scene.ts";
const LIMIT = 16 * 1024 * 1024;
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
  const time = BigInt(value);
  if (time > 0xffff_ffff_ffff_ffffn) throw Error("Invalid clock");
  return time;
}
try {
  const input = fstatSync(0);
  if (
    process.argv.length !== 2 ||
    !input.isFile() ||
    input.size > LIMIT ||
    (input.mode & 0o777) !== 0o600
  )
    throw Error("Invalid input");
  const bytes = readFileSync(0);
  if (bytes.length > LIMIT) throw Error("Invalid input");
  const value = object(JSON.parse(bytes.toString("utf8")), [
    "version",
    "times",
    "deltas",
    "drawing",
  ]);
  if (
    value.version !== 1 ||
    !Array.isArray(value.times) ||
    !Array.isArray(value.deltas) ||
    !Array.isArray(value.drawing) ||
    value.deltas.some((delta) => typeof delta !== "number")
  )
    throw Error("Invalid request");
  const times = value.times.map(clock);
  const drawing: DrawingSpan[] = value.drawing.map((span) => {
    if (!Array.isArray(span) || span.length !== 2)
      throw Error("Invalid drawing");
    return [clock(span[0]), clock(span[1])];
  });
  const transitions = sceneTransitions(times, value.deltas, drawing);
  const output =
    JSON.stringify({
      version: 1,
      frameCount: times.length,
      firstTime: String(times[0] ?? 0n),
      lastTime: String(times.at(-1) ?? 0n),
      transitions,
    }) + "\n";
  if (Buffer.byteLength(output) > LIMIT) throw Error("Invalid output");
  process.stdout.write(output);
} catch {
  process.stderr.write("Record could not classify scene transitions\n");
  process.exitCode = 1;
}
