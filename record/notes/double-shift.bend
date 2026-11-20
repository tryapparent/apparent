import Base

def enabled_by_default() -> Bool:
  True{}

def hold_limit_ms() -> U32:
  250

def pair_limit_ms() -> U32:
  400

def pointer_limit() -> U32:
  12

def release(clean: Bool, within_hold: Bool, within_movement: Bool, within_pair: Bool) -> U32:
  Bool.pick(U32, Bool.and(clean, Bool.and(within_hold, within_movement)), Bool.pick(U32, within_pair, 2, 1), 0)
