import Base

def ordinary_frames() -> U32:
  6

def maximum_for(low_word_only: Bool, +low: U32) -> U32:
  match low_word_only:
    case False{}:
      12
    case True{}:
      extra = U32.div(U32.sub(low, U32.min(low, 20000)), 20000)
      U32.min(12, U32.add(ordinary_frames(), extra))

def maximum_frames(high: U32, +low: U32) -> U32:
  maximum_for(U32.is_zero(high), low)

law high_word_one_saturates:
  for low: U32
  {maximum_frames(1, low) == 12 : U32}

def high_word_one_saturates(low):
  {==}

def use_movie_assembly(imported: Bool, device: Bool) -> U32:
  match imported:
    case True{}:
      1
    case False{}:
      match device:
        case True{}:
          1
        case False{}:
          0
