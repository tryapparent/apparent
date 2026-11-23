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
  UndoDraft{evict: Bool}
  UndoStroke{evict: Bool}
  ClearPaper{evict: Bool}
  Hide{}
  CommitAndHide{}
  CommitAndStart{}

def begin(+active: Bool, +point: Bool, +strokes: U32) -> EditEffect:
  fresh = Bool.pick(EditEffect, U32.is_lt(strokes, 500), Start{}, Ignore{})
  replace = Bool.pick(EditEffect, U32.is_lt(strokes, 499), CommitAndStart{}, Ignore{})
  Bool.pick(EditEffect, point, Bool.pick(EditEffect, active, replace, fresh), Ignore{})

def drawing(event: Edit, +active: Bool, +point: Bool, +strokes: U32, +points: U32, +revisions: U32) -> EditEffect:
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
      match active:
        case True{}:
          UndoDraft{Bool.not(U32.is_lt(revisions, 12))}
        case False{}:
          Bool.pick(EditEffect, U32.is_lt(0, strokes), UndoStroke{Bool.not(U32.is_lt(revisions, 12))}, Ignore{})
    case BoardClear{}:
      evict = Bool.not(U32.is_lt(revisions, 12))
      Bool.pick(EditEffect, Bool.or(active, U32.is_lt(0, strokes)), ClearPaper{evict}, Ignore{})
    case _:
      Ignore{}

def edit(event: Edit, +visible: Bool, +active: Bool, +point: Bool, +strokes: U32, +points: U32, +revisions: U32) -> EditEffect:
  match event:
    case BoardOpen{}:
      Show{}
    case BoardClose{}:
      Bool.pick(EditEffect, active, CommitAndHide{}, Hide{})
    case other:
      Bool.pick(EditEffect, visible, drawing(other, active, point, strokes, points, revisions), Ignore{})
