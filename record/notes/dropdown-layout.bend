import Base

type Bounds is Data:
  Bounds{x: U32, y: U32, width: U32, height: U32}

def place(center: U32, top: U32, bottom: U32, +work_width: U32, +work_height: U32, content: U32) -> Bounds:
  +width = U32.min(332, work_width)
  +half = U32.div(width, 2)
  x = U32.min(U32.sub(U32.max(center, half), half), U32.sub(work_width, width))
  +below = U32.min(work_height, U32.add(bottom, 4))
  +above = U32.sub(U32.max(4, top), 4)
  +room = U32.sub(work_height, below)
  +wanted = U32.min(350, content)
  fits = Bool.not(U32.is_lt(room, wanted))
  +forward = Bool.or(fits, Bool.not(U32.is_lt(room, above)))
  +height = U32.min(wanted, Bool.pick(U32, forward, room, above))
  y = Bool.pick(U32, forward, below, U32.sub(above, U32.min(above, height)))
  Bounds{x, y, width, height}
