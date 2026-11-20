import Base

def same_millisecond(other: U32, same_time: Bool) -> U32:
  match same_time:
    case True{}:
      2
    case False{}:
      other

def precision(same_second: Bool, same_time: Bool) -> U32:
  match same_second:
    case True{}:
      same_millisecond(1, same_time)
    case False{}:
      same_millisecond(0, same_time)
