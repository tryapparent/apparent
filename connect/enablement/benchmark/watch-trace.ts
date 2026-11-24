export type Span = {
  name: string;
  parent: string;
  startMs: number;
  endMs: number;
};

export function observe(enabled: boolean) {
  const spans: Span[] = [];
  return {
    spans,
    async measure<T>(name: string, parent: string, effect: () => Promise<T>) {
      if (!enabled) return effect();
      const startMs = performance.now();
      try {
        return await effect();
      } finally {
        spans.push({ name, parent, startMs, endMs: performance.now() });
      }
    },
  };
}

export function coverage(startMs: number, endMs: number, spans: Span[]) {
  const points = spans
    .flatMap((span) => {
      const start = Math.max(startMs, span.startMs);
      const end = Math.min(endMs, span.endMs);
      return start < end
        ? [
            [start, 1],
            [end, -1],
          ]
        : [];
    })
    .sort(([a], [b]) => a - b);
  let active = 0;
  let previous = startMs;
  let coveredMs = 0;
  let overlapMs = 0;
  for (const [at, delta] of points) {
    if (active > 0) coveredMs += at - previous;
    if (active > 1) overlapMs += at - previous;
    active += delta;
    previous = at;
  }
  return {
    coveredMs,
    overlapMs,
    unattributedMs: Math.max(0, endMs - startMs - coveredMs),
  };
}
