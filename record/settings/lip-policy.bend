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
