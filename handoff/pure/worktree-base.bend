import Base

def base_priority(marked: Bool, remote: Bool, main: Bool, master: Bool) -> U32:
  match marked remote main master:
    case True{} True{} _ _:
      0
    case True{} False{} _ _:
      1
    case False{} True{} True{} _:
      2
    case False{} True{} False{} True{}:
      3
    case False{} False{} True{} _:
      4
    case False{} False{} False{} True{}:
      5
    case _ _ _ _:
      6

def base_resolved(priority: U32) -> Bool:
  U32.is_lt(priority, 3)
