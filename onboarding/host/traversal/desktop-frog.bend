import Base

def naming_stage(active: Bool, named: Bool, revealed: Bool) -> U32:
  match active:
    case False{}:
      0
    case True{}:
      match named:
        case True{}:
          0
        case False{}:
          match revealed:
            case False{}:
              1
            case True{}:
              2

def accept_name(has_control: Bool, length: U32) -> Bool:
  match has_control:
    case True{}:
      False{}
    case False{}:
      match length:
        case 0:
          False{}
        case rest:
          (rest <= 24 : U32)

def desktop_visible(adopted: Bool, unavailable: Bool) -> Bool:
  match unavailable:
    case True{}:
      False{}
    case False{}:
      adopted

def clamp_offset(wanted: U32, extent: U32, +size: U32) -> U32:
  U32.min(wanted, (U32.max(extent, size) - size : U32))

def desktop_pause_ms() -> U32:
  3600000
