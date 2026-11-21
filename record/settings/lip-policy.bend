import Base

def clip_seconds() -> U32:
  12

def admit(enabled: Bool, prepared: Bool) -> Bool:
  match enabled:
    case True{}:
      prepared
    case False{}:
      False{}

def valid_size(+size: U32) -> Bool:
  admit((size > 0 : U32), (size <= 8388608 : U32))

def setup_state(enabled: Bool, existing: Bool, supported: Bool) -> U32:
  match enabled:
    case False{}:
      0
    case True{}:
      match existing:
        case True{}:
          1
        case False{}:
          match supported:
            case True{}:
              2
            case False{}:
              3

def finish_tail_ms() -> U32:
  400
