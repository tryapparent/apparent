import Base

def qualifies(users: U32, occurrences: U32, +baseline: U32) -> Bool:
  threshold = U32.add(U32.div(baseline, 56), U32.min(1, U32.mod(baseline, 56)))
  Bool.and(Bool.not(U32.is_lt(users, 5)), Bool.not(U32.is_lt(occurrences, threshold)))

def admits(hot: Bool, seconds_since_launch: U32) -> Bool:
  Bool.and(Bool.not(hot), Bool.not(U32.is_lt(seconds_since_launch, 86400)))
