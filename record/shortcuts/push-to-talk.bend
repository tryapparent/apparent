import Base

def hold_ms() -> U32:
  300

def action(recording: Bool, held: Bool, threshold: Bool, cancelled: Bool) -> U32:
  match recording:
    case True{}:
      Bool.pick(U32, held, 0, 3)
    case False{}:
      Bool.pick(U32, cancelled, 4, Bool.pick(U32, held, Bool.pick(U32, threshold, 2, 0), 1))
