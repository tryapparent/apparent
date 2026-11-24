import assert from "node:assert/strict";

export type Span = {
  id: number;
  parent: number | null;
  attempt: string;
  name: string;
  startMs: number;
  endMs: number;
};

export function attribution(startMs: number, endMs: number, spans: Span[]) {
  assert.ok(endMs > startMs);
  const covered = spans
    .map(({ startMs: start, endMs: end }) => [
      Math.max(startMs, start),
      Math.min(endMs, end),
    ])
    .filter(([start, end]) => end > start)
    .sort(([a], [b]) => a - b);
  let cursor = startMs;
  let unionMs = 0;
  let totalMs = 0;
  for (const [start, end] of covered) {
    totalMs += end - start;
    unionMs += Math.max(0, end - Math.max(start, cursor));
    cursor = Math.max(cursor, end);
  }
  return {
    unionMs,
    overlapMs: totalMs - unionMs,
    unattributedMs: endMs - startMs - unionMs,
  };
}
