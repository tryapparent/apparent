export type Clock = "observer" | "host" | "guest-boottime";

export type Interval = {
  clock: Clock;
  startUs: number;
  endUs: number;
};

export type MeasuredWait = {
  ms: number;
  verified: true;
  intervals?: Interval[][];
};

const monotonicOriginUs =
  Number(process.hrtime.bigint() / 1000n) - performance.now() * 1000;

export function interval(
  start: number,
  end: number,
  clock: Clock = "observer",
): Interval {
  const origin = clock === "guest-boottime" ? 0 : monotonicOriginUs;
  return {
    clock,
    startUs: Math.round(origin + start * 1000),
    endUs: Math.round(origin + end * 1000),
  };
}

export function measuredWait(
  start: number,
  end: number,
  clock?: Clock,
): MeasuredWait {
  return {
    ms: end - start,
    verified: true,
    intervals: [[interval(start, end, clock)]],
  };
}
