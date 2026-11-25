import Base

def join_mark_strokes(nearby: Bool, room: Bool, previous_open: Bool, next_open: Bool) -> Bool:
  Bool.and(nearby, Bool.and(room, Bool.and(previous_open, next_open)))

def admit_focused_mark(inside: Bool, clear: Bool, same_window: Bool, same_tree: Bool) -> Bool:
  Bool.and(inside, Bool.and(clear, Bool.and(same_window, same_tree)))

def prefer_mark_role(candidate: U32, selected: U32) -> Bool:
  U32.is_gt(candidate, selected)

def admit_mark_identity(target_role: Bool, identity: Bool) -> Bool:
  Bool.and(target_role, identity)

def admit_browser_page(point_confirmed: Bool, preceded_by_mark: Bool, same_page: Bool) -> Bool:
  Bool.and(point_confirmed, Bool.or(Bool.not(preceded_by_mark), same_page))
