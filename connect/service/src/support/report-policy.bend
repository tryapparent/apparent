import Base

def part(+position: Nat, +bytes: Nat) -> Bool:
  Bool.and(Nat.is_lt(position, 6n), Nat.is_lt(0n, bytes))
