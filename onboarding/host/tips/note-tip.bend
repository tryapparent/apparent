import Base

def duration_ms() -> U32:
  8000

def recording_started(previous: U32) -> U32:
  match previous:
    case 0:
      1
    case 1:
      2
    case 2:
      3
    case other:
      3

def tip_due(previous: U32) -> Bool:
  match previous:
    case 2:
      True{}
    case other:
      False{}
