import Base

type Pose is Data:
  Mark{seed: U32, glyph: U32, height: U32, turn: U32, size: U32}

type Placement is Data:
  Fit{scale: U32, top: U32}

def doodles_enabled(opted_in: Bool) -> Bool:
  opted_in

def ink_level(magnitude: U32, fresh: Bool) -> U32:
  signal = U32.sub(U32.min(104, U32.max(magnitude, 14)), 14)
  Bool.pick(U32, fresh, U32.div(U32.mul(signal, 100), 90), 0)

def ink_speed(level: U32) -> U32:
  speed = U32.add(16, U32.mul(level, 5))
  U32.max(16, U32.div(U32.add(U32.mul(speed, 2), 2), 5))

def ink_width(level: U32) -> U32:
  U32.add(135, U32.mul(level, 2))

def ink_lifetime_ms() -> U32:
  6500

def ink_age(age: U32, distance: U32, +width: U32) -> U32:
  U32.max(age, U32.div(U32.mul(U32.min(distance, width), ink_lifetime_ms()), U32.max(width, 1)))

def ink_alpha(age: U32, pressure: U32) -> U32:
  fade = U32.div(U32.sub(ink_lifetime_ms(), U32.min(age, ink_lifetime_ms())), 5)
  U32.div(U32.mul(U32.min(fade, 900), U32.add(380, U32.mul(pressure, 5))), 900)

def position_ink(+scale: U32, position: U32, usable: U32, glyph_height: U32) -> Placement:
  spare = U32.sub(usable, U32.div(U32.mul(glyph_height, scale), 1000))
  Fit{scale, U32.add(5, U32.div(U32.mul(spare, position), 100))}

def fit_ink(size: U32, position: U32, +usable: U32, +glyph_height: U32) -> Placement:
  scale = U32.min(U32.add(1100, U32.mul(size, 3)), U32.div(U32.mul(usable, 1000), U32.max(glyph_height, 1)))
  position_ink(scale, position, usable, glyph_height)

def ink_placement(size: U32, position: U32, row_height: U32, glyph_height: U32) -> Placement:
  fit_ink(size, position, U32.sub(U32.max(row_height, 10), 10), glyph_height)

def different_glyph(+sampled: U32, count: U32, previous: U32) -> U32:
  Bool.pick(U32, U32.is_eq(sampled, previous), U32.mod(U32.add(sampled, 1), count), sampled)

def place_mark(+next: U32, +count: U32, previous: U32) -> Pose:
  glyph = different_glyph(U32.mod(U32.div(next, 16), count), count, previous)
  Mark{next, glyph, U32.mod(U32.div(next, 1024), 101), U32.mod(U32.div(next, 256), 101), U32.mod(U32.div(next, 65536), 101)}

def next_mark(seed: U32, count: U32, previous: U32) -> Pose:
  place_mark(U32.add(U32.mul(seed, 1664525), 1013904223), count, previous)
