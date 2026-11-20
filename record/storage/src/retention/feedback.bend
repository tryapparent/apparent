import Base

def submission_phase(submitted: Bool, busy: Bool, reading: Bool) -> U32:
  match submitted:
    case False{}:
      0
    case True{}:
      match busy:
        case False{}:
          3
        case True{}:
          Bool.pick(U32, reading, 2, 1)

def reset_available(custom: Bool, defaults_known: Bool) -> Bool:
  Bool.and(custom, defaults_known)

def keep_submission(submitted: Bool, confirmed: Bool) -> Bool:
  Bool.and(submitted, Bool.not(confirmed))
