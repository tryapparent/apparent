export interface Point { x: number; y: number }

/** Native compositor facts for XWayland, whose own pointer freezes over Wayland. */
export class CompositorCursor {
  private sample: { point: Point | null; received: number } | null = null;

  observe(value: unknown, now: number): void {
    if (value !== null && (!Array.isArray(value) || value.length !== 2
      || !value.every(v => typeof v === 'number' && Number.isFinite(v)))) {
      throw Error('Invalid compositor cursor');
    }
    this.sample = {point: value === null ? null : {x: value[0], y: value[1]}, received: now};
  }

  current(now: number): Point | null {
    const sample = this.sample;
    // Loss of native facts must release hover; stale X11 coordinates cannot
    // substitute for a compositor observation. This never authorizes an action.
    return sample && now >= sample.received && now - sample.received < 400
      && sample.point ? {...sample.point} : null;
  }
}
