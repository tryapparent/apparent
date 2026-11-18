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
