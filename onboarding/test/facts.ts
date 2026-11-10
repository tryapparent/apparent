import type {ScreenInk} from '../src/ink.ts';

/** Synthetic native observations for headless policy tests only. */
export function ink(total: number, points = 10, laser = false): ScreenInk {
  return {total, recent: Array.from({length: Math.max(0, Math.min(64, total))}, (_, i) =>
    ({index: total - i, points, laser}))};
}
