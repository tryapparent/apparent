export function framePacing(frames: number[], longTasks: number[]) {
  if (!frames.length) throw new Error("No animation frames observed");
  const sorted = [...frames].sort((a, b) => a - b);
  const percentile = (p: number) =>
    +sorted[Math.floor((sorted.length - 1) * p)].toFixed(2);
  return {
    frames: frames.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: +sorted.at(-1)!.toFixed(1),
    over25ms: frames.filter((ms) => ms > 25).length,
    over34ms: frames.filter((ms) => ms > 34).length,
    longTasks: longTasks.length,
    longTaskMs: +longTasks.reduce((a, b) => a + b, 0).toFixed(0),
  };
}
