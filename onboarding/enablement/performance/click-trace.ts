import {
  interval,
  measuredWait,
} from "../../../shared/enablement/performance/measurement.ts";

export function clickTrace(attempt: string, detailed: boolean) {
  const waits: Record<string, ReturnType<typeof measuredWait>> = {};
  const spans: { name: string; parent: string; start: number; end: number }[] =
    [];
  const launched = performance.now();
  let lastReady = launched;
  let dwellMs = 0;
  return {
    waits,
    launched,
    checkpoint(name: string, start: number, end = performance.now()) {
      waits[name] = measuredWait(start, end, "host");
      lastReady = end;
    },
    input(name: string, start: number) {
      if (start < lastReady) return;
      dwellMs += start - lastReady;
      if (detailed)
        spans.push({
          name,
          parent: "driver-dwell",
          start: lastReady,
          end: start,
        });
    },
    span(parent: string, name: string, start: number, end = performance.now()) {
      if (detailed) spans.push({ parent, name, start, end });
    },
    report() {
      const stages = Object.entries(waits).map(([name, wait]) => {
        const { startUs, endUs } = wait.intervals![0][0];
        const parts = spans.filter((span) => span.parent === name);
        const ranges = parts
          .map(({ start, end }) => interval(start, end, "host"))
          .map(
            (part) =>
              [
                Math.max(startUs, part.startUs),
                Math.min(endUs, part.endUs),
              ] as const,
          )
          .filter(([start, end]) => end > start)
          .sort(([left], [right]) => left - right);
        let covered = 0;
        let cursor = startUs;
        for (const [start, end] of ranges) {
          covered += Math.max(0, end - Math.max(start, cursor));
          cursor = Math.max(cursor, end);
        }
        const total = ranges.reduce(
          (sum, [start, end]) => sum + end - start,
          0,
        );
        return {
          name,
          ms: wait.ms,
          accountedMs: covered / 1000,
          overlapMs: (total - covered) / 1000,
          unattributedMs: (endUs - startUs - covered) / 1000,
        };
      });
      const events = [
        ...spans,
        {
          name: "onboarding.attempt",
          parent: "root",
          start: launched,
          end: lastReady,
        },
      ].map(({ name, parent, start, end }, index) => {
        const { startUs, endUs } = interval(start, end, "host");
        return {
          name,
          cat: "onboarding",
          ph: "X",
          pid: 1,
          tid: index + 1,
          ts: startUs,
          dur: endUs - startUs,
          args: { attempt, parent },
        };
      });
      for (const [name, wait] of Object.entries(waits)) {
        const { startUs, endUs } = wait.intervals![0][0];
        events.push({
          name,
          cat: "onboarding",
          ph: "X",
          pid: 1,
          tid: events.length + 1,
          ts: startUs,
          dur: endUs - startUs,
          args: { attempt, parent: "onboarding.attempt" },
        });
      }
      return {
        stages,
        dwellMs,
        perfetto: { traceEvents: events, displayTimeUnit: "ms" },
      };
    },
  };
}
