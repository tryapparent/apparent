import Base

def may_copy(saved: Bool, current: Bool, connected: Bool) -> Bool:
  match current:
    case False{}:
      False{}
    case True{}:
      Bool.and(saved, connected)

law stale_cannot_copy:
  for saved: Bool
  for connected: Bool
  {may_copy(saved, False{}, connected) == False{} : Bool}

def stale_cannot_copy(saved, connected):
  {==}

def copy_mode(local_screen: Bool, enabled: Bool, target: Bool) -> U32:
  Bool.pick(U32, Bool.and(local_screen, Bool.and(enabled, target)), 1, 0)
