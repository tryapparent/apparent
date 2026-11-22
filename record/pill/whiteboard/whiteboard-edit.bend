import Base

type Edit is Data:
  BoardOpen{}
  BoardBegin{}
  BoardMove{}
  BoardEnd{}
  BoardCancel{}
  BoardUndo{}
  BoardClear{}
  BoardClose{}

type EditEffect is Data:
  Ignore{}
  Show{}
  Start{}
  Append{}
  Commit{}
  Discard{}
  RemoveLast{}
  Erase{}
  Hide{}
  CommitAndHide{}
  CommitAndStart{}

def begin(+active: Bool, +point: Bool, +strokes: U32) -> EditEffect:
  fresh = Bool.pick(EditEffect, U32.is_lt(strokes, 500), Start{}, Ignore{})
  replace = Bool.pick(EditEffect, U32.is_lt(strokes, 499), CommitAndStart{}, Ignore{})
  Bool.pick(EditEffect, point, Bool.pick(EditEffect, active, replace, fresh), Ignore{})

def drawing(event: Edit, +active: Bool, +point: Bool, +strokes: U32, +points: U32) -> EditEffect:
  match event:
    case BoardBegin{}:
      begin(active, point, strokes)
    case BoardMove{}:
      allowed = Bool.and(point, Bool.and(active, U32.is_lt(points, 2000)))
      Bool.pick(EditEffect, allowed, Append{}, Ignore{})
    case BoardEnd{}:
      Bool.pick(EditEffect, active, Commit{}, Ignore{})
    case BoardCancel{}:
      Discard{}
    case BoardUndo{}:
      Bool.pick(EditEffect, active, Discard{}, RemoveLast{})
    case BoardClear{}:
      Erase{}
    case _:
      Ignore{}

def edit(event: Edit, +visible: Bool, +active: Bool, +point: Bool, +strokes: U32, +points: U32) -> EditEffect:
  match event:
    case BoardOpen{}:
      Show{}
    case BoardClose{}:
      Bool.pick(EditEffect, active, CommitAndHide{}, Hide{})
    case other:
      Bool.pick(EditEffect, visible, drawing(other, active, point, strokes, points), Ignore{})
