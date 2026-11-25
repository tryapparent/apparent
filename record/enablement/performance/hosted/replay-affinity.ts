import assert from "node:assert/strict";

export function cpuNumbers(list: string) {
  assert.match(list, /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
  return list.split(",").flatMap((range) => {
    const [start, end = start] = range.split("-").map(Number);
    assert.ok(
      Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start,
    );
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });
}

export function replayCpuPair(
  topology: readonly { cpu: number; siblings: string }[],
  allowed: string,
) {
  const available = new Set(cpuNumbers(allowed));
  const siblingGroups = new Set<string>();
  const cpus: number[] = [];
  for (const { cpu, siblings } of topology) {
    if (!available.has(cpu) || siblingGroups.has(siblings)) continue;
    siblingGroups.add(siblings);
    cpus.push(cpu);
  }
  assert.ok(cpus.length >= 2, "Replay needs two distinct runner CPU cores");
  return cpus.slice(0, 2).join(",");
}
