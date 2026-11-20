import Base

def sparkle_outcome(sparkle_domain: Bool, code: U32) -> String:
  match sparkle_domain:
    case False{}:
      "report"
    case True{}:
      match code:
        case 1001:
          "expected"
        case 1003:
          "expected"
        case 4007:
          "expected"
        case 4008:
          "expected"
        case _:
          "report"
