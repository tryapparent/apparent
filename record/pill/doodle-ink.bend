import Base

type Pose is Data:
  Mark{seed: U32, glyph: U32, height: U32, turn: U32, size: U32}

def ink_level(magnitude: U32, fresh: Bool) -> U32:
  Bool.pick(U32, fresh, U32.div(U32.min(magnitude, 180), 2), 0)

def ink_speed(level: U32) -> U32:
  U32.add(44, U32.mul(level, 6))

def ink_age(age: U32, distance: U32, +width: U32) -> U32:
  U32.max(age, U32.div(U32.mul(U32.min(distance, width), 6500), U32.max(width, 1)))

def ink_alpha(age: U32, pressure: U32) -> U32:
  fade = U32.div(U32.sub(6500, U32.min(age, 6500)), 5)
  U32.div(U32.mul(U32.min(fade, 900), U32.add(560, U32.mul(pressure, 4))), 900)

def different_glyph(+sampled: U32, count: U32, previous: U32) -> U32:
  Bool.pick(U32, U32.is_eq(sampled, previous), U32.mod(U32.add(sampled, 1), count), sampled)

def place_mark(+next: U32, +count: U32, previous: U32) -> Pose:
  glyph = different_glyph(U32.mod(U32.div(next, 16), count), count, previous)
  Mark{next, glyph, U32.mod(U32.div(next, 1024), 101), U32.mod(U32.div(next, 256), 101), U32.mod(U32.div(next, 65536), 101)}

def next_mark(seed: U32, count: U32, previous: U32) -> Pose:
  place_mark(U32.add(U32.mul(seed, 1664525), 1013904223), count, previous)
