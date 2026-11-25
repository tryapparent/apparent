import Base

def either(available: Bool, saved: Bool) -> Bool:
  match available:
    case True{}:
      True{}
    case False{}:
      saved

def volume_level_disabled(pending: Bool, saved: Bool) -> Bool:
  match pending:
    case True{}:
      True{}
    case False{}:
      match saved:
        case True{}:
          False{}
        case False{}:
          True{}

def local_detail(hex: Bool) -> U32:
  match hex:
    case True{}:
      1
    case False{}:
      0

def transcription_detail(command: Bool, hex: Bool, hex_available: Bool) -> U32:
  match command:
    case True{}:
      2
    case False{}:
      local_detail(either(hex_available, hex))
