import Base

def metadata_limit(+ready: Bool, +body_requested: Bool) -> U32:
  match ready body_requested:
    case True{} True{}:
      1048576
    case _ _:
      0
