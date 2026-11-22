import Base

type Bytes is Data:
  Bytes{hi: U32, lo: U32}

type Choice is Data:
  Choice{trash: Bool, remaining: Bytes}

def below(a: Bytes, b: Bytes) -> Bool:
  match a b:
    case Bytes{+ah, al} Bytes{+bh, bl}:
      Bool.or(U32.is_lt(ah, bh), Bool.and(U32.is_eq(ah, bh), U32.is_lt(al, bl)))

def subtract_ordered(underflow: Bool, a: Bytes, b: Bytes) -> Bytes:
  match underflow:
    case True{}:
      Bytes{0, 0}
    case False{}:
      match a b:
        case Bytes{ah, +al} Bytes{bh, +bl}:
          Bytes{U32.sub(U32.sub(ah, bh), Bool.pick(U32, U32.is_lt(al, bl), 1, 0)), U32.sub(al, bl)}

def subtract(+a: Bytes, +b: Bytes) -> Bytes:
  subtract_ordered(below(a, b), a, b)

def eligible(age: Bytes, unchanged: Bytes, +size: Bytes) -> Bool:
  Bool.and(Bool.and(Bool.not(below(age, Bytes{0, 600000})), Bool.not(below(unchanged, Bytes{0, 600000}))), below(Bytes{0, 0}, size))

def select(action: Bool, +used: Bytes, size: Bytes) -> Choice:
  match action:
    case False{}:
      Choice{False{}, used}
    case True{}:
      Choice{True{}, subtract(used, size)}

def choose(+used: Bytes, cap: Bytes, age: Bytes, unchanged: Bytes, +size: Bytes) -> Choice:
  select(Bool.and(below(cap, used), eligible(age, unchanged, size)), used, size)

def constrain(max_mb: U32) -> Bool:
  U32.is_le(max_mb, 99999999)

def warn(has_saved: Bool, +saved: U32, +next: U32) -> Bool:
  Bool.and(Bool.not(U32.is_eq(next, 0)), Bool.or(Bool.not(has_saved), Bool.or(U32.is_eq(saved, 0), U32.is_lt(next, saved))))
