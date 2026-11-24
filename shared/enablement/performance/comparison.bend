import Base

def score(+control_first: Nat, +candidate_first: Nat, candidate_second: Nat, control_second: Nat) -> Nat:
  +control = Nat.add(control_first, control_second)
  candidate = Nat.add(candidate_first, candidate_second)
  Nat.div(Nat.add(Nat.mul(candidate, 10000n), Nat.div(control, 2n)), control)

def within_limit(observed: Nat, reference: Nat, allowance: Nat) -> Bool:
  Bool.not(Nat.is_lt(Nat.add(reference, allowance), observed))
