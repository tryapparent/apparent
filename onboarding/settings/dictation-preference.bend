import Base

def preference_enabled(canonical: U32, legacy: Bool) -> Bool:
  match canonical:
    case 0:
      legacy
    case 2:
      True{}
    case other:
      False{}
