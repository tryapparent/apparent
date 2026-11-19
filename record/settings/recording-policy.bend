import Base

def either(available: Bool, saved: Bool) -> Bool:
  match available:
    case True{}:
      True{}
    case False{}:
      saved

def volume_switch_enabled(available: Bool, saved: Bool) -> Bool:
  either(available, saved)

def volume_level_enabled(available: Bool, saved: Bool) -> Bool:
  match available:
    case True{}:
      saved
    case False{}:
      False{}

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

law unavailable_volume_can_only_be_turned_off:
  for saved: Bool
  {volume_switch_enabled(False{}, saved) == saved : Bool}

def unavailable_volume_can_only_be_turned_off(saved):
  {==}

law unavailable_volume_level_is_disabled:
  for saved: Bool
  {volume_level_enabled(False{}, saved) == False{} : Bool}

def unavailable_volume_level_is_disabled(saved):
  {==}
