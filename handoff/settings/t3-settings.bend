import Base

def picker_enabled(canonical_present: Bool, canonical_enabled: Bool, legacy_enabled: Bool) -> Bool:
  match canonical_present:
    case True{}:
      canonical_enabled
    case False{}:
      legacy_enabled

def show_computers(saved: Bool, known: Bool) -> Bool:
  match known:
    case True{}:
      saved
    case False{}:
      False{}

def computer_status(expired: Bool, checked: Bool, reachable: Bool) -> U32:
  match expired:
    case True{}:
      3
    case False{}:
      match checked:
        case False{}:
          0
        case True{}:
          match reachable:
            case True{}:
              1
            case False{}:
              2

def environment_icon(selected: U32, detected: U32) -> U32:
  match selected:
    case 0:
      detected
    case other:
      selected
