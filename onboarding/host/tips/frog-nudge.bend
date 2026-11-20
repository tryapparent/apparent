import Base

def settle_ms() -> U32:
  350

def eligible(enabled: Bool, seen: Bool, blocked: Bool) -> Bool:
  match enabled:
    case False{}:
      False{}
    case True{}:
      match seen:
        case True{}:
          False{}
        case False{}:
          match blocked:
            case True{}:
              False{}
            case False{}:
              True{}

def ended(previous: U32, current: U32) -> Bool:
  match previous:
    case 2:
      match current:
        case 1:
          True{}
        case other:
          False{}
    case other:
      False{}
