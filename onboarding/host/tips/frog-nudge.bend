import Base

def settle_ms() -> U32:
  350

def eligible(enabled: Bool, blocked: Bool) -> Bool:
  match enabled:
    case False{}:
      False{}
    case True{}:
      match blocked:
        case True{}:
          False{}
        case False{}:
          True{}

def next_count(previous: U32) -> U32:
  match previous:
    case 0:
      1
    case 1:
      2
    case other:
      0

def wave_due(previous: U32) -> Bool:
  match previous:
    case 2:
      True{}
    case other:
      False{}

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
