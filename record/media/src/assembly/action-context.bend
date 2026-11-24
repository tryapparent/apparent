import Base

def admit_action_context(fresh: Bool, observed: Bool, consistent: Bool) -> Bool:
  Bool.and(fresh, Bool.and(observed, consistent))
