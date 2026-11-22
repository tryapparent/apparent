declare const policy: {
  ink_level(magnitude: number, fresh: boolean): number;
  ink_speed(level: number): number;
  ink_age(age: number, distance: number, width: number): number;
  ink_alpha(age: number, pressure: number): number;
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
