import assert from "node:assert/strict";
import type { Interval } from "../../../../shared/enablement/performance/measurement.ts";

export function pressureReader(tsv: string) {
  const samples = tsv
    .trim()
    .split("\n")
    .map((line) => {
      const fields = line.split("\t").map(Number);
      assert.equal(fields.length, 2, "Invalid host pressure sample");
      assert.ok(
        fields.every((value) => Number.isSafeInteger(value) && value >= 0),
      );
      return { at: fields[0], pressure: fields[1] };
    });
  for (let index = 1; index < samples.length; index++) {
    assert.ok(
      samples[index].at > samples[index - 1].at &&
        samples[index].pressure >= samples[index - 1].pressure,
      "Host pressure samples must use a monotonic clock and counter",
    );
  }
  return (interval: Interval) => {
    assert.equal(interval.clock, "host");
    const firstAfterStart = samples.findIndex(
      (sample) => sample.at > interval.startUs,
    );
    const before = samples[firstAfterStart - 1];
    const after = samples.find((sample) => sample.at >= interval.endUs);
    assert.ok(
      before && after && after.at > before.at,
      "Missing host pressure coverage",
    );
    return {
      startUs: before.at,
      endUs: after.at,
      percent:
        (100 * (after.pressure - before.pressure)) / (after.at - before.at),
    };
  };
}
