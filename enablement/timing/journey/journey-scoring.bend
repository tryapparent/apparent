import Base

def weight_ratio(weight: U32, ratio: U32) -> U32:
  U32.mul(weight, ratio)

def normalized_score(total: U32) -> U32:
  U32.div(U32.add(total, 50), 100)

def speed_index(score: U32) -> U32:
  U32.div(1000000000, U32.max(1, score))

def material_gain(incumbent: U32, +candidate: U32, noise: U32) -> Bool:
  U32.is_lt(noise, U32.sub(candidate, U32.min(incumbent, candidate)))

def within_budget(+observed: U32, +baseline: U32, tolerance: U32, +percentage: U32) -> Bool:
  extra = U32.sub(observed, U32.min(observed, baseline))
  relative = U32.add(U32.mul(U32.div(baseline, 100), percentage), U32.div(U32.mul(U32.mod(baseline, 100), percentage), 100))
  Bool.not(U32.is_lt(U32.max(tolerance, relative), extra))

def should_stop(qualified: Bool, enough_windows: Bool, first: U32, second: U32, +early_sum: U32, +slow_percent: U32, hypotheses: U32, minimum: U32) -> Bool:
  cutoff = U32.add(U32.mul(U32.div(early_sum, 200), slow_percent), U32.div(U32.mul(U32.mod(early_sum, 200), slow_percent), 200))
  slow = Bool.not(U32.is_lt(cutoff, U32.max(first, second)))
  Bool.and(qualified, Bool.and(enough_windows, Bool.and(slow, Bool.not(U32.is_lt(hypotheses, minimum)))))
