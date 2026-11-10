/** Durable native stroke metrics. Indices are one-based within this capture. */
export interface ScreenInk {
  total: number;
  recent: { index: number; points: number; laser: boolean }[];
}

export function validScreenInk(value: unknown): value is ScreenInk {
  if (!value || typeof value !== 'object') return false;
  const ink = value as ScreenInk;
  if (!Number.isSafeInteger(ink.total) || ink.total < 0
    || !Array.isArray(ink.recent) || ink.recent.length > 64) return false;
  const seen = new Set<number>();
  return ink.recent.every(stroke => {
    if (!stroke || !Number.isSafeInteger(stroke.index) || stroke.index < 1 || stroke.index > ink.total
      || !Number.isSafeInteger(stroke.points) || stroke.points < 0 || typeof stroke.laser !== 'boolean'
      || seen.has(stroke.index)) return false;
    seen.add(stroke.index);
    return true;
  });
}

// Preserve the existing lesson's thresholds. Capture reports metrics; it does
// not decide whether an observed mark satisfies a coaching step.
export const boardPracticed = (points: number): boolean => points >= 4;
export const screenPracticed = (ink: ScreenInk, after: number): boolean =>
  ink.recent.some(stroke => stroke.index > after && !stroke.laser && stroke.points >= 10);
