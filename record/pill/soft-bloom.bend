import Base

type Bloom is Data:
  Reading{level: U32, active: Bool, fresh: Bool}

def freshness_ms() -> U32:
  300

def bloom(+held: U32, +magnitude: U32, +fresh: Bool) -> Bloom:
  active = Bool.and(fresh, U32.is_le(14, magnitude))
  gain = U32.div(U32.mul(U32.min(magnitude, 180), 100), 180)
  level = U32.div(U32.add(U32.mul(held, 35), U32.mul(gain, 65)), 100)
  Bool.pick(Bloom, active, Reading{level, True{}, fresh}, Reading{held, False{}, fresh})
