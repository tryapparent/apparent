/** A point or origin in the same coordinate space as the native pill bounds. */
export interface Point { x: number; y: number }

/** Rectangle bounds measured in display-independent pixels. */
export interface Bounds extends Point { width: number; height: number }

/** One horizontal row in the native hit region, measured in display-independent pixels. */
export interface ShapeRect extends Point { width: number; height: 1 }

export interface PillLayout {
  bounds: Bounds;
  /** Vertical offset of the leading pill row inside the complete window. */
  rowY: number;
  rowHeight: number;
  side: 'up' | 'down';
}

function inset(y: number, width: number, height: number, radius = 28): number {
  const r = Math.min(radius, width / 2, height / 2);
  const edge = Math.min(y + 0.5, height - y - 0.5);
  return edge >= r ? 0 : Math.ceil(r - Math.sqrt(Math.max(0, r * r - (r - edge) ** 2)));
}

interface Segment { y: number; width: number; height: number; radius: number }

function segments(width: number, height: number, rowY = 0, rowHeight = height, rowWidth = width, pocketWidth = width): Segment[] {
  const row = { y: rowY, width: rowWidth, height: rowHeight, radius: 28 };
  if (height <= rowHeight) return [row];
  return [row, { y: rowY === 0 ? rowHeight + 4 : 0, width: pocketWidth, height: height - rowHeight - 4, radius: 16 }];
}

/** Returns the per-scanline rounded hit region used by the native pill window. */
export function shape(width: number, height: number, rowY = 0, rowHeight = height, rowWidth = width, pocketWidth = width): ShapeRect[] {
  return segments(width, height, rowY, rowHeight, rowWidth, pocketWidth).flatMap(part =>
    Array.from({ length: part.height }, (_, y) => {
      const x = inset(y, part.width, part.height, part.radius);
      return { x, y: y + part.y, width: Math.max(1, part.width - 2 * x), height: 1 as const };
    }));
}

/** Tests a display-space point against the rounded row and optional pocket hit regions. */
export function contains(
  point: Point,
  bounds: Bounds,
  rowY = 0,
  rowHeight = bounds.height,
  rowWidth = bounds.width,
  pocketWidth = bounds.width,
): boolean {
  return segments(bounds.width, bounds.height, rowY, rowHeight, rowWidth, pocketWidth).some(part => {
    const x = point.x - bounds.x;
    const y = point.y - bounds.y - part.y;
    if (y < 0 || y >= part.height) return false;
    const edge = inset(Math.floor(y), part.width, part.height, part.radius);
    return x >= edge && x < part.width - edge;
  });
}

/** Clamps a window rectangle to a display work area, including negative origins. */
export function clamp(bounds: Bounds, area: Bounds): Point {
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + Math.max(0, area.width - bounds.width)),
    y: Math.min(Math.max(bounds.y, area.y), area.y + Math.max(0, area.height - bounds.height)),
  };
}

/** Keeps the leading row anchored while a pocket opens, closes, or changes direction. */
export function layout(
  before: Bounds,
  area: Bounds,
  width: number,
  height: number,
  rowHeight: number,
  previousRowY = 0,
  mainWidth = width,
  previousMainWidth = before.width,
): PillLayout {
  const anchor = before.y + previousRowY;
  const up = height > rowHeight && anchor + height > area.y + area.height && anchor >= area.y + height - rowHeight;
  const rowY = up ? height - rowHeight : 0;
  const bounds = { x: Math.round(before.x + (previousMainWidth - mainWidth) / 2), y: anchor - rowY, width, height };
  return { bounds: { ...bounds, ...clamp(bounds, area) }, rowY, rowHeight, side: up ? 'up' : 'down' };
}
