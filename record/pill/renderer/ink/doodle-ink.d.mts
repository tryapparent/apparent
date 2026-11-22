declare const policy: {
  doodles_enabled(optedOut: boolean): boolean;
  ink_level(magnitude: number, fresh: boolean): number;
  ink_speed(level: number): number;
  ink_width(level: number): number;
  ink_lifetime_ms(): number;
  ink_age(age: number, distance: number, width: number): number;
  ink_alpha(age: number, pressure: number): number;
  ink_placement(
    size: number,
    position: number,
    rowHeight: number,
    glyphHeight: number,
  ): { scale: number; top: number };
  next_mark(
    seed: number,
    count: number,
    previous: number,
  ): {
    seed: number;
    glyph: number;
    height: number;
    turn: number;
    size: number;
  };
};
export default policy;
